import { ActionButton } from './action_button.js';
import { useTranslation } from '../locale/locale.js';

/** @brief Close a dialog with a shared SVG cross and localized accessible hint. */
export function CloseButton({ close, label, hint }: { close: () => void; label?: string; hint?: string }) {
    const t = useTranslation();
    return <ActionButton className="ts-close-button" variant="ghost" size="sm" aria-label={label ?? t('close')}
        title={hint ?? t('close_hint')} onClick={close}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
            <path d="m6 6 12 12M18 6 6 18" />
        </svg>
    </ActionButton>;
}
