import { PinIcon, CloseIcon, DisableIcon } from '../../controls/icons.js';
import { HintButton } from '../../tooltip/action_hint.js';
import { useTranslation } from '../../locale/locale.js';
import type { PinLevel } from '../../../registry/registry.js';

/** @brief Shared always-visible pin control for namespace and command prompt exposure. */
export function PinButton({ label, active, busy, locked = false, level, tooltip, toggle }: { tooltip?: string; label: string; active: boolean; busy: boolean; locked?: boolean; level?: PinLevel; toggle: () => void }) {
    const t = useTranslation();
    return <HintButton className="ts-pin" type="button" aria-label={label} action={t(locked ? 'pin_action' : level === 0 ? 'pin_brief_action' : level === 1 ? 'pin_detailed_action' : active ? 'unpin_action' : 'pin_namespace_action')} aria-pressed={active} data-filled={active} data-level={level}
        title={tooltip ?? (locked ? t('builtin_pinned') : level !== undefined ? t(`pin_level_${level}`) : active ? t('unpin') : t('pin'))} disabled={busy || locked} onClick={toggle}>
        <PinIcon valid={!busy && !locked} active={active} level={level} />
    </HintButton>;
}

/** @brief Shared deletion control placed after the pin at the right edge of tree blocks. */
export function RemoveButton({ label, hint, busy, remove }: { label: string; hint: string; busy: boolean; remove: () => void }) {
    return <HintButton className="ts-remove" type="button" aria-label={label} title={hint} disabled={busy} onClick={remove}>
        <CloseIcon valid={!busy} strokeWidth={1.5} />
    </HintButton>;
}

/** @brief Toggle command or namespace availability while retaining its editable tree node. */
export function DisableButton({ disabled, busy, toggle }: { disabled: boolean; busy: boolean; toggle: () => void }) {
    const t = useTranslation();
    const label = t(disabled ? 'enable_node' : 'disable_node');
    return <HintButton className="ts-disable ts-remove" type="button" aria-label={label} title={t(disabled ? 'enable_node_hint' : 'disable_node_hint')} aria-pressed={disabled} disabled={busy} onClick={toggle}>
        <DisableIcon valid={!busy} disabled={disabled} />
    </HintButton>;
}

