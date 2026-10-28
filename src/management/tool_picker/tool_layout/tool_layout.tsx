import { useEffect, useId, useRef, useState } from 'react';
import { ActionButton } from '../../controls/action_button.js';
import { useTranslation } from '../../locale/locale.js';

/** @brief Distinct menu glyphs for the supported grouping and view choices. */
function LayoutOptionIcon({ option }: { option: string }) {
    return <svg className="ts-layout-option-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {option === 'cards' ? <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>
            : option === 'list' ? <path d="M3 5h18M3 10h18M3 15h18M3 20h18M8 5v15M16 5v15" />
                : option === 'type' ? <><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="3" y="15" width="6" height="6" rx="1" /><path d="M13 6h8M13 18h8" /></>
                    : option === 'source' ? <><rect x="8" y="2" width="8" height="6" rx="1" /><path d="M12 8v5M5 17v-4h14v4" /><rect x="2" y="17" width="6" height="5" rx="1" /><rect x="16" y="17" width="6" height="5" rx="1" /></>
                        : <path d="M4 6h16M4 12h16M4 18h16" />}
    </svg>;
}

/** @brief Single-choice layout menu with animated SVG states and keyboard navigation. */
export function ToolLayout({ kind, value, options, disabled, onChange }: {
    kind: 'group' | 'view'; value: string; options: string[]; disabled: boolean; onChange: (value: string) => void;
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
                {kind === 'group' ? <><path className="ts-group-branch" d="M5 4v16m0-13h5m-5 10h5" /><rect className="ts-group-top" x="11" y="3" width="9" height="7" rx="2" /><rect className="ts-group-bottom" x="11" y="14" width="9" height="7" rx="2" /></> :
                    <>{[0, 1, 2, 3].map(index => <rect key={index} className={`ts-view-cell ts-view-cell-${index}`} x={3 + (index % 2) * 11} y={3 + Math.floor(index / 2) * 11} width="7" height="7" rx="1" />)}</>}
            </svg>
            <span>{t(`tool_${kind}`)}</span>
            <svg className="ts-layout-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </ActionButton>
        {phase !== 'closed' && <div id={menuId} role="menu" aria-label={t(`tool_${kind}`)} className="ts-tool-filter-menu" data-phase={phase}
            aria-hidden={!open} ref={element => { if (element) element.inert = !open; }}
            onAnimationEnd={event => { if (event.target === event.currentTarget && phase === 'closing') setPhase('closed'); }}>
            {options.map(option => <button type="button" key={option} className="ts-tool-filter-option" role="menuitemradio"
                aria-checked={value === option} disabled={disabled} onClick={() => { onChange(option); setPhase('closing'); trigger.current?.focus(); }}>
                <LayoutOptionIcon option={option} /><span>{t(`tool_${kind}_${option}`)}</span>
            </button>)}
        </div>}
    </div>;
}
