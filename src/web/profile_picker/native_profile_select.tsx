import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from '../locale/locale.js';
import type { ProfileSelectProps } from './profile_picker.js';

/** @brief One profile row with inline renaming and an independent borderless delete action. */
function NativeProfileItem({ value, label, selected, disabled, removable, onChange, onRename, onRemove }: {
    value: string; label: string; selected: boolean; disabled: boolean; removable: boolean;
    onChange: () => void; onRename: (name: string) => void; onRemove: () => void;
}) {
    const t = useTranslation();
    const [draft, setDraft] = useState<string>();

    /** @brief Commit a nonempty name once on Enter or focus loss. */
    function commit(): void {
        if (draft === undefined) return;
        const name = draft.trim(); setDraft(undefined);
        if (name && name !== value) onRename(name);
    }

    return <div className="ts-profile-item">
        {draft === undefined ? <button type="button" className="ts-profile-option" aria-pressed={selected} aria-disabled={disabled}
            onClick={() => { if (!disabled) onChange(); }} onDoubleClick={() => setDraft(value)}>
            <span className="ts-profile-check" aria-hidden="true">{selected ? '✓' : ''}</span><span>{label}</span>
        </button> : <input aria-label={t('rename_profile')} autoFocus maxLength={80} value={draft} disabled={disabled}
            onFocus={event => event.target.select()} onChange={event => setDraft(event.target.value)} onBlur={commit}
            onKeyDown={event => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'Enter') { event.preventDefault(); commit(); }
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft(undefined); }
            }} />}
        <button type="button" className="ts-profile-delete" aria-label={`${t('delete_profile')} ${value}`} title={t('delete_profile')}
            disabled={disabled || !removable} onClick={onRemove}>×</button>
    </div>;
}

/** @brief Independent anchored profile dropdown that keeps selection and editing inside the open panel. */
export function NativeProfileSelect({ value, options, disabled, onChange, onCreate, onRename, onRemove }: ProfileSelectProps) {
    const t = useTranslation();
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState('');
    const root = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const panelId = useId();

    useEffect(() => {
        if (!open) return;
        /** @brief Dismiss the dropdown when a pointer or keyboard focus leaves the control. */
        function outside(event: Event): void {
            if (!root.current?.contains(event.target as Node)) setOpen(false);
        }
        document.addEventListener('pointerdown', outside);
        document.addEventListener('focusin', outside);
        return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
    }, [open]);

    return <div className="ts-profile-select" ref={root} onKeyDown={event => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !(event.target instanceof HTMLInputElement)) {
            event.preventDefault();
            if (!open) { setOpen(true); return; }
            const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('.ts-profile-option') ?? []);
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        }
    }}>
        <button type="button" ref={trigger} aria-label={t('profile')} aria-expanded={open} aria-controls={panelId} disabled={disabled}
            onClick={() => setOpen(current => !current)}>{options.find(option => option.value === value)?.label ?? value} ▾</button>
        {open && <div id={panelId} className="ts-profile-dropdown" role="group" aria-label={t('profile')}>
            <div className="ts-profile-options">{options.map(option => <NativeProfileSelect.Item key={option.value} {...option}
                selected={option.value === value} disabled={disabled} removable={options.length > 1} onChange={() => onChange(option.value)}
                onRename={name => onRename(option.value, name)} onRemove={() => onRemove(option.value)} />)}</div>
            <form className="ts-profile-create" onSubmit={event => {
                event.preventDefault(); const name = draft.trim();
                if (disabled || !name || options.some(option => option.value === name)) return;
                onCreate(name); setDraft('');
            }}>
                <input aria-label={t('create_profile')} placeholder={t('create_profile_hint')} maxLength={80} value={draft} disabled={disabled}
                    onChange={event => setDraft(event.target.value)} onKeyDown={event => {
                        if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();
                    }} />
            </form>
        </div>}
    </div>;
}

NativeProfileSelect.Item = NativeProfileItem;
