import { useEffect, useRef, useState } from 'react';
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type {} from '@deepseek-ai/dsh-agent-preset-registry';
import type { SessionProfileState } from './state.js';
import styles from './session_profile.css';

/** @brief Native hero menu selecting the namespace snapshot owned by the current session. */
export function SessionProfile({ sessionId, useProjection, api }: PropsRuntime<'conversation.hero.options'> & { api: string }) {
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
        {state?.enabled && <Menu open={open} onClose={() => setOpen(false)} align="start" portal
            items={state.profiles.map(profile => ({ id: profile, label: profile }))} selectedId={state.profile}
            onSelect={profile => { void select(profile); }} anchor={<button type="button" className="ts-session-profile-trigger"
                aria-label="Profile" aria-haspopup="menu" aria-expanded={open} disabled={busy}
                onClick={() => setOpen(value => !value)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v7c0 4 16 4 16 0V5M4 12v7c0 4 16 4 16 0v-7" /></svg>
                <span>Profile: {state.profile}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </button>} />}
        {error && <span className="ts-session-profile-error" role="alert">{error}</span>}
    </div>;
}
