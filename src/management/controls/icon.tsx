import type { ReactNode, SVGProps } from 'react';
import styles from './icon.css';

/** @brief Enable icon animation independently of its displayed state. */
export interface IconProps { valid: boolean }

/** @brief Shared SVG surface; individual icons own their state and hover behavior. */
export function Icon({ valid, children, size = 20, className = '', ...props }: IconProps & SVGProps<SVGSVGElement> & { size?: number; children: ReactNode }) {
    return <><style>{styles}</style><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}
        className={`ts-icon ${className}`} data-valid={valid}>{children}</svg></>;
}
