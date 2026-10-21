import ts from 'typescript';
import { resolve } from 'node:path';

/** @brief Persisted binding type with REPL mutability and initialization metadata. */
export interface BindingType { name: string; kind: 'const' | 'let' | 'var'; type: string }
/** @brief Compiler diagnostics retain source positions for actionable feedback. */
export class CompilationError extends Error {
    constructor(readonly diagnostics: readonly ts.Diagnostic[]) {
        super(ts.formatDiagnostics(diagnostics, {
            getCanonicalFileName: f => f, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n',
        }));
    }
}

const globals = `
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
declare const tools: { sort(): Promise<{ revision: number; changes: unknown[] }> };
`;

/** @brief Incremental virtual project shared by compilation and completion. */
export class TypeScriptProject {
    readonly input = resolve('/__dsh_repl__/input.ts');
    readonly ambient = resolve('/__dsh_repl__/environment.d.ts');
    private files = new Map<string, { text: string; version: number }>();
    private service: ts.LanguageService;
    private options: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true,
        lib: ['lib.es2022.d.ts'], types: [], noEmit: true, skipLibCheck: true,
        allowUnreachableCode: false,
    };

    constructor() {
        const host: ts.LanguageServiceHost = {
            getScriptFileNames: () => [...this.files.keys()],
            getScriptVersion: f => String(this.files.get(f)?.version ?? 0),
            getScriptSnapshot: f => {
                const text = this.files.get(f)?.text ?? ts.sys.readFile(f);
                return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
            },
            getCurrentDirectory: () => process.cwd(), getCompilationSettings: () => this.options,
            getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
            fileExists: f => this.files.has(f) || ts.sys.fileExists(f),
            readFile: f => this.files.get(f)?.text ?? ts.sys.readFile(f),
            readDirectory: ts.sys.readDirectory,
        };
        this.service = ts.createLanguageService(host, ts.createDocumentRegistry());
    }

    private update(path: string, text: string): void {
        const old = this.files.get(path);
        if (old?.text !== text) this.files.set(path, { text, version: (old?.version ?? 0) + 1 });
    }

    prepare(source: string, bindings: BindingType[], declarations: string): void {
        this.update(this.ambient, `${globals}\n${declarations}\n${bindings.map(b => `declare ${b.kind} ${b.name}: ${b.type};`).join('\n')}`);
        // A module permits top-level await while ambient REPL bindings remain global.
        this.update(this.input, `${source}\nexport {};`);
    }

    languageService(): ts.LanguageService { return this.service; }

    dispose(): void { this.service.dispose(); }

    compile(source: string, bindings: BindingType[], declarations: string): { units: ExecutionUnit[]; bindings: BindingType[]; sourceMap: string; sourceMaps: string[] } {
        this.prepare(source, bindings, declarations);
        const diagnostics = [...this.service.getSyntacticDiagnostics(this.ambient), ...this.service.getSyntacticDiagnostics(this.input), ...this.service.getSemanticDiagnostics(this.input)];
        if (diagnostics.length) throw new CompilationError(diagnostics);
        const program = this.service.getProgram()!;
        const file = program.getSourceFile(this.input)!;
        const checker = program.getTypeChecker();
        const newTypes: BindingType[] = [];
        const names = (node: ts.BindingName, kind: BindingType['kind']): void => {
            if (ts.isIdentifier(node)) {
                if (node.text.startsWith('__dsh')) throw new Error('Reserved runtime identifier');
                newTypes.push({ name: node.text, kind, type: checker.typeToString(checker.getTypeAtLocation(node), node, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseStructuralFallback) });
            } else for (const element of node.elements) if (ts.isBindingElement(element)) names(element.name, kind);
        };
        const statements = file.statements.filter(s => !ts.isExportDeclaration(s));
        for (const statement of statements) {
            if (ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) throw new Error('REPL declarations cannot be exported');
            if (ts.isVariableStatement(statement)) {
                const kind = statement.declarationList.flags & ts.NodeFlags.Const ? 'const' : statement.declarationList.flags & ts.NodeFlags.Let ? 'let' : 'var';
                for (const declaration of statement.declarationList.declarations) names(declaration.name, kind);
            } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) names(statement.name, ts.isFunctionDeclaration(statement) ? 'var' : 'let');
            else if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement) || ts.isModuleDeclaration(statement)) throw new Error('Imports and namespaces are not supported; use exposed capabilities');
        }
        const printer = ts.createPrinter();
        let sourceMap = '';
        const sourceMaps: string[] = [];
        const transpile = (text: string): string => {
            const output = ts.transpileModule(text, {
                compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, sourceMap: true, inlineSources: true },
                fileName: 'segment.ts', reportDiagnostics: true,
            });
            if (output.diagnostics?.length) throw new CompilationError(output.diagnostics);
            sourceMap = output.sourceMapText ?? '';
            sourceMaps.push(sourceMap);
            return output.outputText.replace(/^\/\/# sourceMappingURL=.*$/m, '');
        };
        const containsAwait = (node: ts.Node): boolean => {
            if (ts.isFunctionLike(node)) return false;
            if (ts.isAwaitExpression(node) || (ts.isForOfStatement(node) && !!node.awaitModifier)) return true;
            return ts.forEachChild(node, containsAwait) ?? false;
        };
        const print = (node: ts.Node): string => printer.printNode(ts.EmitHint.Unspecified, node, file);
        const units: ExecutionUnit[] = [];
        if (!statements.some(containsAwait)) {
            // One native script preserves lexical declarations, hoisting, TDZ and delete behavior.
            units.push({ javascript: transpile(source), mode: 'script', display: !!statements.at(-1) && ts.isExpressionStatement(statements.at(-1)!) });
        } else {
            // Only asynchronous segments need staging. Bindings themselves are always native VM declarations.
            for (let i = 0; i < statements.length; i++) {
                const statement = statements[i]!;
                const display = i === statements.length - 1 && ts.isExpressionStatement(statement);
                if (!containsAwait(statement)) units.push({ javascript: transpile(print(statement)), mode: 'script', display });
                else if (ts.isVariableStatement(statement)) {
                    for (const declaration of statement.declarationList.declarations) {
                        const value = declaration.initializer;
                        if (!value || !containsAwait(value)) {
                            const single = ts.factory.updateVariableStatement(statement, statement.modifiers, ts.factory.updateVariableDeclarationList(statement.declarationList, [declaration]));
                            units.push({ javascript: transpile(print(single)), mode: 'script', display: false });
                            continue;
                        }
                        const replacement = ts.factory.updateVariableDeclaration(declaration, declaration.name, declaration.exclamationToken, declaration.type, ts.factory.createIdentifier('__dshValue'));
                        const binding = ts.factory.updateVariableStatement(statement, statement.modifiers, ts.factory.updateVariableDeclarationList(statement.declarationList, [replacement]));
                        units.push({ javascript: transpile(`(async () => (${print(value)}))()`), mode: 'binding', binding: transpile(print(binding)), display: false });
                    }
                } else if (ts.isExpressionStatement(statement)) units.push({ javascript: transpile(`(async () => (${print(statement.expression)}))()`), mode: 'async', display });
                else {
                    // A block-local await can use a native async function; var would change scope.
                    let hasVar = false;
                    const scan = (n: ts.Node): void => {
                        if (ts.isFunctionLike(n)) return;
                        if (ts.isVariableDeclarationList(n) && !(n.flags & ts.NodeFlags.BlockScoped)) hasVar = true;
                        ts.forEachChild(n, scan);
                    };
                    scan(statement);
                    if (hasVar) throw new Error('Top-level await with block-scoped var is unsupported; use let or an explicit async IIFE');
                    units.push({ javascript: transpile(`(async () => { ${print(statement)} })()`), mode: 'async', display: false });
                }
            }
        }
        return { units, bindings: newTypes, sourceMap, sourceMaps };
    }
}

/** @brief Native scripts and staged async values; declarations never become global-property proxies. */
export interface ExecutionUnit { javascript: string; mode: 'script' | 'async' | 'binding'; binding?: string; display: boolean }
