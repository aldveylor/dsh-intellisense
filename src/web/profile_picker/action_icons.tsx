import type { ReactNode } from 'react';
import { Icon, useIconStyles, type IconProps } from '../ui/icons/icon.js';
import styles from './action_icons.css';

/** @brief Explicit asynchronous animation state and complete-cycle notification. */
export interface ActionIconProps extends IconProps {
    running: boolean;
    onCycle: () => void;
}

/** @brief Keep action animation and SVG cycle filtering inside the icon. */
function ActionIcon({ valid, running, onCycle, action, children }: ActionIconProps & { action: string; children: ReactNode }) {
    useIconStyles(styles);
    return <><Icon valid={valid} className="ts-action-icon" data-action={action} data-running={running}
        onAnimationIteration={event => {
            if (valid && running && event.target === event.currentTarget) onCycle();
        }}>{children}</Icon></>;
}

/** @brief Animated refresh operation icon. */
export function RefreshIcon(props: ActionIconProps) {
    return <ActionIcon {...props} action="refresh"><path d="M20 7v5h-5M4 17v-5h5M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9" /></ActionIcon>;
}

/** @brief Animated save operation icon. */
export function SaveIcon(props: ActionIconProps) {
    return <ActionIcon {...props} action="save"><path className="ts-archive-box" d="M4 11h16v10H4zM3 8h18v3H3zM10 15h4" />
                <g className="ts-archive-paper"><path d="M7 8V2h7l3 3v3M10 4h3M10 6h4" /></g>
                <path className="ts-archive-seal" d="M3 8h18" /></ActionIcon>;
}

/** @brief Animated save as operation icon. */
export function SaveAsIcon(props: ActionIconProps) {
    return <ActionIcon {...props} action="save_as"><path d="M11 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10l4 4v4M7 7h6M7 11h4" />
                <path className="ts-action-pen" d="m14 21 1-4 5-5 3 3-5 5-4 1ZM18 14l3 3" /></ActionIcon>;
}

/** @brief Animated download operation icon. */
export function DownloadIcon(props: ActionIconProps) {
    return <ActionIcon {...props} action="download"><path className="ts-transfer-arrow" d="M12 3v12m-5-5 5 5 5-5" /><path d="M4 16v5h16v-5" /></ActionIcon>;
}

/** @brief Animated upload operation icon. */
export function UploadIcon(props: ActionIconProps) {
    return <ActionIcon {...props} action="upload"><path className="ts-transfer-arrow" d="M12 15V3m-5 5 5-5 5 5" /><path d="M4 16v5h16v-5" /></ActionIcon>;
}
