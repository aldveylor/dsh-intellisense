import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from '../locale/locale.js';

/** @brief Modal name entry for saving the draft as a new profile. */
export function SaveAsDialog({ profiles, busy, save, close, title }: {
    title?: string; profiles: string[]; busy: boolean; save: (name: string) => void; close: () => void;
}) {
    const t = useTranslation();
    const dialog = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    const [draft, setDraft] = useState('');

    useEffect(() => { dialog.current?.showModal(); }, []);

    return <dialog ref={dialog} className="ts-management-dialog" aria-labelledby={titleId} onClose={close}>
        <h2 id={titleId}>{title ?? t('save_as')}</h2>
        <form onSubmit={event => {
            event.preventDefault(); const name = draft.trim();
            if (busy || !name || profiles.includes(name)) return;
            save(name); close();
        }}>
            <label>{t('profile_name')}
                <input autoFocus maxLength={80} value={draft} disabled={busy} onChange={event => setDraft(event.target.value)}
                    onKeyDown={event => { if (event.nativeEvent.isComposing && event.key === 'Enter') event.preventDefault(); }} />
            </label>
            <div className="ts-dialog-actions">
                <button type="button" onClick={close}>{t('cancel')}</button>
                <button type="submit" disabled={busy || !draft.trim() || profiles.includes(draft.trim())}>{t('confirm')}</button>
            </div>
        </form>
    </dialog>;
}
