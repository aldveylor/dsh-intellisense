import { SortDirectionIcon } from './sort_direction_icon.js';
import { ActionHint } from '../tooltip/action_hint.js';
import { ActionButton } from '../controls/action_button.js';
import { CloseButton } from '../controls/close_button.js';
import { useTranslation } from '../locale/locale.js';
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { TooltipProvider, useTooltip } from '../tooltip/tooltip.js';
import { ToolFilter, toolCategories } from './tool_filter/tool_filter.js';
import { usePickerPreferences } from './session_preferences.js';
import { ToolLayout } from './tool_layout/tool_layout.js';
import { ToolDetails } from './tool_details.js';
import type { Mapping, PhysicalTool } from '../../registry/registry.js';
import { reservedToolIds } from '../../runtime/builtins.js';

/** @brief One tool card with its binding path and shared pointer-following details. */
function ToolCard({ tool, mappings, builtinPath, calls, queries, busy, select, detailed = false }: {
    detailed?: boolean; tool: PhysicalTool; mappings: Mapping[]; builtinPath?: string; calls: number; queries: number; busy: boolean; select: (tool: PhysicalTool) => void;
}) {
    const t = useTranslation();
    const tooltip = useTooltip();
    const pointerHandlers = {
        onPointerEnter: (event: PointerEvent<HTMLElement>) => tooltip.show(<><ActionHint action={t('add_tools')} description={t(builtinPath ? 'builtin_tool_card_hint' : 'add_tool_card_hint')} /><ToolDetails tool={tool} calls={calls} queries={queries} /></>, event.clientX, event.clientY),
        onPointerMove: (event: PointerEvent<HTMLElement>) => tooltip.move(event.clientX, event.clientY, event.ctrlKey),
        onPointerLeave: tooltip.leave,
    };
    return <button type="button" data-tool-id={tool.id} aria-describedby={detailed ? undefined : tooltip.id}
        className={`ts-tool ${builtinPath ? 'ts-builtin-tool' : mappings.length ? '' : 'ts-unmounted'}`} disabled={busy || !!builtinPath}
        {...(detailed ? {} : pointerHandlers)}
        onFocus={event => {
            if (detailed) return;
            const rect = event.currentTarget.getBoundingClientRect();
            tooltip.show(<><ActionHint action={t('add_tools')} description={t(builtinPath ? 'builtin_tool_card_hint' : 'add_tool_card_hint')} /><ToolDetails tool={tool} calls={calls} queries={queries} /></>, rect.left, rect.bottom);
        }} onBlur={tooltip.leave} onClick={() => { if (!builtinPath && !busy) { tooltip.hide(); select(tool); } }}>
        {detailed ? <>
            <span className="ts-tool-list-main">
                <span className="ts-tool-list-title"><strong aria-describedby={tooltip.id} {...pointerHandlers}>{tool.id}</strong><code className="ts-tool-footer">{builtinPath || mappings.map(mapping => mapping.path).join('; ') || t('unmounted')}</code></span>
                <span className="ts-tool-list-description">{tool.description || t('tool_no_description')}</span>
            </span>
            <span className="ts-tool-list-source">{tool.source?.trim() || t('tool_source_unknown')}</span>
            <span className="ts-tool-list-count">{calls}</span><span className="ts-tool-list-count">{queries}</span>
        </> : <><strong>{tool.id}</strong><code className="ts-tool-footer">{builtinPath || mappings.map(mapping => mapping.path).join('; ') || t('unmounted')}</code></>}

    </button>;
}

const emptyProtectedTools: Array<{ tool: PhysicalTool; path: string }> = [];

