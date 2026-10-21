import ts from 'typescript';
import { resolve } from 'node:path';

/** @brief Persisted binding type with REPL mutability and initialization metadata. */
export interface BindingType { name: string; kind: 'const' | 'let' | 'var'; type: string }
/** @brief Compiler diagnostics retain source positions for actionable feedback. */
export class CompilationError extends Error {
    constructor(readonly diagnostics: readonly ts.Diagnostic[]) {
        super(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
            getCanonicalFileName: f => f, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n',
        }));
    }
}

const globals = `
declare function whenAll<T extends readonly unknown[]>(values: T): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }>;
declare function whenAny<T>(values: Iterable<T | PromiseLike<T>>): Promise<Awaited<T>>;
declare const console: { log(...values: unknown[]): void };
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

    compile(source: string, bindings: BindingType[], declarations: string): { javascript: string; bindings: BindingType[]; sourceMap: string } {
        this.prepare(source, bindings, declarations);
        const diagnostics = [...this.service.getSyntacticDiagnostics(this.input), ...this.service.getSemanticDiagnostics(this.input)];
        if (diagnostics.length) throw new CompilationError(diagnostics);
        const program = this.service.getProgram()!;
        const file = program.getSourceFile(this.input)!;
        const checker = program.getTypeChecker();
        const rootBindings: Array<{ identifier: ts.Identifier; kind: BindingType['kind'] }> = [];
        const names = (node: ts.BindingName, kind: BindingType['kind']): void => {
            if (ts.isIdentifier(node)) rootBindings.push({ identifier: node, kind });
            else for (const element of node.elements) if (ts.isBindingElement(element)) names(element.name, kind);
        };
        for (const statement of file.statements) {
            if (ts.isVariableStatement(statement)) {
                const kind = statement.declarationList.flags & ts.NodeFlags.Const ? 'const' : statement.declarationList.flags & ts.NodeFlags.Let ? 'let' : 'var';
                for (const declaration of statement.declarationList.declarations) names(declaration.name, kind);
            } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) rootBindings.push({ identifier: statement.name, kind: 'let' });
            else if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement) || ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement)) throw new Error('Imports, enums and namespaces are not supported in the REPL; use exposed capabilities');
            if (ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) throw new Error('REPL declarations cannot be exported');
        }
        const existing = new Set(bindings.map(b => b.name));
        const newTypes = rootBindings.map(({ identifier, kind }) => {
            if (identifier.text.startsWith('__dsh') || existing.has(identifier.text)) throw new Error(`Binding already exists or is reserved: ${identifier.text}; use del first`);
            const type = checker.getTypeAtLocation(identifier);
            return { name: identifier.text, kind, type: checker.typeToString(type, identifier, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseStructuralFallback) };
        });
        const persistent = new Set<ts.Symbol>();
        for (const { identifier } of rootBindings) {
            const symbol = checker.getSymbolAtLocation(identifier);
            if (symbol) persistent.add(symbol);
        }
        // Resolve ambient symbols from their declarations so nested lexical shadows keep their own identity.
        const environment = program.getSourceFile(this.ambient)!;
        for (const statement of environment.statements) if (ts.isVariableStatement(statement)) {
            for (const decl of statement.declarationList.declarations) if (ts.isIdentifier(decl.name) && existing.has(decl.name.text)) {
                const symbol = checker.getSymbolAtLocation(decl.name);
                if (symbol) persistent.add(symbol);
            }
        }
        const factory = ts.factory;
        const access = (name: string): ts.Expression => factory.createPropertyAccessExpression(factory.createPropertyAccessExpression(factory.createIdentifier('__dsh'), 'scope'), name);
        const call = (method: string, args: ts.Expression[]): ts.ExpressionStatement => factory.createExpressionStatement(factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier('__dsh'), method), undefined, args));
        const transformer: ts.TransformerFactory<ts.SourceFile> = context => {
            const visitor: ts.Visitor = node => {
                if (ts.isShorthandPropertyAssignment(node)) {
                    const symbol = checker.getShorthandAssignmentValueSymbol(node);
                    if (symbol && persistent.has(symbol)) return factory.createPropertyAssignment(node.name, access(node.name.text));
                }
                if (ts.isIdentifier(node)) {
                    const symbol = checker.getSymbolAtLocation(node);
                    if (symbol && persistent.has(symbol)) return access(node.text);
                }
                return ts.visitEachChild(node, visitor, context);
            };
            return input => {
                const statements: ts.Statement[] = [];
                // Predeclare for temporal dead zones; initialization runs only after awaited values settle.
                for (const b of newTypes) statements.push(call('define', [factory.createStringLiteral(b.name), factory.createStringLiteral(b.kind)]));
                const initialize = (name: string, value: ts.Expression): ts.Statement => call('initialize', [factory.createStringLiteral(name), value]);
                // Function declarations are initialized before executable statements, preserving hoisting.
                for (const s of input.statements) if (ts.isFunctionDeclaration(s) && s.name && s.body) {
                    const expression = factory.createFunctionExpression(s.modifiers?.filter(m => m.kind === ts.SyntaxKind.AsyncKeyword), s.asteriskToken, s.name, s.typeParameters, s.parameters, s.type, s.body);
                    statements.push(initialize(s.name.text, ts.visitEachChild(expression, visitor, context)));
                }
                for (let i = 0; i < input.statements.length; i++) {
                    const s = input.statements[i]!;
                    if (ts.isExportDeclaration(s)) continue; // Virtual module sentinel, never runtime code.
                    if (ts.isFunctionDeclaration(s)) continue;
                    if (ts.isVariableStatement(s)) {
                        for (const declaration of s.declarationList.declarations) {
                            const value = declaration.initializer ? ts.visitNode(declaration.initializer, visitor) as ts.Expression : factory.createVoidZero();
                            if (ts.isIdentifier(declaration.name)) statements.push(initialize(declaration.name.text, value));
                            else {
                                // Native JS destructuring handles defaults, rest and evaluation order.
                                const local = factory.createUniqueName('__dsh_pattern');
                                statements.push(factory.createVariableStatement(undefined, factory.createVariableDeclarationList([factory.createVariableDeclaration(local, undefined, undefined, value)], ts.NodeFlags.Const)));
                                statements.push(factory.createVariableStatement(undefined, factory.createVariableDeclarationList([factory.createVariableDeclaration(declaration.name, undefined, undefined, local)], ts.NodeFlags.Const)));
                                const bound: string[] = [];
                                const collect = (n: ts.BindingName): void => { if (ts.isIdentifier(n)) bound.push(n.text); else n.elements.forEach(e => { if (ts.isBindingElement(e)) collect(e.name); }); };
                                collect(declaration.name);
                                bound.forEach(n => statements.push(initialize(n, factory.createIdentifier(n))));
                            }
                        }
                    } else if (ts.isClassDeclaration(s) && s.name) {
                        const expression = factory.createClassExpression(undefined, s.name, s.typeParameters, s.heritageClauses, s.members);
                        statements.push(initialize(s.name.text, ts.visitEachChild(expression, visitor, context)));
                    } else if (ts.isExpressionStatement(s) && i === input.statements.length - 2) {
                        statements.push(factory.createReturnStatement(ts.visitNode(s.expression, visitor) as ts.Expression));
                    } else statements.push(ts.visitNode(s, visitor) as ts.Statement);
                }
                return factory.updateSourceFile(input, statements);
            };
        };
        // Transform the same nodes used for symbol analysis, then ask TypeScript to erase types.
        const transformed = ts.transform(file, [transformer]);
        const printed = ts.createPrinter().printFile(transformed.transformed[0]!);
        transformed.dispose();
        const output = ts.transpileModule(printed, {
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, sourceMap: true, inlineSources: true },
            fileName: 'segment.ts', reportDiagnostics: true,
        });
        if (output.diagnostics?.length) throw new CompilationError(output.diagnostics);
        return { javascript: output.outputText.replace(/^\/\/# sourceMappingURL=.*$/m, ''), bindings: newTypes, sourceMap: output.sourceMapText ?? '' };
    }
}
