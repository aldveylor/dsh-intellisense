import { useEffect, useRef, useState } from 'react';
import { IconChevronDownOutlineRegular, IconDatabaseOutlineRegular, IconWarningOutlineRegular, Menu, Toast } from '@deepseek-ai/dsh-client-ui-primitives';
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type {} from '@deepseek-ai/dsh-agent-preset-registry';
import type { SessionProfileState } from './state.js';
import { messageKey } from '../locale/locale.js';
import styles from './session_profile.css';
import labelStyles from '../profile_picker/profile_label.css';
import { ProfileLabel } from '../profile_picker/profile_label.js';

/** @brief Native hero menu selecting the namespace snapshot owned by the current session. */
export function SessionProfile({ sessionId, useProjection, api, t }: PropsRuntime<'conversation.hero.options'> & PropsLocale<'ts_intellisense'> & { api: string }) {
    const preset = useProjection('agentPreset');
    const [state, setState] = useState<SessionProfileState>();
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<{ message: string; generation: number }>();
    const generation = useRef(0);
    const selecting = useRef(false);

    useEffect(() => {
        let active = true;
        setState(undefined); setOpen(false); setError(undefined); setBusy(false); selecting.current = false;
        /** @brief Refresh after preset changes and when returning from profile management. */
        async function refresh(): Promise<void> {
            if (selecting.current) return;
            const current = ++generation.current;
            try {
                const url = new URL(api); url.searchParams.set('session', sessionId);
                const response = await fetch(url);
                const result = await response.json();
                if (!response.ok) throw new Error(result.error);
                if (active && current === generation.current) { setState(result); setError(undefined); }
            } catch (error) { if (active && current === generation.current) setError({ message: error instanceof Error ? error.message : String(error), generation: current }); }
        }
        void refresh();
        window.addEventListener('focus', refresh);
        return () => { active = false; generation.current++; window.removeEventListener('focus', refresh); };
    }, [api, sessionId, preset]);

    /** @brief Confirm a session-local load before displaying the selected profile. */
    async function select(profile: string): Promise<void> {
        if (selecting.current) return;
        setOpen(false);
        if (profile === state?.profile) return;
        selecting.current = true; setBusy(true); setError(undefined);
        const current = ++generation.current;
        try {
            const url = new URL(api); url.searchParams.set('session', sessionId);
            const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile }) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            if (current === generation.current) setState(result);
        } catch (error) { if (current === generation.current) setError({ message: error instanceof Error ? error.message : String(error), generation: current }); }
        finally { if (current === generation.current) { selecting.current = false; setBusy(false); } }
    }

    const errorKey = error && messageKey(error.message);

    if (!state?.enabled && !error) return null;
    return <div className="ts-session-profile">
        <style>{styles + labelStyles}</style>
        {state?.enabled && <Menu open={open} onClose={() => setOpen(false)} align="start" portal className="ts-session-profile-menu"
            items={state.profiles.map(profile => ({ id: profile, label: <ProfileLabel label={profile} brief={state.profileBriefs?.[profile]} /> }))} selectedId={state.profile}
            onSelect={profile => { void select(profile); }} anchor={<button type="button" className="ts-session-profile-trigger"
                aria-label={t('session_profile_label')} title={t('select_session_profile')} aria-haspopup="menu" aria-expanded={open} disabled={busy}
                onClick={() => setOpen(value => !value)}>
                <IconDatabaseOutlineRegular className="ts-session-profile-icon" />
                <span>{state.profile}</span>
                <IconChevronDownOutlineRegular className="ts-session-profile-chevron" />
            </button>} />}
        {error && <Toast key={error.generation} text={t('operation_failed_detail', { message: errorKey ? t(errorKey) : error.message })} icon={<IconWarningOutlineRegular />}
            holdMs={6000} onDone={() => setError(undefined)} />}
    </div>;
}