/** @brief Modal tool blocks that mount the selected physical tool into the requested namespace. */
export function ToolPicker({ parent, tools, mappings, unmountedOnly = false, protectedTools = emptyProtectedTools, callsByTool = {}, queriesByTool = {}, busy, select, close }: {
    parent: string; tools: PhysicalTool[]; mappings: Mapping[]; unmountedOnly?: boolean; protectedTools?: Array<{ tool: PhysicalTool; path: string }>; callsByTool?: Record<string, number>; queriesByTool?: Record<string, number>; busy: boolean;
    select: (tool: PhysicalTool) => void; close: () => void;
}) {
    const t = useTranslation();
    const dialog = useRef<HTMLDialogElement>(null);
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState('default');
    const [descending, setDescending] = useState(false);
    const [{ grouping, view, categories }, setPreferences] = usePickerPreferences(unmountedOnly);
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
    const matches = cards.filter(card => {
        const category = protectedPaths.has(card.tool.id) ? 'fixed' : mappingsByTool.has(card.tool.id) ? 'mounted' : 'unmounted';
        return categories.includes(category) && card.search.includes(filter);
    }).map(card => card.tool);
    if (sort !== 'default') matches.sort((a, b) => {
        const byName = a.id.localeCompare(b.id);
        if (sort === 'name') return descending ? -byName : byName;
        const counts = sort === 'queries' ? queriesByTool : callsByTool;
        const difference = (counts[a.id] ?? 0) - (counts[b.id] ?? 0);
        return (descending ? -difference : difference) || byName;
    });

    const groups = new Map<string, PhysicalTool[]>();
    for (const tool of matches) {
        const key = grouping === 'type' ? (protectedPaths.has(tool.id) ? 'fixed' : mappingsByTool.has(tool.id) ? 'mounted' : 'unmounted')
            : grouping === 'source' ? tool.source?.trim() || '' : '';
        const group = groups.get(key);
        if (group) group.push(tool);
        else groups.set(key, [tool]);
    }
    const orderedGroups = grouping === 'type' ? toolCategories.filter(key => groups.has(key)).map(key => [key, groups.get(key)!] as const)
        : grouping === 'source' ? [...groups].sort(([a], [b]) => a ? b ? a.localeCompare(b) : -1 : 1) : [...groups];

    useEffect(() => { dialog.current?.showModal(); }, []);

    return <dialog ref={dialog} className="ts-tool-picker" aria-labelledby="ts-tool-picker-title" onClose={close}
        onClick={event => {
            if (event.target !== event.currentTarget) return;
            const rect = event.currentTarget.getBoundingClientRect();
            if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
        }}>
        <TooltipProvider><header><h2 id="ts-tool-picker-title">{t('add_tools')} <span className="ts-tool-picker-path">· {parent || t('root')}</span></h2>
            <CloseButton close={close} label={t('close_picker')} hint={t('close_picker_hint')} />
        </header>
        <div className="ts-tool-picker-search">
            <input type="search" autoFocus aria-label={t('search_tools')} placeholder={t('search_hint')} value={search} onChange={event => setSearch(event.target.value)} />
            <ToolLayout kind="sort" value={sort} options={['default', 'name', 'calls', 'queries']} disabled={busy} onChange={setSort} />
            <ActionButton className="ts-tool-sort-direction" type="button" aria-label={t(descending ? 'tool_sort_ascending' : 'tool_sort_descending')}
                aria-pressed={descending} title={t(descending ? 'sort_descending_hint' : 'sort_ascending_hint')}
                disabled={busy || sort === 'default'} onClick={() => setDescending(value => !value)}>
                <SortDirectionIcon valid={!busy && sort !== 'default'} descending={descending} />
            </ActionButton>
            <ToolFilter value={categories} disabled={busy} onChange={categories => setPreferences(current => ({ ...current, categories }))} />
            <ToolLayout kind="group" value={grouping} options={['none', 'type', 'source']} disabled={busy} onChange={grouping => setPreferences(current => ({ ...current, grouping }))} />
            <ToolLayout kind="view" value={view} options={['cards', 'list']} disabled={busy} onChange={view => setPreferences(current => ({ ...current, view }))} />
        </div>
        <div className="ts-tool-results" data-view={view}>
            {!matches.length && <p>{filter || categories.length !== toolCategories.length ? t('no_matches') : t('no_tools')}</p>}
            {view === 'list' && <div className="ts-tool-list-heading" aria-hidden="true">
                {['tool_name', 'tool_source', 'tool_total_calls', 'tool_total_queries'].map(key => <span key={key}>{t(key)}</span>)}
            </div>}
            {orderedGroups.map(([key, group]) => <section key={key} className="ts-tool-group-section" aria-label={grouping === 'none' ? undefined : grouping === 'type' ? t(`tool_filter_${key}`) : key || t('tool_source_unknown')}>
                {grouping !== 'none' && <h3 className="ts-tool-group-heading">{grouping === 'type' ? t(`tool_filter_${key}`) : key || t('tool_source_unknown')} <small>({group.length})</small></h3>}
                <div className={view === 'list' ? 'ts-tool-list' : 'ts-blocks'}>{group.map(tool => <ToolCard key={tool.id} tool={tool} detailed={view === 'list'}
                    mappings={mappingsByTool.get(tool.id) ?? []} builtinPath={protectedPaths.get(tool.id)} calls={callsByTool[tool.id] ?? 0} queries={queriesByTool[tool.id] ?? 0} busy={busy} select={select} />)}</div>
            </section>)}
        </div>
        <footer className="ts-tool-picker-footer">
            <small>{t('tool_count', { count: matches.length })}</small>
            <small>{t('tool_all_calls_label', { count: totalCalls })}</small>
        </footer>
        </TooltipProvider>
    </dialog>;
}
