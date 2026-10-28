import { Icon, useIconStyles, type IconProps } from '../../controls/icon.js';
import { ChevronIcon } from '../../controls/icons.js';
import type { ReactNode } from 'react';
import styles from './animated_icons.css';

/** @brief Shared presentation and animation state for menu trigger SVGs. */
function AnimatedIcon({ children, className, valid, open, value }: IconProps & {
    children: ReactNode; className: string; open: boolean; value?: string;
}) {
    useIconStyles(styles);
    return <><Icon valid={valid} className={`ts-layout-animated-icon ${className}`} data-open={open} data-value={value} strokeWidth={1.8}>{children}</Icon></>;
}

/** @brief Sorting trigger with animated bars on hover and expansion. */
export function SortMenuIcon({ valid, open }: IconProps & { open: boolean }) {
    return <AnimatedIcon className="ts-layout-sort-icon" valid={valid} open={open}>
        <path d="M6 4v16m-3-3 3 3 3-3" /><path className="ts-sort-menu-bars" d="M12 5h9M12 12h6M12 19h3" />
    </AnimatedIcon>;
}

/** @brief Grouping trigger with animated branches and ungrouped state. */
export function GroupMenuIcon({ valid, open, value }: IconProps & { open: boolean; value: string }) {
    return <AnimatedIcon className="ts-layout-group-icon" valid={valid} open={open} value={value}>
        <path className="ts-group-branch" d="M5 4v16m0-13h5m-5 10h5" /><rect className="ts-group-top" x="11" y="3" width="9" height="7" rx="2" /><rect className="ts-group-bottom" x="11" y="14" width="9" height="7" rx="2" />
    </AnimatedIcon>;
}

/** @brief View trigger with animated card-to-list geometry. */
export function ViewMenuIcon({ valid, open, value }: IconProps & { open: boolean; value: string }) {
    return <AnimatedIcon className="ts-layout-view-icon" valid={valid} open={open} value={value}>
        {[0, 1, 2, 3].map(index => <rect key={index} className={`ts-view-cell ts-view-cell-${index}`} x={3 + (index % 2) * 11} y={3 + Math.floor(index / 2) * 11} width="7" height="7" rx="1" />)}
    </AnimatedIcon>;
}

/** @brief Dropdown chevron that rotates with menu expansion. */
export function MenuChevronIcon({ valid, open }: IconProps & { open: boolean }) {
    return <ChevronIcon valid={valid} open={open} size={12} className="ts-layout-chevron" />;
}
