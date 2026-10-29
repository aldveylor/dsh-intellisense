import type { ToolAdditions } from './tool_additions/tool_additions.js';
import type { ToolsNamespace } from '../namespace/service.js';
import type { CommandStatistics } from '../statistics/command_statistics.js';
import type { Statistics } from '../statistics/statistics.js';
import type { SearchEngineRegistry } from '../search/engine_registry.js';

/** @brief Shared IntelliSense catalog, search engines and independent statistics collections. */
export interface Intellisense {
    readonly profiles: ToolsNamespace;
    readonly toolAdditions: ToolAdditions;
    readonly statistics: CommandStatistics;
    readonly inspectStatistics: Statistics;
    readonly searchEngines: SearchEngineRegistry;
}

/** @brief Expose the shared IntelliSense services to all inheriting plugin scopes. */
declare module '@deepseek-ai/cordis' {
    interface Context { intellisense: Intellisense }
}
