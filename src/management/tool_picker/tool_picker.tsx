import { ActionButton } from '../controls/action_button.js';
import { useTranslation } from '../locale/locale.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { TooltipProvider, useTooltip } from '../tooltip/tooltip.js';
import { NativeProfileSelect } from '../profile_picker/native_profile_select.js';
import { ToolDetails } from './tool_details.js';
import type { Mapping, PhysicalTool } from '../../registry/registry.js';
import { reservedToolIds } from '../../runtime/builtins.js';

/** @brief One tool card with its binding path and shared pointer-following details. */
function ToolCard({ tool, mappings, builtinPath, calls, queries, busy, select }: {
    tool: PhysicalTool; mappings: Mapping[]; builtinPath?: string; calls: number; queries: number; busy: boolean; select: (tool: PhysicalTool) => void;
}) {
    const t = useTranslation();
    const tooltip = useTooltip();
    return <button type="button" data-tool-id={tool.id} aria-describedby={tooltip.id}
        className={`ts-tool ${builtinPath ? 'ts-builtin-tool' : mappings.length ? '' : 'ts-unmounted'}`} disabled={busy || !!builtinPath}
        onPointerEnter={event => tooltip.show(<><p>{t(builtinPath ? 'builtin_tool_card_hint' : 'add_tool_card_hint')}</p><ToolDetails tool={tool} calls={calls} queries={queries} /></>, event.clientX, event.clientY)}
        onPointerMove={event => tooltip.move(event.clientX, event.clientY, event.ctrlKey)} onPointerLeave={tooltip.leave}
        onFocus={event => {
            const rect = event.currentTarget.getBoundingClientRect();
            tooltip.show(<><p>{t(builtinPath ? 'builtin_tool_card_hint' : 'add_tool_card_hint')}</p><ToolDetails tool={tool} calls={calls} queries={queries} /></>, rect.left, rect.bottom);
        }} onBlur={tooltip.leave} onClick={() => { if (!builtinPath && !busy) { tooltip.hide(); select(tool); } }}>
        <strong>{tool.id}</strong>
        <code className="ts-tool-footer">{builtinPath || mappings.map(mapping => mapping.path).join(', ') || t('unmounted')}</code>
    </button>;
}

const emptyProtectedTools: Array<{ tool: PhysicalTool; path: string }> = [];

/** @brief Modal tool blocks that mount the selected physical tool into the requested namespace. */
export function ToolPicker({ parent, tools, mappings, protectedTools = emptyProtectedTools, callsByTool = {}, queriesByTool = {}, busy, select, close }: {
    parent: string; tools: PhysicalTool[]; mappings: Mapping[]; protectedTools?: Array<{ tool: PhysicalTool; path: string }>; callsByTool?: Record<string, number>; queriesByTool?: Record<string, number>; busy: boolean;
    select: (tool: PhysicalTool) => void; close: () => void;
}) {
    const t = useTranslation();
    const dialog = useRef<HTMLDialogElement>(null);
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState('default');
    const [descending, setDescending] = useState(false);
    const totalCalls = Object.values(callsByTool).reduce((total, count) => total + count, 0);
    const filter = search.trim().toLowerCase();
    const { cards, mappingsByTool, protectedPaths } = useMemo(() => {
        const mappingsByTool = new Map<string, Mapping[]>();
        for (const mapping of mappings) {
            const group = mappingsByTool.get(mapping.id);
            if (group) group.push(mapping);
            else mappingsByTool.set(mapping.id, [mapping]);
        }
        const protectedPaths = new Map(protectedTools.map(entry => [entry.tool.id, entry.path]));
        const cards = [...tools.filter(tool => !protectedPaths.has(tool.id) && !reservedToolIds.includes(tool.id)), ...protectedTools.map(entry => entry.tool)].map(tool => {
            const mounts = mappingsByTool.get(tool.id) ?? [];
            return { tool, search: `${tool.id} ${mounts.map(mapping => mapping.path).join(' ')} ${tool.description} ${mounts.map(mapping => mapping.description ?? '').join(' ')}`.toLowerCase() };
        });
        return { cards, mappingsByTool, protectedPaths };
    }, [tools, mappings, protectedTools]);
    const matches = cards.filter(card => card.search.includes(filter)).map(card => card.tool);
    if (sort !== 'default') matches.sort((a, b) => {
        const byName = a.id.localeCompare(b.id);
        if (sort === 'name') return descending ? -byName : byName;
        const counts = sort === 'queries' ? queriesByTool : callsByTool;
        const difference = (counts[a.id] ?? 0) - (counts[b.id] ?? 0);
        return (descending ? -difference : difference) || byName;
    });

    useEffect(() => { dialog.current?.showModal(); }, []);

    return <dialog ref={dialog} className="ts-tool-picker" aria-labelledby="ts-tool-picker-title" onClose={close}
        onClick={event => {
            if (event.target !== event.currentTarget) return;
            const rect = event.currentTarget.getBoundingClientRect();
            if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
        }}>
        <TooltipProvider><header><h2 id="ts-tool-picker-title">{t('add_tools')} · {parent || t('root')}</h2>
            <ActionButton variant="ghost" type="button" aria-label={t('close_picker')} title={t('close_picker_hint')} onClick={close}>{t('close')}</ActionButton>
        </header>
        <div className="ts-tool-picker-search">
            <input type="search" autoFocus aria-label={t('search_tools')} placeholder={t('search_hint')} value={search} onChange={event => setSearch(event.target.value)} />
            <div className="ts-tool-picker-sort"><NativeProfileSelect label={t('tool_sort')} hint={t('sort_tools_hint')} value={sort}
                options={['default', 'name', 'calls', 'queries'].map(value => ({ value, label: t(`tool_sort_${value}`) }))}
                disabled={busy} readOnly closeOnSelect onChange={setSort} /></div>
            <ActionButton className="ts-tool-sort-direction" type="button" aria-label={t('tool_sort_descending')}
                aria-pressed={descending} title={t(descending ? 'tool_sort_descending' : 'tool_sort_ascending')}
                disabled={busy || sort === 'default'} onClick={() => setDescending(value => !value)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d={descending ? 'M7 4v16m-4-4 4 4 4-4M14 6h7m-7 6h5m-5 6h3' : 'M7 20V4m-4 4 4-4 4 4M14 6h3m-3 6h5m-5 6h7'} />
                </svg>
            </ActionButton>
        </div>
        <div className="ts-blocks">{matches.map(tool => <ToolCard key={tool.id} tool={tool}
            mappings={mappingsByTool.get(tool.id) ?? []} builtinPath={protectedPaths.get(tool.id)} calls={callsByTool[tool.id] ?? 0} queries={queriesByTool[tool.id] ?? 0} busy={busy} select={select} />)}</div>
        {!matches.length && <p>{filter ? t('no_matches') : t('no_tools')}</p>}
        <footer className="ts-tool-picker-footer">
            <small>{t('tool_count', { count: matches.length })}</small>
            <small>{t('tool_all_calls_label', { count: totalCalls })}</small>
        </footer>
        </TooltipProvider>
    </dialog>;
}
