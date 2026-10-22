import { useTranslation } from '../locale/locale.js';
import { useEffect, useRef, useState } from 'react';
import type { Mapping, PhysicalTool } from '../../registry/registry.js';

/** @brief Modal tool blocks that mount the selected physical tool into the requested namespace. */
export function ToolPicker({ parent, tools, mappings, busy, select, close }: {
    parent: string; tools: PhysicalTool[]; mappings: Mapping[]; busy: boolean;
    select: (tool: PhysicalTool) => void; close: () => void;
}) {
    const t = useTranslation();
    const dialog = useRef<HTMLDialogElement>(null);
    const [search, setSearch] = useState('');
    const filter = search.trim().toLowerCase();
    const matches = tools.filter(tool => {
        const mapping = mappings.find(m => m.id === tool.id);
        return `${tool.id} ${mapping?.path ?? ''} ${mapping?.aliases.join(' ') ?? ''} ${tool.description} ${mapping?.description ?? ''}`.toLowerCase().includes(filter);
    });

    useEffect(() => { dialog.current?.showModal(); }, []);

    return <dialog ref={dialog} className="ts-tool-picker" aria-labelledby="ts-tool-picker-title" onClose={close}
        onClick={event => {
            if (event.target !== event.currentTarget) return;
            const rect = event.currentTarget.getBoundingClientRect();
            if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
        }}>
        <header><h2 id="ts-tool-picker-title">{t('add_tools')} · {parent || t('root')}</h2>
            <button type="button" aria-label={t('close_picker')} onClick={close}>{t('close')}</button>
        </header>
        <input type="search" autoFocus aria-label={t('search_tools')} placeholder={t('search_hint')} value={search} onChange={event => setSearch(event.target.value)} />
        <small>{t('tool_count', { count: matches.length })}</small>
        <div className="ts-blocks">{matches.map(tool => {
            const mapping = mappings.find(m => m.id === tool.id);
            return <button key={tool.id} type="button" title={tool.description} data-tool-id={tool.id}
                className={`ts-tool ${mapping?.path.trim() ? '' : 'ts-unmounted'}`} disabled={busy || mapping?.pinned}
                onClick={() => select(tool)}>
                <strong>{tool.id}</strong><code>{mapping?.path || t('unmounted')}</code>
            </button>;
        })}</div>
        {!matches.length && <p>{filter ? t('no_matches') : t('no_tools')}</p>}
    </dialog>;
}
