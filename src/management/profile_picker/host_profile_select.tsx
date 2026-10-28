import { HintButton } from '../tooltip/action_hint.js';
import { useState } from 'react';
import { IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives';
import type { ProfileSelectProps } from './profile_picker.js';
import { ProfileLabel } from './profile_label.js';
import styles from './profile_label.css';

/** @brief Host menu matching the Agent Mode selector for default Profile selection. */
export function HostProfileSelect({ value, options, disabled, label, hint, onChange }: ProfileSelectProps) {
    const [open, setOpen] = useState(false);
    return <><style>{styles}</style><Menu open={open} onClose={() => setOpen(false)} portal align="start"
        items={options.map(option => ({ id: option.value, label: <ProfileLabel {...option} /> }))} selectedId={value}
        onSelect={name => { setOpen(false); onChange(name); }} anchor={<HintButton type="button" aria-label={label} aria-haspopup="menu"
            aria-expanded={open} title={hint} disabled={disabled} onClick={() => setOpen(current => !current)}>
            <span>{options.find(option => option.value === value)?.label ?? value}</span><IconChevronDownOutlineRegular />
        </HintButton>} /></>;
}
