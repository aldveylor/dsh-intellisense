import { useEffect, useRef, useState } from 'react';
import type { Mapping, PhysicalTool } from '../../registry/registry.js';

/** @brief Modal tool blocks that mount the selected physical tool into the requested namespace. */
export function ToolPicker({ parent, tools, mappings, busy, select, close }: {
    parent: string; tools: PhysicalTool[]; mappings: Mapping[]; busy: boolean;
    select: (tool: PhysicalTool) => void; close: () => void;
}) {
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
        <header><h2 id="ts-tool-picker-title">添加工具 · {parent || '根节点'}</h2>
            <button type="button" aria-label="关闭工具选择" onClick={close}>关闭</button>
        </header>
        <input type="search" autoFocus aria-label="搜索工具" placeholder="搜索名称、路径或描述" value={search} onChange={event => setSearch(event.target.value)} />
        <small>单击积木添加到当前节点 · {matches.length} 个工具</small>
        <div className="ts-blocks">{matches.map(tool => {
            const mapping = mappings.find(m => m.id === tool.id);
            return <button key={tool.id} type="button" title={tool.description} data-tool-id={tool.id}
                className={`ts-tool ${mapping?.path.trim() ? '' : 'ts-unmounted'}`} disabled={busy || mapping?.pinned}
                onClick={() => select(tool)}>
                <strong>{tool.id}</strong><code>{mapping?.path || '未挂载'}</code>
            </button>;
        })}</div>
        {!matches.length && <p>{filter ? '没有匹配的工具。' : '当前没有可用工具。'}</p>}
    </dialog>;
}
