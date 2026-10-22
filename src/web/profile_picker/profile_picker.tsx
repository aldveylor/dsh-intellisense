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
export function ProfilePicker({ name, profiles, dirty, busy, select, create, rename, remove, save, Select = ProfileSelect }: {
    name: string; profiles: string[]; dirty: boolean; busy: boolean;
    select: (name: string) => void; create: (name: string) => void; rename: (name: string, newName: string) => void;
    remove: (name: string) => void; save: (name?: string) => void; Select?: ComponentType<ProfileSelectProps>;
}) {
    const t = useTranslation();
    const [draft, setDraft] = useState<string>();
    return <div className="ts-profile-picker">
        <span>{t('profile')}</span><Select value={name} options={profiles.map(profile => ({ value: profile, label: `${profile}${dirty && profile === name ? ' *' : ''}` }))}
            disabled={busy} onChange={select} onCreate={create} onRename={rename} onRemove={remove} />
        <button type="button" disabled={busy} onClick={() => save()}>{t('save')}</button>
        <button type="button" disabled={busy} onClick={() => setDraft('')}>{t('save_as')}</button>
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
