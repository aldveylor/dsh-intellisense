import { AddIcon } from '../../ui/icons/icons.js';
import { useState, type DragEvent } from 'react';
import { HintButton } from '../../ui/tooltip/action_hint.js';
import { useTranslation } from '../../locale/locale.js';

/** @brief Name a child namespace inline; empty names and Escape discard the pending entry. */
export function NamespacePlaceholder({ parent = '', busy, create, drop, pick }: {
    parent?: string; busy: boolean; create: (path: string) => boolean; pick: (parent: string) => void;
    drop?: (event: DragEvent<HTMLElement>, parent: string) => void;
}) {
    const t = useTranslation();
    const [name, setName] = useState<string>();
    const [over, setOver] = useState(false);

    /** @brief Start naming without changing the persisted namespace draft. */
    function begin(): void {
        if (!busy) setName('');
    }

    return <li data-namespace-path={parent} className={`ts-empty ts-namespace-placeholder ${over ? 'ts-drop-over' : ''}`}
        onDragOver={event => {
            if (!busy && event.dataTransfer.types.some(type => ['application/x-ts-tool', 'application/x-ts-namespace'].includes(type))) {
                event.preventDefault(); event.stopPropagation(); setOver(true);
            }
        }} onDragLeave={() => setOver(false)} onDrop={event => {
            event.preventDefault(); event.stopPropagation(); setOver(false);
            if (!busy) drop?.(event, parent);
        }}>
        {name === undefined ? <span role="button" tabIndex={busy ? -1 : 0} aria-disabled={busy}
            title={t('add_namespace')} onDoubleClick={begin} onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); begin(); }
            }}>{parent ? t('add_tools_hint') : t('add_root_hint')}</span> : <input autoFocus aria-label={t('name_namespace', { path: parent || t('root') })}
            placeholder={t('namespace_name')} value={name} disabled={busy} onChange={event => setName(event.target.value)}
            onBlur={() => {
                const value = name.trim();
                if (!value || create(parent ? `${parent}.${value}` : value)) setName(undefined);
            }} onKeyDown={event => {
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
                if (event.key === 'Escape') { event.preventDefault(); setName(undefined); }
            }} />}
        <HintButton className="ts-add-tool" type="button" aria-label={t('add_tools_to', { path: parent || t('root') })} title={t('add_tools_to_hint', { path: parent || t('root') })} disabled={busy}
            onClick={() => pick(parent)} onDoubleClick={event => event.stopPropagation()}>
            <AddIcon valid={!busy} />
        </HintButton>
    </li>;
}

