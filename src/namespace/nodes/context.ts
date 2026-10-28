import type { PresentationMode } from '../../integration/presentation.js';
import type { PhysicalTool } from '../../registry/registry.js';

/** @brief Scoped construction inputs; queries never synthesize or replace nodes. */
export interface NamespaceContext {
    mode?: PresentationMode;
    tools: readonly PhysicalTool[];
    disabled?: (path: string) => boolean;
    includeUnavailable?: boolean;
}

