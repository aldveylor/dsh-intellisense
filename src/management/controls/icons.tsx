import { Icon, type IconProps } from './icon.js';
import styles from './icons.css';

/** @brief Shared cross for close and delete controls. */
export function CloseIcon({ valid, size = 18, strokeWidth = 2 }: IconProps & { size?: number; strokeWidth?: number }) {
    return <Icon valid={valid} size={size} strokeWidth={strokeWidth}><path d="m6 6 12 12M18 6 6 18" /></Icon>;
}

/** @brief Add a tool or namespace member. */
export function AddIcon({ valid }: IconProps) {
    return <Icon valid={valid} size={18}><path d="M12 5v14M5 12h14" /></Icon>;
}

/** @brief Open the physical tool catalog. */
export function ToolsIcon({ valid }: IconProps) {
    return <Icon valid={valid} size={18}><path d="M14 6a5 5 0 0 0-6-4l3 3-3 3-3-3a5 5 0 0 0 6 6l8 8a2 2 0 0 0 3-3z" /></Icon>;
}

/** @brief Usage documentation indicator. */
export function HelpIcon({ valid }: IconProps) {
    return <Icon valid={valid}><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.75-2.5 2-2.5 4" /><circle cx="12" cy="16.5" r=".75" fill="currentColor" stroke="none" /></Icon>;
}

/** @brief Explicitly controlled disclosure or dropdown rotation. */
export function ChevronIcon({ valid, open, direction = 'down', size = 16, className = '' }: IconProps & { open: boolean; direction?: 'right' | 'down'; size?: number; className?: string }) {
    return <><style>{styles}</style><Icon valid={valid} className={`ts-chevron-icon ${className}`} size={size} data-open={open} data-direction={direction}>
        <path d={direction === 'right' ? 'm9 5 7 7-7 7' : 'm6 9 6 6 6-6'} />
    </Icon></>;
}

/** @brief Pin fill and detailed-exposure color driven by explicit state. */
export function PinIcon({ valid, active, level }: IconProps & { active: boolean; level?: number }) {
    return <><style>{styles}</style><Icon valid={valid} size={18} className="ts-pin-icon" data-active={active} data-level={level}>
        <path d="m16 9 3-3-5-5-3 3v4l-5 5 5 5 5-5zM9 15l-5 5" />
    </Icon></>;
}

/** @brief Availability mark driven by the node's disabled state. */
export function DisableIcon({ valid, disabled }: IconProps & { disabled: boolean }) {
    return <><style>{styles}</style><Icon valid={valid} size={18} className="ts-disable-icon" data-disabled={disabled}>
        <circle cx="12" cy="12" r="8" /><g className="ts-disable-mark"><path d="M6 12h12" /><path className="ts-disable-cross" d="M12 6v12" /></g>
    </Icon></>;
}
