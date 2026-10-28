import { Icon, useIconStyles, type IconProps } from '../ui/icons/icon.js';
import styles from './sort_direction_icon.css';

/** @brief Explicit sort direction with self-contained arrow and bar transitions. */
export function SortDirectionIcon({ valid, descending }: IconProps & { descending: boolean }) {
    useIconStyles(styles);
    return <><Icon valid={valid} className="ts-sort-direction-icon" strokeWidth={2} data-descending={descending}>
        <path className="ts-sort-arrow" d="M7 20V4m-4 4 4-4 4 4" /><path className="ts-sort-bars" d="M14 6h3m-3 6h5m-5 6h7" />
    </Icon></>;
}
