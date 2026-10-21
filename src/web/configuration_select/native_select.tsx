import { useEffect, useState } from 'react';
import { Button, Menu, IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import type { ConfigurationSelectProps } from '../management_panel.js';

/** @brief Use the host's native DSH menu, button, keyboard navigation and anchored portal for configuration selection. */
export function NativeConfigurationSelect({ value, sessions, disabled, onChange }: ConfigurationSelectProps) {
    const [open, setOpen] = useState(false);
    useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

    return <Menu className="ts-configuration-select" open={open && !disabled} portal autoFocus
        selectedId={value ? `session:${value}` : 'global'}
        items={[{ id: 'global', label: '全局' }, ...sessions.map(session => ({ id: `session:${session.id}`, label: session.id }))]}
        onClose={() => setOpen(false)} onSelect={id => {
            setOpen(false); onChange(id === 'global' ? '' : id.slice('session:'.length));
        }} anchor={<Button data-dsh-control variant="outline" size="sm" className="ts-configuration-trigger"
            aria-label="会话配置" aria-haspopup="menu" aria-expanded={open && !disabled} disabled={disabled}
            onClick={() => setOpen(current => !current)}>
            <span className="ts-configuration-label">{value || '全局'}</span><IconChevronDownOutlineRegular />
        </Button>} />;
}
