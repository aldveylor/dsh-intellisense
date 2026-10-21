import ts from 'typescript';
import type { SessionRuntime } from '../runtime/session.js';
import type { Environment } from '../runtime/session.js';
import type { Usage } from '../registry/registry.js';

/** @brief A real TypeScript language-service completion, including callable signature. */
export interface Candidate { name: string; path: string; kind: string; signature: string; documentation: string }
/** @brief Completion response with the original cursor and argument help. */
export interface CompletionResult { candidates: Candidate[]; signatures: string[]; context: string }

/** @brief Syntax-aware completion over persistent symbols and generated namespaces. */
export function complete(runtime: SessionRuntime, environment: Environment, source: string, usage: Record<string, Usage> = {}, identities: Record<string, string> = {}): CompletionResult {
    const project = runtime.project;
    const bindings = runtime.declarations();
    project.prepare(source, bindings, environment.declarations);
    const service = project.languageService();
    const result = service.getCompletionsAtPosition(project.input, source.length, { includeCompletionsWithInsertText: true });
    const prefix = /((?:[\w$]+\.)*)([\w$]*)$/.exec(source);
    const namespace = prefix?.[1] ?? '';
    const partial = prefix?.[2] ?? '';
    const actual = prefix && (namespace || source.trim() === partial) ? runtime.members(namespace.replace(/\.$/, '')) : undefined;
    const actualNames = actual ? new Set(actual) : undefined;
    const discovered = [...(result?.entries ?? [])];
    if (actual) {
        const known = new Set(discovered.map(entry => entry.name));
        for (const name of actual) if (!known.has(name)) discovered.push({ name, kind: ts.ScriptElementKind.memberVariableElement, sortText: '15' });
    }
    const visible = new Set([...environment.paths.map(path => path.split('.')[0]!), ...bindings.map(binding => binding.name), 'Promise', 'tools']);
    const callOpening = /\(\s*$/.test(source);
    const entries = callOpening ? [] : discovered.filter(e => (!actualNames || actualNames.has(e.name)) && e.kind !== ts.ScriptElementKind.keyword && !e.name.startsWith('__dsh') && !e.name.startsWith('"') && e.name.startsWith(partial));
    entries.sort((a, b) => {
        if (!namespace) {
            const priority = Number(visible.has(b.name)) - Number(visible.has(a.name));
            if (priority) return priority;
        }
        const lexical = a.sortText.localeCompare(b.sortText);
        if (lexical) return lexical;
        const au = usage[identities[namespace + a.name] ?? ''];
        const bu = usage[identities[namespace + b.name] ?? ''];
        return (bu?.calls ?? 0) - (au?.calls ?? 0) || (bu?.lastUsed ?? 0) - (au?.lastUsed ?? 0) || a.name.localeCompare(b.name);
    });
    const candidates = entries.slice(0, 40).map(entry => {
        const detail = service.getCompletionEntryDetails(project.input, source.length, entry.name, {}, entry.source, {}, entry.data);
        const path = namespace + entry.name;
        const toolPath = environment.paths.some(tool => tool === path || tool.startsWith(`${path}.`));
        return {
            name: entry.name, path, kind: entry.kind,
            signature: toolPath && entry.name !== partial ? entry.name : ts.displayPartsToString(detail?.displayParts) || `${entry.name} (runtime member)`,
            documentation: ts.displayPartsToString(detail?.documentation),
        };
    });
    let help = service.getSignatureHelpItems(project.input, source.length, undefined);
    // A complete callable name requests its signature as if its opening parenthesis were present.
    const exact = partial && entries.some(entry => entry.name === partial);
    const signatureSource = !help && exact ? `${source}(` : source;
    if (signatureSource !== source) {
        project.prepare(signatureSource, bindings, environment.declarations);
        help = service.getSignatureHelpItems(project.input, signatureSource.length, undefined);
    }
    const signatures = help?.items.map(item => [
        ts.displayPartsToString(item.prefixDisplayParts) + item.parameters.map(p => ts.displayPartsToString(p.displayParts)).join(ts.displayPartsToString(item.separatorDisplayParts)) + ts.displayPartsToString(item.suffixDisplayParts),
        ts.displayPartsToString(item.documentation),
        ...item.parameters.map(p => { const doc = ts.displayPartsToString(p.documentation); return doc ? `${p.name}: ${doc}` : ''; }),
    ].filter(Boolean).join('\n')) ?? [];
    if (help) {
        const program = service.getProgram()!;
        const checker = program.getTypeChecker();
        const file = program.getSourceFile(project.input)!;
        let selected: ts.CallExpression | undefined;
        /** @brief Select the innermost call containing the signature-help cursor. */
        const visit = (node: ts.Node): void => {
            if (node.getStart(file) > signatureSource.length || node.end < signatureSource.length) return;
            if (ts.isCallExpression(node)) selected = node;
            ts.forEachChild(node, visit);
        };
        visit(file);
        const signature = selected && checker.getResolvedSignature(selected);
        for (const parameter of signature?.parameters ?? []) {
            const type = checker.getTypeOfSymbolAtLocation(parameter, selected!);
            for (const property of type.getProperties()) {
                const documentation = ts.displayPartsToString(property.getDocumentationComment(checker));
                if (documentation) signatures.push(`${parameter.name}.${property.name}: ${checker.typeToString(checker.getTypeOfSymbolAtLocation(property, selected!))} — ${documentation}`);
            }
        }
    }
    if (signatureSource !== source) project.prepare(source, bindings, environment.declarations);
    return { candidates, signatures, context: `IntelliSense:\nUse these names and signatures to continue the buffered executable TypeScript. Completion does not execute the code; finish the program so it can be parsed, compiled and executed. Return the desired result as the final expression.\nCursor source: ${JSON.stringify(source)}\n${actual ? `Names queried directly from the current VM context (${actual.length} members).\n` : ''}${entries.length > 40 ? `Showing 40 of ${entries.length} matching candidates; omitted names are not evidence of absence. Request a namespace followed by a dot for its members.\n` : ''}\n${candidates.map(c => `<!> ${c.path} ${c.signature}${c.documentation ? ` — ${c.documentation}` : ''}`).join('\n')}${signatures.length ? '\nArgument hints:\n' + signatures.join('\n') : ''}` };
}
