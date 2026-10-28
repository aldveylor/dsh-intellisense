import { useEffect, useId, useRef, useState, type ComponentType } from 'react';
import { ActionButton } from '../../controls/action_button.js';
import { useTranslation } from '../../locale/locale.js';
import { NameOptionIcon, CallsOptionIcon, QueriesOptionIcon, DefaultOptionIcon, CardsOptionIcon, ListOptionIcon, TypeOptionIcon, SourceOptionIcon, NoneOptionIcon } from './option_icons.js';

const optionIcons: Record<string, ComponentType> = {
    name: NameOptionIcon, calls: CallsOptionIcon, queries: QueriesOptionIcon, default: DefaultOptionIcon,
    cards: CardsOptionIcon, list: ListOptionIcon, type: TypeOptionIcon, source: SourceOptionIcon, none: NoneOptionIcon,
};

/** @brief Shared single-choice tool menu with animated SVG states and keyboard navigation. */
export function ToolLayout({ kind, value, options, disabled, onChange }: {
    kind: 'sort' | 'group' | 'view'; value: string; options: string[]; disabled: boolean; onChange: (value: string) => void;
}) {
    const t = useTranslation();
    const [phase, setPhase] = useState<'closed' | 'open' | 'closing'>('closed');
    const root = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const menuId = useId();
    const open = phase === 'open';

    useEffect(() => {
        if (!open) return;
        /** @brief Close the menu when pointer or focus leaves it. */
        function outside(event: Event): void {
            if (!root.current?.contains(event.target as Node)) setPhase('closing');
        }
        document.addEventListener('pointerdown', outside);
        document.addEventListener('focusin', outside);
        return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
    }, [open]);

    return <div ref={root} className={`ts-tool-filter ts-tool-layout ts-tool-${kind}`} data-value={value} onKeyDown={event => {
        if (event.key === 'Escape') {
            event.preventDefault(); event.stopPropagation(); setPhase('closing'); trigger.current?.focus();
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) { setPhase('open'); return; }
            const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]') ?? []);
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            items[(index < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length)]?.focus();
        }
    }}>
        <ActionButton type="button" ref={trigger} className="ts-tool-filter-trigger" disabled={disabled}
            aria-label={t(`tool_${kind}`)} title={`${t(`tool_${kind}`)}: ${t(`tool_${kind}_${value}`)}`}
            aria-expanded={open} aria-controls={menuId} aria-haspopup="menu"
            onClick={() => setPhase(current => current === 'open' ? 'closing' : 'open')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {kind === 'sort' ? <><path d="M6 4v16m-3-3 3 3 3-3" /><path className="ts-sort-menu-bars" d="M12 5h9M12 12h6M12 19h3" /></>
                    : kind === 'group' ? <><path className="ts-group-branch" d="M5 4v16m0-13h5m-5 10h5" /><rect className="ts-group-top" x="11" y="3" width="9" height="7" rx="2" /><rect className="ts-group-bottom" x="11" y="14" width="9" height="7" rx="2" /></> :
                    <>{[0, 1, 2, 3].map(index => <rect key={index} className={`ts-view-cell ts-view-cell-${index}`} x={3 + (index % 2) * 11} y={3 + Math.floor(index / 2) * 11} width="7" height="7" rx="1" />)}</>}
            </svg>
            <span>{t(`tool_${kind}`)}</span>
            <svg className="ts-layout-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </ActionButton>
        {phase !== 'closed' && <div id={menuId} role="menu" aria-label={t(`tool_${kind}`)} className="ts-tool-filter-menu" data-phase={phase}
            aria-hidden={!open} ref={element => { if (element) element.inert = !open; }}
            onAnimationEnd={event => { if (event.target === event.currentTarget && phase === 'closing') setPhase('closed'); }}>
            {options.map(option => {
                const Icon = optionIcons[option] ?? NoneOptionIcon;
                return <button type="button" key={option} className="ts-tool-filter-option" role="menuitemradio"
                aria-checked={value === option} disabled={disabled} onClick={() => { onChange(option); setPhase('closing'); trigger.current?.focus(); }}>
                <Icon /><span>{t(`tool_${kind}_${option}`)}</span>
            </button>;
            })}
        </div>}
    </div>;
}
