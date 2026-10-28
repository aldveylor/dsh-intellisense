import { useState } from 'react';
import { useTranslation } from '../../../locale/locale.js';

/** @brief A double-click text editor that keeps its draft local until explicit commit or blur. */
export function EditableText({ value, label, className, busy, empty = false, commit }: {
    value: string; label: string; className: string; busy: boolean; empty?: boolean; commit: (value: string) => boolean;
}) {
    const t = useTranslation();
    const [draft, setDraft] = useState<string>();
    return draft === undefined ? <span className={className} aria-label={label} role="button" tabIndex={busy ? -1 : 0}
        onDoubleClick={() => { if (!busy) setDraft(value); }} onKeyDown={event => {
            if (!busy && event.key === 'Enter') { event.preventDefault(); setDraft(value); }
        }}>{value || t('add_comment')}</span> : <input className={className} aria-label={label} autoFocus value={draft} disabled={busy}
            onChange={event => setDraft(event.target.value)} onBlur={() => {
                const next = draft.trim();
                if ((!empty && !next) || next === value || commit(next)) setDraft(undefined);
            }} onKeyDown={event => {
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
                if (event.key === 'Escape') { event.preventDefault(); setDraft(undefined); }
            }} />;
}

