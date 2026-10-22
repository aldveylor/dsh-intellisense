import { useState, type ComponentType } from 'react';

/** @brief A host may supply its own dropdown without imposing host dependencies on standalone pages. */
export interface ProfileSelectProps {
    value: string; options: ReadonlyArray<{ value: string; label: string }>; disabled: boolean;
    onChange: (value: string) => void;
}

/** @brief Portable selection control for the independent authenticated page. */
function ProfileSelect({ value, options, disabled, onChange }: ProfileSelectProps) {
    return <select aria-label="Profile" value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>;
}

/** @brief Named configuration selection and management with a dirty marker beside the current name. */
export function ProfilePicker({ name, profiles, dirty, busy, select, create, rename, remove, Select = ProfileSelect }: {
    name: string; profiles: string[]; dirty: boolean; busy: boolean;
    select: (name: string) => void; create: (name: string) => void; rename: (name: string) => void; remove: () => void;
    Select?: ComponentType<ProfileSelectProps>;
}) {
    const [editing, setEditing] = useState<'create' | 'rename'>();
    const [draft, setDraft] = useState('');
    return <div className="ts-profile-picker">
        <span>Profile</span><Select value={name} options={profiles.map(profile => ({ value: profile, label: `${profile}${dirty && profile === name ? ' *' : ''}` }))}
            disabled={busy} onChange={select} />
        <button type="button" disabled={busy} onClick={() => { setEditing('create'); setDraft(''); }}>新建 Profile</button>
        <button type="button" disabled={busy} onClick={() => { setEditing('rename'); setDraft(name); }}>重命名 Profile</button>
        <button type="button" disabled={busy || profiles.length <= 1} onClick={remove}>删除 Profile</button>
        {editing && <form className="ts-profile-name" onSubmit={event => {
            event.preventDefault(); const name = draft.trim(); if (!name) return;
            if (editing === 'create') create(name); else rename(name);
            setEditing(undefined);
        }}>
            <input aria-label="Profile 名称" autoFocus maxLength={80} value={draft} disabled={busy} onChange={event => setDraft(event.target.value)}
                onKeyDown={event => { if (event.nativeEvent.isComposing && event.key === 'Enter') event.preventDefault(); if (event.key === 'Escape') setEditing(undefined); }} />
            <button type="submit" disabled={busy || !draft.trim()}>确定</button>
            <button type="button" onClick={() => setEditing(undefined)}>取消</button>
        </form>}
    </div>;
}
