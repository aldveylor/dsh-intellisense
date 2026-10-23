import { useEffect, useState } from 'react';
import { defaultHistoryLimits, type HistoryLimits } from '../../protocol/history.js';
import { useTranslation } from '../locale/locale.js';

/** @brief Edit independent IntelliSense retention limits without replacing the namespace draft. */
export function HistorySettings({ value = defaultHistoryLimits, busy, save }: { value?: HistoryLimits; busy: boolean; save: (limits: HistoryLimits) => void }) {
    const t = useTranslation();
    const [draft, setDraft] = useState<HistoryLimits>(value);
    useEffect(() => { setDraft(value); }, [value.namespace, value.command]);
    return <form className="ts-history-settings ts-actions" onSubmit={event => { event.preventDefault(); save(draft); }}>
        <span>{t('history_settings')}</span>
        <label>{t('namespace_history')} <input type="number" min="0" step="1" required disabled={busy} value={Number.isNaN(draft.namespace) ? '' : draft.namespace}
            onChange={event => setDraft(current => ({ ...current, namespace: event.target.valueAsNumber }))} /></label>
        <label>{t('command_history')} <input type="number" min="0" step="1" required disabled={busy} value={Number.isNaN(draft.command) ? '' : draft.command}
            onChange={event => setDraft(current => ({ ...current, command: event.target.valueAsNumber }))} /></label>
        <button type="submit" disabled={busy || (draft.namespace === value.namespace && draft.command === value.command)}>{t('save_history')}</button>
    </form>;
}
