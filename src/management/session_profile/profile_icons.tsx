import { IconDatabaseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import type { IconProps } from '../controls/icon.js';
import { ChevronIcon } from '../controls/icons.js';
import styles from './profile_icons.css';

/** @brief Preserve the host's Profile glyph behind the shared icon interface. */
export function SessionProfileIcon({ valid }: IconProps) {
    return <><style>{styles}</style><IconDatabaseOutlineRegular className="ts-session-profile-icon" data-valid={valid} /></>;
}

/** @brief Session dropdown arrow with explicit expansion and validity. */
export function SessionChevronIcon({ valid, open }: IconProps & { open: boolean }) {
    return <><style>{styles}</style><ChevronIcon valid={valid} open={open} className="ts-session-profile-chevron" /></>;
}
