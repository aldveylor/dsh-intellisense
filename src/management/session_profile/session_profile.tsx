import { useEffect, useRef, useState } from 'react';
import { IconChevronDownOutlineRegular, IconDatabaseOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives';
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type {} from '@deepseek-ai/dsh-agent-preset-registry';
import type { SessionProfileState } from './state.js';
import styles from './session_profile.css';

/** @brief Native hero menu selecting the namespace snapshot owned by the current session. */
export function SessionProfile({ sessionId, useProjection, api, t }: PropsRuntime<'conversation.hero.options'> & PropsLocale<'ts_intellisense'> & { api: string }) {
    const preset = useProjection('agentPreset');
    const [state, setState] = useState<SessionProfileState>();
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const generation = useRef(0);
    const selecting = useRef(false);

    useEffect(() => {
        let active = true;
        setState(undefined); setOpen(false); setError(''); setBusy(false); selecting.current = false;
        /** @brief Refresh after preset changes and when returning from profile management. */
        async function refresh(): Promise<void> {
            if (selecting.current) return;
            const current = ++generation.current;
            try {
                const url = new URL(api); url.searchParams.set('session', sessionId);
                const response = await fetch(url);
                const result = await response.json();
                if (!response.ok) throw new Error(result.error);
                if (active && current === generation.current) { setState(result); setError(''); }
            } catch (error) { if (active && current === generation.current) setError(String(error)); }
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
        selecting.current = true; setBusy(true); setError('');
        const current = ++generation.current;
        try {
            const url = new URL(api); url.searchParams.set('session', sessionId);
            const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile }) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            if (current === generation.current) setState(result);
        } catch (error) { if (current === generation.current) setError(String(error)); }
        finally { if (current === generation.current) { selecting.current = false; setBusy(false); } }
    }

    if (!state?.enabled && !error) return null;
    return <div className="ts-session-profile">
        <style>{styles}</style>
        {state?.enabled && <Menu open={open} onClose={() => setOpen(false)} align="start" portal className="ts-session-profile-menu"
            items={state.profiles.map(profile => ({ id: profile, label: <span className="ts-session-profile-item">{profile}</span> }))} selectedId={state.profile}
            onSelect={profile => { void select(profile); }} anchor={<button type="button" className="ts-session-profile-trigger"
                aria-label="Profile" title={t('select_session_profile')} aria-haspopup="menu" aria-expanded={open} disabled={busy}
                onClick={() => setOpen(value => !value)}>
                <IconDatabaseOutlineRegular className="ts-session-profile-icon" />
                <span>{state.profile}</span>
                <IconChevronDownOutlineRegular className="ts-session-profile-chevron" />
            </button>} />}
        {error && <span className="ts-session-profile-error" role="alert">{error}</span>}
    </div>;
}
