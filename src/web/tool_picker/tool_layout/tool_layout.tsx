import type { IconProps } from '../../ui/icons/icon.js';
import { useEffect, useId, useRef, useState, type ComponentType } from 'react';
import { ActionButton } from '../../ui/controls/action_button.js';
import { useTranslation } from '../../locale/locale.js';
import { NameOptionIcon, CallsOptionIcon, QueriesOptionIcon, DefaultOptionIcon, CardsOptionIcon, ListOptionIcon, TypeOptionIcon, SourceOptionIcon, NoneOptionIcon } from './option_icons.js';

import { SortMenuIcon, GroupMenuIcon, ViewMenuIcon, MenuChevronIcon } from './animated_icons.js';

const optionIcons: Record<string, ComponentType<IconProps>> = {
    name: NameOptionIcon, calls: CallsOptionIcon, queries: QueriesOptionIcon, default: DefaultOptionIcon,
    cards: CardsOptionIcon, list: ListOptionIcon, type: TypeOptionIcon, source: SourceOptionIcon, none: NoneOptionIcon,
};

const menuIcons: Record<'sort' | 'group' | 'view', ComponentType<IconProps & { open: boolean; value: string }>> = {
    sort: SortMenuIcon, group: GroupMenuIcon, view: ViewMenuIcon,
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
    const MenuIcon = menuIcons[kind];

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
            <MenuIcon valid={!disabled} open={open} value={value} />
            <span>{t(`tool_${kind}`)}</span>
            <MenuChevronIcon valid={!disabled} open={open} />
        </ActionButton>
        {phase !== 'closed' && <div id={menuId} role="menu" aria-label={t(`tool_${kind}`)} className="ts-tool-filter-menu" data-phase={phase}
            aria-hidden={!open} ref={element => { if (element) element.inert = !open; }}
            onAnimationEnd={event => { if (event.target === event.currentTarget && phase === 'closing') setPhase('closed'); }}>
            {options.map(option => {
                const Icon = optionIcons[option] ?? NoneOptionIcon;
                return <button type="button" key={option} className="ts-tool-filter-option" role="menuitemradio"
                    aria-checked={value === option} disabled={disabled} onClick={() => { onChange(option); setPhase('closing'); trigger.current?.focus(); }}>
                    <Icon valid={!disabled} /><span>{t(`tool_${kind}_${option}`)}</span>
                </button>;
            })}
        </div>}
    </div>;
}
