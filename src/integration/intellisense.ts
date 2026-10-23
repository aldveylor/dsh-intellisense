import type { CompletionQuery } from '../protocol/adapter.js';
import { declaration, type ManifestEntry } from './namespace.js';
import type { RuntimeHost } from '../runtime/host.js';
import { builtinCommands } from '../runtime/builtins.js';


/** @brief Optional completion capability consumed through the public Cordis service lookup. */
export interface IntellisenseService {
    complete(query: CompletionQuery, entries: ManifestEntry[]): Promise<{ kind: string; text: string }>;
}

declare module '@deepseek-ai/cordis' { interface Context { intellisense: IntellisenseService } }

/** @brief Read static tool signatures and side-effect-free runtime descriptors on demand. */
export async function intellisense(query: CompletionQuery, entries: ManifestEntry[], runtime: RuntimeHost): Promise<{ kind: string; text: string }> {
    query.signal.throwIfAborted();
    const path = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.?)\s*(?:\([^()]*)?$/.exec(query.prefix)?.[1] ?? '';
    const exact = entries.find(entry => entry.path === path);
    if (exact) return { kind: 'signature', text: declaration(exact) };
    const fixed = builtinCommands.find(command => command.path === path);
    if (fixed) return { kind: 'signature', text: `namespace ${fixed.path.split('.').slice(0, -1).join('.')} {\n/** @brief ${fixed.description} */\nfunction ${fixed.path.split('.').at(-1)}${fixed.signature.replace(' => ', ': ')};\n}` };
    const staticPaths = [...entries.map(entry => ({ path: entry.path, description: entry.doc })), ...builtinCommands];
    const prefix = path.endsWith('.') ? path : path.slice(0, path.lastIndexOf('.') + 1);
    const names = [...new Set(staticPaths.filter(entry => entry.path.startsWith(path)).map(entry => {
        const member = entry.path.slice(prefix.length).split('.')[0]!;
        const entryPath = prefix + member;
        return `${entryPath}${entry.path === entryPath ? ' — ' + entry.description : ''}`;
    }))];
    const description = query.sessionId ? await runtime.describe(query.sessionId, path.replace(/\.$/, ''), query.signal) : '';
    return { kind: 'members', text: [...names, description].filter(Boolean).join('\n') || 'No additional information.' };
}
