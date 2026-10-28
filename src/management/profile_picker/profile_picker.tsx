import { ProfileActionButton } from './action_button.js';
import { TooltipProvider } from '../tooltip/tooltip.js';
import { SaveAsDialog } from './save_as_dialog.js';
import { useTranslation } from '../locale/locale.js';
import { useRef, useState, type ComponentType, type AnimationEvent } from 'react';
import { NativeProfileSelect } from './native_profile_select.js';
import { useActionAnimation } from '../animation/action_animation.js';

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

    /** @brief Bind each icon to its own operation and complete SVG animation cycles. */
    function icon(name: string) {
        return { 'data-action': name, 'data-running': animation.running.has(name),
            onAnimationIteration: (event: AnimationEvent<SVGSVGElement>) => animation.finish(name, event) };
    }

    return <TooltipProvider><div className="ts-profile-picker">
        <Select value={name} options={profiles.map(profile => ({ value: profile, label: `${profile}${dirty && profile === name ? ' *' : ''}`, brief: briefs[profile] }))}
            disabled={busy} hint={t('edit_profile_hint')} protectedProfile={protectedProfile} onChange={select} onCreate={create} onRename={rename} onRemove={remove} />
        <ProfileActionButton type="button" label={t('refresh')} hint={t('refresh_hint')} disabled={refreshDisabled} aria-busy={animation.running.has('refresh')} onClick={() => void animation.run('refresh', refresh)}>
            <svg {...icon('refresh')} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 7v5h-5M4 17v-5h5M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9" />
            </svg>
        </ProfileActionButton>
        <ProfileActionButton type="button" label={t('save')} hint={t('save_hint')} disabled={busy} aria-busy={animation.running.has('save')} onClick={() => void animation.run('save', () => save())}>
            <svg {...icon('save')} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path className="ts-archive-box" d="M4 11h16v10H4zM3 8h18v3H3zM10 15h4" />
                <g className="ts-archive-paper"><path d="M7 8V2h7l3 3v3M10 4h3M10 6h4" /></g>
                <path className="ts-archive-seal" d="M3 8h18" />
            </svg>
        </ProfileActionButton>
        <ProfileActionButton type="button" label={t('save_as')} hint={t('save_as_hint')} disabled={busy} aria-busy={animation.running.has('save_as')} onClick={() => { if (!animation.running.has('save_as')) setSavingAs(true); }}>
            <svg {...icon('save_as')} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10l4 4v4M7 7h6M7 11h4" />
                <path className="ts-action-pen" d="m14 21 1-4 5-5 3 3-5 5-4 1ZM18 14l3 3" />
            </svg>
        </ProfileActionButton>
        <ProfileActionButton type="button" label={t('download_profile')} hint={t('download_profile_hint')} disabled={busy} aria-busy={animation.running.has('download')} onClick={() => void animation.run('download', download)}>
            <svg {...icon('download')} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path className="ts-transfer-arrow" d="M12 3v12m-5-5 5 5 5-5" /><path d="M4 16v5h16v-5" />
            </svg>
        </ProfileActionButton>
        <ProfileActionButton type="button" label={t('upload_profile')} hint={t('upload_profile_hint')} disabled={busy} aria-busy={animation.running.has('upload')} onClick={() => { if (!animation.running.has('upload')) fileInput.current?.click(); }}>
            <svg {...icon('upload')} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path className="ts-transfer-arrow" d="M12 15V3m-5 5 5-5 5 5" /><path d="M4 16v5h16v-5" />
            </svg>
        </ProfileActionButton>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden disabled={busy} aria-label={t('upload_profile')} onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void animation.run('upload', () => upload(file));
        }} />
        {savingAs && <SaveAsDialog profiles={profiles} busy={busy} save={name => void animation.run('save_as', () => save(name))} close={() => setSavingAs(false)} />}
    </div></TooltipProvider>;
}
