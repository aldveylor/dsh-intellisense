import { useRef, type ReactNode } from 'react';
import type { PhysicalTool } from '../../../registry/registry.js';
import { useTranslation } from '../../locale/locale.js';
import { ToolDetails, ToolStatistics } from '../../tool_picker/tool_details.js';
import { TooltipProvider, useTooltip } from '../../ui/tooltip/tooltip.js';

/** @brief Bind pointer and keyboard access to one shared tree tooltip. */
export function useTreeTooltip(content: ReactNode) {
    const tooltip = useTooltip();
    const pointerFocus = useRef(false);

    return {
        'aria-describedby': tooltip.id,
        onPointerEnter: (event: React.PointerEvent<HTMLElement>) => tooltip.show(content, event.clientX, event.clientY),
        onPointerMove: (event: React.PointerEvent<HTMLElement>) => tooltip.move(event.clientX, event.clientY, event.ctrlKey),
        onPointerLeave: tooltip.leave,
        onPointerDownCapture: () => { pointerFocus.current = true; tooltip.hide(); },
        onKeyDownCapture: () => { pointerFocus.current = false; },
        onFocus: (event: React.FocusEvent<HTMLElement>) => {
            if (pointerFocus.current) return;
            const rect = event.currentTarget.getBoundingClientRect();
            tooltip.show(content, rect.left, rect.bottom);
        },
        onBlur: (event: React.FocusEvent<HTMLElement>) => {
            if (!event.currentTarget.contains(event.relatedTarget)) pointerFocus.current = false;
            tooltip.leave();
        },
        onClick: tooltip.hide,
        onDoubleClick: tooltip.hide,
        onDragStartCapture: tooltip.hide,
    };
}

/** @brief Namespace documentation includes both its local name and complete path. */
export function NamespaceDetails({ path, description, queries = 0 }: { path: string; description: string; queries?: number }) {
    const t = useTranslation();
    return <article className="ts-tree-details ts-tool-details">
        <h3><code>{path.split('.').at(-1)}</code></h3>
        <p className="ts-detail-path"><code>{path}</code></p>
        <p>{description || t('tool_no_description')}</p>
        <ToolStatistics queries={queries} />
    </article>;
}

/** @brief Original physical identity opens the same details used by tool cards. */
function OriginalCommand({ tool, calls, queries }: { tool: PhysicalTool; calls: number; queries: number }) {
    const anchor = useTreeTooltip(<ToolDetails tool={tool} calls={calls} queries={queries} />);
    return <code className="ts-original-command" tabIndex={0} {...anchor}>{tool.id}</code>;
}

/** @brief Show the mapped command, summary, full documentation and physical call totals. */
export function CommandDetails({ path, tool, summary, calls, queries = 0 }: { path: string; tool: PhysicalTool; summary: string; calls: number; queries?: number }) {
    const t = useTranslation();
    return <article className="ts-tool-details ts-command-details">
        <header className="ts-tool-detail-header"><h3><code>{path.split('.').at(-1)}</code>
            <small className="ts-command-namespace">{path.split('.').slice(0, -1).join('.') || t('root')}</small>
        </h3></header>
        <section><h4>{t('original_command')}</h4>
            <TooltipProvider><OriginalCommand tool={tool} calls={calls} queries={queries} /></TooltipProvider>
        </section>
        <section><h4>{t('command_summary')}</h4><p>{summary.trim() || t('command_no_summary')}</p></section>
        <section><h4>{t('command_documentation')}</h4><p>{tool.description || t('tool_no_description')}</p></section>
        <ToolStatistics calls={calls} queries={queries} />
    </article>;
}
