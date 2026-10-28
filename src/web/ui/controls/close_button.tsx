import { CloseIcon } from '../icons/icons.js';
import { ActionButton } from './action_button.js';
import { useTranslation } from '../../locale/locale.js';

/** @brief Close a dialog with a shared SVG cross and localized accessible hint. */
export function CloseButton({ close, label, hint }: { close: () => void; label?: string; hint?: string }) {
    const t = useTranslation();
    return <ActionButton className="ts-close-button" variant="ghost" size="sm" aria-label={label ?? t('close')}
        title={hint ?? t('close_hint')} onClick={close}>
        <CloseIcon valid={true} />
    </ActionButton>;
}
