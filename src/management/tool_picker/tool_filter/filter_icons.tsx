import { Icon, useIconStyles, type IconProps } from '../../controls/icon.js';
import styles from './filter_icons.css';

/** @brief Filter funnel owns hover animation and receives open/active state explicitly. */
export function FilterIcon({ valid, open, active }: IconProps & { open: boolean; active: boolean }) {
    useIconStyles(styles);
    return <><Icon valid={valid} className="ts-filter-icon" strokeWidth={1.8} data-open={open} data-active={active}>
        <path className="ts-filter-funnel" d="M3 4h18l-7 8v7l-4 2v-9z" /><circle className="ts-filter-dot" cx="19" cy="18" r="3" fill="currentColor" stroke="none" />
    </Icon></>;
}

/** @brief Checkbox mark driven directly by category selection. */
export function FilterCheckIcon({ valid, checked }: IconProps & { checked: boolean }) {
    useIconStyles(styles);
    return <><Icon valid={valid} className="ts-tool-filter-check" size={16} viewBox="0 0 20 20" data-checked={checked}>
        <rect x="2" y="2" width="16" height="16" rx="3" /><path d="m5 10 3 3 7-7" />
    </Icon></>;
}
