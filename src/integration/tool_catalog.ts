import type { PhysicalTool } from '../profile/catalog/registry.js';
import { ToolAdditions } from './tool_additions/tool_additions.js';

/** @brief Physical tool metadata consumed by execution integration independently of Profile storage. */
export interface ToolCatalog {
    readonly generation: string;
    readonly toolAdditions: ToolAdditions;
    /** @brief Replace the physical catalog from the currently available scopes. */
    refresh(tools: PhysicalTool[]): void;
    /** @brief Read detached physical tool metadata. */
    tools(): PhysicalTool[];
}

/** @brief Own physical contracts and tool metadata without depending on Profile persistence. */
export class PhysicalToolCatalog implements ToolCatalog {
    readonly toolAdditions = new ToolAdditions();
    private entries: PhysicalTool[] = [];
    private fingerprint = '';
    private revision = 0;

    get generation(): string { return `${this.revision}:${this.toolAdditions.revision}`; }

    refresh(tools: PhysicalTool[]): void {
        if (new Set(tools.map(tool => tool.id)).size !== tools.length) throw new Error('Duplicate physical tool identity');
        const fingerprint = JSON.stringify(tools);
        if (fingerprint === this.fingerprint) return;
        this.fingerprint = fingerprint;
        this.revision++;
        this.entries = structuredClone(tools);
    }

    tools(): PhysicalTool[] {
        return structuredClone(this.entries.filter(tool => !this.toolAdditions.get(tool.id).hidden).map(tool => ({ ...tool,
            addition: this.toolAdditions.get(tool.id),
        })));
    }
}
