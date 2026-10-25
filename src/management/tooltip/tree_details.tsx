import type { ReactNode } from 'react';
import type { PhysicalTool } from '../../registry/registry.js';
import { useTranslation } from '../locale/locale.js';
import { ToolDetails, ToolStatistics } from '../tool_picker/tool_details.js';
import { TooltipProvider, useTooltip } from './tooltip.js';

/** @brief Bind pointer and keyboard access to one shared tree tooltip. */
export function useTreeTooltip(content: ReactNode) {
    const tooltip = useTooltip();
    return {
        'aria-describedby': tooltip.id,
        onPointerEnter: (event: React.PointerEvent<HTMLElement>) => tooltip.show(content, event.clientX, event.clientY),
        onPointerMove: (event: React.PointerEvent<HTMLElement>) => tooltip.move(event.clientX, event.clientY, event.altKey),
        onPointerLeave: tooltip.leave,
        onFocus: (event: React.FocusEvent<HTMLElement>) => {
            const rect = event.currentTarget.getBoundingClientRect();
            tooltip.show(content, rect.left, rect.bottom);
        },
        onBlur: tooltip.leave,
        onClick: tooltip.hide,
        onDoubleClick: tooltip.hide,
        onDragStartCapture: tooltip.hide,
    };
}

/** @brief Namespace documentation includes both its local name and complete path. */
export function NamespaceDetails({ path, description }: { path: string; description: string }) {
    const t = useTranslation();
    return <article className="ts-tree-details">
        <h3><code>{path.split('.').at(-1)}</code></h3>
        <p className="ts-detail-path"><code>{path}</code></p>
        <p>{description || t('tool_no_description')}</p>
    </article>;
}

/** @brief Original physical identity opens the same details used by tool cards. */
function OriginalCommand({ tool, calls }: { tool: PhysicalTool; calls: number }) {
    const anchor = useTreeTooltip(<ToolDetails tool={tool} calls={calls} />);
    return <code className="ts-original-command" tabIndex={0} {...anchor}>{tool.id}</code>;
}

/** @brief Show the mapped command, summary, full documentation and physical call totals. */
export function CommandDetails({ path, tool, summary, calls }: { path: string; tool: PhysicalTool; summary: string; calls: number }) {
    const t = useTranslation();
    return <article className="ts-tool-details ts-command-details">
        <header className="ts-tool-detail-header"><h3><code>{path.split('.').at(-1)}</code>
            <small className="ts-command-namespace">{path.split('.').slice(0, -1).join('.') || t('root')}</small>
        </h3></header>
        <section><h4>{t('original_command')}</h4>
            <TooltipProvider><OriginalCommand tool={tool} calls={calls} /></TooltipProvider>
        </section>
        <section><h4>{t('command_summary')}</h4><p>{summary || t('tool_no_description')}</p></section>
        <section><h4>{t('command_documentation')}</h4><p>{tool.description || t('tool_no_description')}</p></section>
        <ToolStatistics calls={calls} />
    </article>;
}
