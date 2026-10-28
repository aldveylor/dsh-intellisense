import { HintButton } from '../tooltip/action_hint.js';
import { ProfileLabel } from './profile_label.js';
import styles from './profile_label.css';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from '../locale/locale.js';
import type { ProfileSelectProps } from './profile_picker.js';
import { useLayoutMotion } from '../animation/layout_motion.js';

/** @brief One profile row with inline renaming and an independent borderless delete action. */
function NativeProfileItem({ value, label, brief, selected, disabled, removable, readOnly, hint, onChange, onRename, onRemove }: {
    value: string; label: string; brief?: string; hint?: string; selected: boolean; disabled: boolean; removable: boolean; readOnly: boolean;
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

    return <div className="ts-profile-item" data-selected={selected} data-profile-value={value}>
        {draft === undefined ? <HintButton type="button" className="ts-profile-option" action={label} aria-pressed={selected} aria-disabled={disabled} title={readOnly ? hint : t('edit_profile_hint')}
            onClick={() => { if (!disabled) onChange(); }} onDoubleClick={() => { if (!readOnly && !disabled) setDraft(value); }}>
            <span className="ts-profile-check" aria-hidden="true">{selected ? '✓' : ''}</span><ProfileLabel label={label} brief={brief} />
        </HintButton> : <input aria-label={t('rename_profile')} autoFocus maxLength={80} value={draft} disabled={disabled}
            onFocus={event => event.target.select()} onChange={event => setDraft(event.target.value)} onBlur={commit}
            onKeyDown={event => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'Enter') { event.preventDefault(); commit(); }
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft(undefined); }
            }} />}
        {!readOnly && <HintButton type="button" className="ts-profile-delete" aria-label={`${t('delete_profile')} ${value}`} title={t('delete_profile_hint')}
            disabled={disabled || !removable} onClick={onRemove}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" />
            </svg>
        </HintButton>}
    </div>;
}

/** @brief Independent anchored profile dropdown that keeps selection and editing inside the open panel. */
export function NativeProfileSelect({ value, options, disabled, readOnly = false, allowCreate = true, protectedProfile, label, hint, closeOnSelect = false, onChange, onCreate, onRename, onRemove }: ProfileSelectProps) {
    const t = useTranslation();
    const [phase, setPhase] = useState<'closed' | 'open' | 'closing'>('closed');
    const open = phase === 'open';
    const [draft, setDraft] = useState('');
    const root = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const panelId = useId();
    useLayoutMotion(root, '.ts-profile-item', element => element.dataset.profileValue!);

    useEffect(() => {
        if (!open) return;
        /** @brief Dismiss the dropdown when a pointer or keyboard focus leaves the control. */
        function outside(event: Event): void {
            if (!root.current?.contains(event.target as Node)) setPhase('closing');
        }
        document.addEventListener('pointerdown', outside);
        document.addEventListener('focusin', outside);
        return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
    }, [open]);

    return <div className="ts-profile-select" ref={root} onKeyDown={event => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); setPhase('closing'); trigger.current?.focus(); }
        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !(event.target instanceof HTMLInputElement)) {
            event.preventDefault();
            if (!open) { setPhase('open'); return; }
            const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('.ts-profile-option') ?? []);
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        }
    }}>
        <style>{styles}</style>
        <HintButton type="button" ref={trigger} aria-label={label ?? t('profile')} aria-expanded={open} aria-controls={panelId} title={hint} disabled={disabled}
            onClick={() => setPhase(current => current === 'open' ? 'closing' : 'open')}>
            <span className="ts-profile-label">{options.find(option => option.value === value)?.label ?? value}</span>
            <svg className="ts-profile-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
            </svg>
        </HintButton>
        {phase !== 'closed' && <div id={panelId} className="ts-profile-dropdown" data-phase={phase} role="group" aria-label={label ?? t('profile')}
            aria-hidden={!open} ref={element => { if (element) element.inert = !open; }} onAnimationEnd={event => {
                if (event.target === event.currentTarget && phase === 'closing') setPhase('closed');
            }}>
            <div className="ts-profile-options">{options.map(option => <NativeProfileSelect.Item key={option.value} {...option}
                selected={option.value === value} disabled={disabled} hint={hint} removable={options.length > 1 && option.value !== protectedProfile} readOnly={readOnly} onChange={() => { onChange(option.value); if (closeOnSelect) { setPhase('closing'); trigger.current?.focus(); } }}
                onRename={name => onRename?.(option.value, name)} onRemove={() => onRemove?.(option.value)} />)}</div>
            {!readOnly && allowCreate && <form className="ts-profile-create" onSubmit={event => {
                event.preventDefault(); const name = draft.trim();
                if (disabled || !name || options.some(option => option.value === name)) return;
                onCreate?.(name); setDraft('');
            }}>
                <input aria-label={t('create_profile')} placeholder={t('create_profile_hint')} maxLength={80} value={draft} disabled={disabled}
                    onChange={event => setDraft(event.target.value)} onKeyDown={event => {
                        if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();
                    }} />
            </form>}
        </div>}
    </div>;
}

NativeProfileSelect.Item = NativeProfileItem;
