import { ActionButton } from '../ui/controls/action_button.js';
import { useEffect, useId, useRef } from 'react';
import { useTranslation } from '../locale/locale.js';

/** @brief Display an operation error in a modal until dismissed. */
export function ErrorDialog({ message, close }: { message: string; close: () => void }) {
    const t = useTranslation();
    const dialog = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    const messageId = useId();

    useEffect(() => { dialog.current?.showModal(); }, []);

    return <dialog ref={dialog} className="ts-management-dialog" aria-labelledby={titleId} aria-describedby={messageId} onClose={close}>
        <h2 id={titleId}>{t('operation_failed')}</h2>
        <p id={messageId} className="ts-error-message">{message}</p>
        <div className="ts-dialog-actions"><ActionButton variant="primary" type="button" autoFocus title={t('close_hint')} onClick={close}>{t('confirm')}</ActionButton></div>
    </dialog>;
}
