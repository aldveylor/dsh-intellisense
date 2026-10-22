import { useTranslation } from '../locale/locale.js';
import { useState, type ComponentType } from 'react';

/** @brief A host may supply its own dropdown without imposing host dependencies on standalone pages. */
export interface ProfileSelectProps {
    value: string; options: ReadonlyArray<{ value: string; label: string }>; disabled: boolean;
    onChange: (value: string) => void;
}

/** @brief Portable selection control for the independent authenticated page. */
function ProfileSelect({ value, options, disabled, onChange }: ProfileSelectProps) {
    const t = useTranslation();
    return <select aria-label={t('profile')} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>;
}

/** @brief Named configuration selection and management with a dirty marker beside the current name. */
export function ProfilePicker({ name, profiles, dirty, busy, select, create, rename, remove, Select = ProfileSelect }: {
    name: string; profiles: string[]; dirty: boolean; busy: boolean;
    select: (name: string) => void; create: (name: string) => void; rename: (name: string) => void; remove: () => void;
    Select?: ComponentType<ProfileSelectProps>;
}) {
    const t = useTranslation();
    const [editing, setEditing] = useState<'create' | 'rename'>();
    const [draft, setDraft] = useState('');
    return <div className="ts-profile-picker">
        <span>{t('profile')}</span><Select value={name} options={profiles.map(profile => ({ value: profile, label: `${profile}${dirty && profile === name ? ' *' : ''}` }))}
            disabled={busy} onChange={select} />
        <button type="button" disabled={busy} onClick={() => { setEditing('create'); setDraft(''); }}>{t('create_profile')}</button>
        <button type="button" disabled={busy} onClick={() => { setEditing('rename'); setDraft(name); }}>{t('rename_profile')}</button>
        <button type="button" disabled={busy || profiles.length <= 1} onClick={remove}>{t('delete_profile')}</button>
        {editing && <form className="ts-profile-name" onSubmit={event => {
            event.preventDefault(); const name = draft.trim(); if (!name) return;
            if (editing === 'create') create(name); else rename(name);
            setEditing(undefined);
        }}>
            <input aria-label={t('profile_name')} autoFocus maxLength={80} value={draft} disabled={busy} onChange={event => setDraft(event.target.value)}
                onKeyDown={event => { if (event.nativeEvent.isComposing && event.key === 'Enter') event.preventDefault(); if (event.key === 'Escape') setEditing(undefined); }} />
            <button type="submit" disabled={busy || !draft.trim()}>{t('confirm')}</button>
            <button type="button" onClick={() => setEditing(undefined)}>{t('cancel')}</button>
        </form>}
    </div>;
}
