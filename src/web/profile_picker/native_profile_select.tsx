import { useTranslation } from '../locale/locale.js';
import { useState } from 'react';
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives';
import type { ProfileSelectProps } from './profile_picker.js';

/** @brief Use the host's anchored dropdown, selection marker and keyboard navigation for profiles. */
export function NativeProfileSelect({ value, options, disabled, onChange }: ProfileSelectProps) {
    const t = useTranslation();
    const [open, setOpen] = useState(false);
    return <Menu open={open && !disabled} selectedId={value} items={options.map(option => ({ id: option.value, label: option.label }))}
        portal onClose={() => setOpen(false)} onSelect={id => { setOpen(false); if (!disabled) onChange(id); }}
        anchor={<button type="button" aria-label={t('profile')} aria-haspopup="menu" aria-expanded={open && !disabled} disabled={disabled}
            onClick={() => setOpen(current => !current)}>{options.find(option => option.value === value)?.label ?? value} ▾</button>} />;
}
