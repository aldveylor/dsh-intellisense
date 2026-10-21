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
    const visible = new Set([...environment.paths.map(path => path.split('.')[0]!), ...bindings.map(binding => binding.name), 'Promise', 'console', 'tools']);
    const entries = (result?.entries ?? []).filter(e => e.kind !== ts.ScriptElementKind.keyword && !e.name.startsWith('__dsh') && !e.name.startsWith('"') && e.name.startsWith(partial));
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
        return {
            name: entry.name, path: namespace + entry.name, kind: entry.kind,
            signature: ts.displayPartsToString(detail?.displayParts),
            documentation: ts.displayPartsToString(detail?.documentation),
        };
    });
    const help = service.getSignatureHelpItems(project.input, source.length, undefined);
    const signatures = help?.items.map(item => ts.displayPartsToString(item.prefixDisplayParts) + item.parameters.map(p => ts.displayPartsToString(p.displayParts)).join(ts.displayPartsToString(item.separatorDisplayParts)) + ts.displayPartsToString(item.suffixDisplayParts)) ?? [];
    return { candidates, signatures, context: `IntelliSense:\nCursor source: ${JSON.stringify(source)}\n${entries.length > 40 ? `Showing 40 of ${entries.length} matching candidates; omitted names are not evidence of absence. Request a namespace followed by a dot for its members.\n` : ''}\n${candidates.map(c => `<!> ${c.path} ${c.signature}${c.documentation ? ` — ${c.documentation}` : ''}`).join('\n')}${signatures.length ? '\nArgument hints:\n' + signatures.join('\n') : ''}` };
}
