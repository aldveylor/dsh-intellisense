import { RefreshIcon, SaveIcon, SaveAsIcon, DownloadIcon, UploadIcon } from './action_icons.js';
import { ProfileActionButton } from './action_button.js';
import { TooltipProvider } from '../ui/tooltip/tooltip.js';
import { SaveAsDialog } from './save_as_dialog.js';
import { useTranslation } from '../locale/locale.js';
import { useRef, useState, type ComponentType } from 'react';
import { NativeProfileSelect } from './native_profile_select.js';
import { useActionAnimation } from '../ui/animation/action_animation.js';

/** @brief A host may supply its own dropdown without imposing host dependencies on standalone pages. */
export interface ProfileSelectProps {
    value: string; options: ReadonlyArray<{ value: string; label: string; brief?: string }>; disabled: boolean; readOnly?: boolean; allowCreate?: boolean; protectedProfile?: string;
    label?: string; hint?: string; closeOnSelect?: boolean;
    onChange: (value: string) => void;
    onCreate?: (name: string) => void; onRename?: (name: string, newName: string) => void; onRemove?: (name: string) => void;
}

/** @brief Portable selection control for the independent authenticated page. */
export function ProfileSelect(props: ProfileSelectProps) {
    return <NativeProfileSelect {...props} />;
}

/** @brief Profile selection with draft saving, named copies and JSON transfer actions. */
export function ProfilePicker({ name, profiles, briefs = {}, dirty, busy, select, create, rename, remove, save, refresh, refreshDisabled, download, upload, protectedProfile, Select = ProfileSelect }: {
    name: string; profiles: string[]; briefs?: Record<string, string>; dirty: boolean; busy: boolean;
    download: () => Promise<void>; upload: (file: File) => Promise<void>;
    select: (name: string) => void; create: (name: string) => void; rename: (name: string, newName: string) => void;
    remove: (name: string) => void; save: (name?: string) => Promise<void>; refresh: () => Promise<void>; refreshDisabled: boolean; protectedProfile?: string; Select?: ComponentType<ProfileSelectProps>;
}) {
    const t = useTranslation();
    const [savingAs, setSavingAs] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);
    const animation = useActionAnimation();

    /** @brief Pass operation state to the icon and finish only its complete cycles. */
    function icon(name: string, disabled: boolean) {
        const running = animation.running.has(name);
        return { valid: !disabled || running, running, onCycle: () => animation.finish(name) };
    }

    return <TooltipProvider><div className="ts-profile-picker">
        <Select value={name} options={profiles.map(profile => ({ value: profile, label: `${profile}${dirty && profile === name ? ' *' : ''}`, brief: briefs[profile] }))}
            disabled={busy} hint={t('edit_profile_hint')} protectedProfile={protectedProfile} onChange={select} onCreate={create} onRename={rename} onRemove={remove} />
        <ProfileActionButton type="button" label={t('refresh')} hint={t('refresh_hint')} disabled={refreshDisabled} aria-busy={animation.running.has('refresh')} onClick={() => void animation.run('refresh', refresh)}>
            <RefreshIcon {...icon('refresh', refreshDisabled)} />
        </ProfileActionButton>
        <ProfileActionButton type="button" label={t('save')} hint={t('save_hint')} disabled={busy} aria-busy={animation.running.has('save')} onClick={() => void animation.run('save', () => save())}>
            <SaveIcon {...icon('save', busy)} />
        </ProfileActionButton>
        <ProfileActionButton type="button" label={t('save_as')} hint={t('save_as_hint')} disabled={busy} aria-busy={animation.running.has('save_as')} onClick={() => { if (!animation.running.has('save_as')) setSavingAs(true); }}>
            <SaveAsIcon {...icon('save_as', busy)} />
        </ProfileActionButton>
        <ProfileActionButton type="button" label={t('download_profile')} hint={t('download_profile_hint')} disabled={busy} aria-busy={animation.running.has('download')} onClick={() => void animation.run('download', download)}>
            <DownloadIcon {...icon('download', busy)} />
        </ProfileActionButton>
        <ProfileActionButton type="button" label={t('upload_profile')} hint={t('upload_profile_hint')} disabled={busy} aria-busy={animation.running.has('upload')} onClick={() => { if (!animation.running.has('upload')) fileInput.current?.click(); }}>
            <UploadIcon {...icon('upload', busy)} />
        </ProfileActionButton>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden disabled={busy} aria-label={t('upload_profile')} onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void animation.run('upload', () => upload(file));
        }} />
        {savingAs && <SaveAsDialog profiles={profiles} busy={busy} save={name => void animation.run('save_as', () => save(name))} close={() => setSavingAs(false)} />}
    </div></TooltipProvider>;
}
