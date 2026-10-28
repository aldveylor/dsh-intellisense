import { Icon, useIconStyles, type IconProps } from '../../ui/icons/icon.js';
import type { ReactNode } from 'react';
import styles from './option_icons.css';

/** @brief Shared SVG presentation for tool menu option icons. */
function OptionIcon({ children, valid }: IconProps & { children: ReactNode }) {
    useIconStyles(styles);
    return <Icon valid={valid} className="ts-layout-option-icon" size={22} strokeWidth={1.6}>{children}</Icon>;
}

/** @brief Alphabetical tool ordering. */
export function NameOptionIcon({ valid }: IconProps) {
    return <OptionIcon valid={valid}><path d="m3 13 4-9 4 9M5 10h4M14 14h7l-7 7h7" /></OptionIcon>;
}

/** @brief Tool call count ordering. */
export function CallsOptionIcon({ valid }: IconProps) {
    return <OptionIcon valid={valid}><path d="M4 20V4M4 20h17M8 16v-4M13 16V8M18 16V4" /></OptionIcon>;
}

/** @brief Tool query count ordering. */
export function QueriesOptionIcon({ valid }: IconProps) {
    return <OptionIcon valid={valid}><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6M7 10h6M10 7v6" /></OptionIcon>;
}

/** @brief Original tool catalog ordering. */
export function DefaultOptionIcon({ valid }: IconProps) {
    return <OptionIcon valid={valid}><path d="M9 5h12M9 12h12M9 19h12M3 4h1v3M3 11h2l-2 3h2M3 18h2v3H3" /></OptionIcon>;
}

/** @brief Tool card grid view. */
export function CardsOptionIcon({ valid }: IconProps) {
    return <OptionIcon valid={valid}><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></OptionIcon>;
}

/** @brief Detailed tool list view. */
export function ListOptionIcon({ valid }: IconProps) {
    return <OptionIcon valid={valid}><path d="M3 5h18M3 10h18M3 15h18M3 20h18M8 5v15M16 5v15" /></OptionIcon>;
}

/** @brief Grouping by tool category. */
export function TypeOptionIcon({ valid }: IconProps) {
    return <OptionIcon valid={valid}><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="3" y="15" width="6" height="6" rx="1" /><path d="M13 6h8M13 18h8" /></OptionIcon>;
}

/** @brief Grouping by source component. */
export function SourceOptionIcon({ valid }: IconProps) {
    return <OptionIcon valid={valid}><rect x="8" y="2" width="8" height="6" rx="1" /><path d="M12 8v5M5 17v-4h14v4" /><rect x="2" y="17" width="6" height="5" rx="1" /><rect x="16" y="17" width="6" height="5" rx="1" /></OptionIcon>;
}

/** @brief Ungrouped tools and fallback for unknown options. */
export function NoneOptionIcon({ valid }: IconProps) {
    return <OptionIcon valid={valid}><path d="M4 6h16M4 12h16M4 18h16" /></OptionIcon>;
}
