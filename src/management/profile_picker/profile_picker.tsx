import { useTranslation } from '../locale/locale.js';
import { useState, type ComponentType } from 'react';

/** @brief A host may supply its own dropdown without imposing host dependencies on standalone pages. */
export interface ProfileSelectProps {
    value: string; options: ReadonlyArray<{ value: string; label: string }>; disabled: boolean;
    onChange: (value: string) => void;
    onCreate: (name: string) => void; onRename: (name: string, newName: string) => void; onRemove: (name: string) => void;
}

/** @brief Portable selection control for the independent authenticated page. */
function ProfileSelect({ value, options, disabled, onChange, onCreate, onRename, onRemove }: ProfileSelectProps) {
    const t = useTranslation();
    const [editing, setEditing] = useState<'create' | 'rename'>();
    const [draft, setDraft] = useState('');
    return <><select aria-label={t('profile')} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
        <button type="button" disabled={disabled} onClick={() => { setEditing('create'); setDraft(''); }}>{t('create_profile')}</button>
        <button type="button" disabled={disabled} onClick={() => { setEditing('rename'); setDraft(value); }}>{t('rename_profile')}</button>
        <button type="button" disabled={disabled || options.length <= 1} onClick={() => onRemove(value)}>{t('delete_profile')}</button>
        {editing && <form className="ts-profile-name" onSubmit={event => {
            event.preventDefault(); const name = draft.trim(); if (disabled || !name) return;
            if (editing === 'create') onCreate(name); else onRename(value, name);
            setEditing(undefined);
        }}>
            <input aria-label={t('profile_name')} autoFocus maxLength={80} value={draft} disabled={disabled} onChange={event => setDraft(event.target.value)}
                onKeyDown={event => { if (event.nativeEvent.isComposing && event.key === 'Enter') event.preventDefault(); if (event.key === 'Escape') setEditing(undefined); }} />
            <button type="submit" disabled={disabled || !draft.trim()}>{t('confirm')}</button>
            <button type="button" onClick={() => setEditing(undefined)}>{t('cancel')}</button>
        </form>}
    </>;
}

/** @brief Profile selection followed by saving the current draft or saving a named copy. */
export function ProfilePicker({ name, profiles, dirty, busy, select, create, rename, remove, save, refresh, refreshDisabled, Select = ProfileSelect }: {
    name: string; profiles: string[]; dirty: boolean; busy: boolean;
    select: (name: string) => void; create: (name: string) => void; rename: (name: string, newName: string) => void;
    remove: (name: string) => void; save: (name?: string) => void; refresh: () => void; refreshDisabled: boolean; Select?: ComponentType<ProfileSelectProps>;
}) {
    const t = useTranslation();
    const [draft, setDraft] = useState<string>();
    return <div className="ts-profile-picker">
        <span>{t('profile')}</span><Select value={name} options={profiles.map(profile => ({ value: profile, label: `${profile}${dirty && profile === name ? ' *' : ''}` }))}
            disabled={busy} onChange={select} onCreate={create} onRename={rename} onRemove={remove} />
        <button className="ts-profile-action" type="button" aria-label={t('refresh')} title={t('refresh')} disabled={refreshDisabled} onClick={refresh}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 7v5h-5M4 17v-5h5M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9" />
            </svg>
        </button>
        <button className="ts-profile-action" type="button" aria-label={t('save')} title={t('save')} disabled={busy} onClick={() => save()}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2ZM7 3v6h10V3M7 21v-8h10v8" />
            </svg>
        </button>
        <button className="ts-profile-action" type="button" aria-label={t('save_as')} title={t('save_as')} disabled={busy} onClick={() => setDraft('')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v4M7 3v6h10V3M7 21v-8h5M14 21l1-4 5-5 3 3-5 5-4 1ZM18 14l3 3" />
            </svg>
        </button>
        {draft !== undefined && <form className="ts-profile-name" onSubmit={event => {
            event.preventDefault(); const name = draft.trim();
            if (busy || !name || profiles.includes(name)) return;
            save(name); setDraft(undefined);
        }}>
            <input aria-label={t('profile_name')} autoFocus maxLength={80} value={draft} disabled={busy} onChange={event => setDraft(event.target.value)}
                onKeyDown={event => { if (event.nativeEvent.isComposing && event.key === 'Enter') event.preventDefault(); if (event.key === 'Escape') setDraft(undefined); }} />
            <button type="submit" disabled={busy || !draft.trim() || profiles.includes(draft.trim())}>{t('confirm')}</button>
            <button type="button" onClick={() => setDraft(undefined)}>{t('cancel')}</button>
        </form>}
    </div>;
}
