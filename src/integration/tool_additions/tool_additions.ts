import { ptcToolName } from '../../runtime/builtins.js';

/** @brief Physical-tool metadata independent of Profile structure and builtin command behavior. */
export interface ToolAddition {
    hidden?: boolean;
    ptcDescription?: string;
}

/** @brief Shared, disposable metadata layers exposed through ctx.intellisense.toolAdditions. */
export class ToolAdditions {
    private entries = new Map<string, Map<object, ToolAddition>>();
    revision = 0;

    constructor() { for (const tool of ['exec', 'run_code', ptcToolName]) this.set(tool, { hidden: true }); }

    /** @brief Merge layers in registration order, without retaining caller-owned objects. */
    get(tool: string): ToolAddition { return Object.assign({}, ...this.entries.get(tool)?.values() ?? []); }

    /** @brief Add a reversible layer; disposing it reveals previous metadata. */
    set(tool: string, addition: ToolAddition): () => void {
        if (!tool.trim() || Object.keys(addition).some(key => !['hidden', 'ptcDescription'].includes(key))
            || (addition.hidden !== undefined && typeof addition.hidden !== 'boolean')
            || (addition.ptcDescription !== undefined && typeof addition.ptcDescription !== 'string')) throw new Error('Invalid tool addition');
        const token = {};
        let layers = this.entries.get(tool);
        if (!layers) this.entries.set(tool, layers = new Map());
        layers.set(token, { ...addition });
        this.revision++;
        return () => { if (layers.delete(token)) { if (!layers.size) this.entries.delete(tool); this.revision++; } };
    }
}
