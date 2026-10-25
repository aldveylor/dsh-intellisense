import { useTranslation } from '../locale/locale.js';
import { useEffect, useRef, useState } from 'react';
import { TooltipProvider, useTooltip } from '../tooltip/tooltip.js';
import { NativeProfileSelect } from '../profile_picker/native_profile_select.js';
import { ToolDetails } from './tool_details.js';
import type { Mapping, PhysicalTool } from '../../registry/registry.js';

/** @brief One tool card with its binding path and shared pointer-following details. */
function ToolCard({ tool, mapping, builtinPath, calls, busy, select }: {
    tool: PhysicalTool; mapping?: Mapping; builtinPath?: string; calls: number; busy: boolean; select: (tool: PhysicalTool) => void;
}) {
    const t = useTranslation();
    const tooltip = useTooltip();
    return <button type="button" data-tool-id={tool.id} aria-describedby={tooltip.id}
        className={`ts-tool ${builtinPath ? 'ts-builtin-tool' : mapping?.path.trim() ? '' : 'ts-unmounted'}`} disabled={busy || !!builtinPath || mapping?.pinned}
        onPointerEnter={event => tooltip.show(<ToolDetails tool={tool} calls={calls} />, event.clientX, event.clientY)}
        onPointerMove={event => tooltip.move(event.clientX, event.clientY, event.altKey)} onPointerLeave={tooltip.leave}
        onFocus={event => {
            const rect = event.currentTarget.getBoundingClientRect();
            tooltip.show(<ToolDetails tool={tool} calls={calls} />, rect.left, rect.bottom);
        }} onBlur={tooltip.leave} onClick={() => { if (!builtinPath && !busy && !mapping?.pinned) { tooltip.hide(); select(tool); } }}>
        <strong>{tool.id}</strong>
        <code className="ts-tool-footer">{builtinPath || mapping?.path || t('unmounted')}</code>
    </button>;
}

/** @brief Modal tool blocks that mount the selected physical tool into the requested namespace. */
export function ToolPicker({ parent, tools, mappings, protectedTools = [], callsByTool = {}, busy, select, close }: {
    parent: string; tools: PhysicalTool[]; mappings: Mapping[]; protectedTools?: Array<{ tool: PhysicalTool; path: string }>; callsByTool?: Record<string, number>; busy: boolean;
    select: (tool: PhysicalTool) => void; close: () => void;
}) {
    const t = useTranslation();
    const dialog = useRef<HTMLDialogElement>(null);
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState('default');
    const totalCalls = Object.values(callsByTool).reduce((total, count) => total + count, 0);
    const filter = search.trim().toLowerCase();
    const protectedIds = new Set(protectedTools.map(entry => entry.tool.id));
    const matches = [...tools.filter(tool => !protectedIds.has(tool.id) && !['exec', 'run_code', 'tools_run_code'].includes(tool.id)), ...protectedTools.map(entry => entry.tool)].filter(tool => {
        const mapping = mappings.find(m => m.id === tool.id);
        return `${tool.id} ${mapping?.path ?? ''} ${mapping?.aliases.join(' ') ?? ''} ${tool.description} ${mapping?.description ?? ''}`.toLowerCase().includes(filter);
    });
    if (sort !== 'default') matches.sort((a, b) => {
        const byName = a.id.localeCompare(b.id);
        if (sort === 'name_asc') return byName;
        if (sort === 'name_desc') return -byName;
        const difference = (callsByTool[a.id] ?? 0) - (callsByTool[b.id] ?? 0);
        return (sort === 'calls_asc' ? difference : -difference) || byName;
    });

    useEffect(() => { dialog.current?.showModal(); }, []);

    return <dialog ref={dialog} className="ts-tool-picker" aria-labelledby="ts-tool-picker-title" onClose={close}
        onClick={event => {
            if (event.target !== event.currentTarget) return;
            const rect = event.currentTarget.getBoundingClientRect();
            if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
        }}>
        <TooltipProvider><header><h2 id="ts-tool-picker-title">{t('add_tools')} · {parent || t('root')}</h2>
            <button type="button" aria-label={t('close_picker')} onClick={close}>{t('close')}</button>
        </header>
        <div className="ts-tool-picker-search">
            <input type="search" autoFocus aria-label={t('search_tools')} placeholder={t('search_hint')} value={search} onChange={event => setSearch(event.target.value)} />
            <div className="ts-tool-picker-sort"><NativeProfileSelect label={t('tool_sort')} value={sort}
                options={['default', 'name_asc', 'name_desc', 'calls_desc', 'calls_asc'].map(value => ({ value, label: t(`tool_sort_${value}`) }))}
                disabled={busy} readOnly closeOnSelect onChange={setSort} /></div>
        </div>
        <div className="ts-blocks">{matches.map(tool => <ToolCard key={tool.id} tool={tool}
            mapping={mappings.find(mapping => mapping.id === tool.id)} builtinPath={protectedTools.find(entry => entry.tool.id === tool.id)?.path} calls={callsByTool[tool.id] ?? 0} busy={busy} select={select} />)}</div>
        {!matches.length && <p>{filter ? t('no_matches') : t('no_tools')}</p>}
        <footer className="ts-tool-picker-footer">
            <small>{t('tool_count', { count: matches.length })}</small>
            <small>{t('tool_all_calls_label', { count: totalCalls })}</small>
        </footer>
        </TooltipProvider>
    </dialog>;
}
