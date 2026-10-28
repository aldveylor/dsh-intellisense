import { useEffect, useId, useRef, useState } from 'react';
import { ActionButton } from '../../controls/action_button.js';
import { useTranslation } from '../../locale/locale.js';

/** @brief Mutually exclusive categories of physical tool cards. */
export type ToolCategory = 'unmounted' | 'mounted' | 'fixed';

export const toolCategories: ToolCategory[] = ['unmounted', 'mounted', 'fixed'];

/** @brief Animated filter dropdown with whole-row category toggles and keyboard dismissal. */
export function ToolFilter({ value, disabled, onChange }: {
    value: ToolCategory[]; disabled: boolean; onChange: (value: ToolCategory[]) => void;
}) {
    const t = useTranslation();
    const [phase, setPhase] = useState<'closed' | 'open' | 'closing'>('closed');
    const root = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const menuId = useId();
    const open = phase === 'open';

    useEffect(() => {
        if (!open) return;
        /** @brief Dismiss when a pointer or keyboard focus leaves the filter control. */
        function outside(event: Event): void {
            if (!root.current?.contains(event.target as Node)) setPhase('closing');
        }
        document.addEventListener('pointerdown', outside);
        document.addEventListener('focusin', outside);
        return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
    }, [open]);

    return <div className="ts-tool-filter" ref={root} data-active={value.length !== toolCategories.length} onKeyDown={event => {
        if (event.key === 'Escape') {
            event.preventDefault(); event.stopPropagation(); setPhase('closing'); trigger.current?.focus();
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) { setPhase('open'); return; }
            const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('.ts-tool-filter-option') ?? []);
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        }
    }}>
        <ActionButton className="ts-tool-filter-trigger" ref={trigger} aria-label={t('tool_filter')} title={t('tool_filter_hint')}
            aria-expanded={open} aria-controls={menuId} aria-haspopup="menu" disabled={disabled}
            onClick={() => setPhase(current => current === 'open' ? 'closing' : 'open')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path className="ts-filter-funnel" d="M3 4h18l-7 8v7l-4 2v-9z" />
                <circle className="ts-filter-dot" cx="19" cy="18" r="3" fill="currentColor" stroke="none" />
            </svg>
        </ActionButton>
        {phase !== 'closed' && <div id={menuId} className="ts-tool-filter-menu" data-phase={phase} role="menu" aria-label={t('tool_filter')}
            aria-hidden={!open} ref={element => { if (element) element.inert = !open; }}
            onAnimationEnd={event => { if (event.target === event.currentTarget && phase === 'closing') setPhase('closed'); }}>
            {toolCategories.map(category => <button key={category} type="button" className="ts-tool-filter-option" role="menuitemcheckbox"
                value={category} aria-checked={value.includes(category)} disabled={disabled}
                onClick={() => onChange(value.includes(category) ? value.filter(item => item !== category) : [...value, category])}>
                <svg className="ts-tool-filter-check" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <rect x="2" y="2" width="16" height="16" rx="3" />
                    <path d="m5 10 3 3 7-7" />
                </svg>
                <span>{t(`tool_filter_${category}`)}</span>
            </button>)}
        </div>}
    </div>;
}
