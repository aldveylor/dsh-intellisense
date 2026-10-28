import { useInsertionEffect, type ReactNode, type SVGProps } from 'react';
import styles from './icon.css';

/** @brief Enable icon animation independently of its displayed state. */
export interface IconProps { valid: boolean }

const iconStyles = new WeakMap<Document, Map<string, { element: HTMLStyleElement; users: number }>>();

/** @brief Share icon-owned styles in the document head without adding text to buttons. */
export function useIconStyles(css: string): void {
    useInsertionEffect(() => {
        let entries = iconStyles.get(document);
        if (!entries) { entries = new Map(); iconStyles.set(document, entries); }
        let entry = entries.get(css);
        if (!entry) {
            const element = document.createElement('style');
            element.textContent = css;
            document.head.append(element);
            entry = { element, users: 0 };
            entries.set(css, entry);
        }
        entry.users++;
        return () => {
            if (--entry.users === 0) { entry.element.remove(); entries.delete(css); }
        };
    }, [css]);
}

/** @brief Shared SVG surface; individual icons own their state and hover behavior. */
export function Icon({ valid, children, size = 20, className = '', ...props }: IconProps & SVGProps<SVGSVGElement> & { size?: number; children: ReactNode }) {
    useIconStyles(styles);
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}
        className={`ts-icon ${className}`} data-valid={valid}>{children}</svg>;
}
