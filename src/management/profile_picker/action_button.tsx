import { ActionHint } from '../tooltip/action_hint.js';
import type { ButtonHTMLAttributes } from 'react';
import { useTooltip } from '../tooltip/tooltip.js';

/** @brief A configuration action with shared pointer and keyboard function hints. */
export function ProfileActionButton({ label, hint = label, children, onClick, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; hint?: string }) {
    const tooltip = useTooltip();
    return <button {...props} className="ts-profile-action" aria-label={label} aria-describedby={tooltip.id}
        onPointerEnter={event => tooltip.show(<ActionHint action={label} description={hint} />, event.clientX, event.clientY)}
        onPointerMove={event => tooltip.move(event.clientX, event.clientY, event.ctrlKey)}
        onPointerLeave={tooltip.leave} onFocus={event => {
            const rect = event.currentTarget.getBoundingClientRect();
            tooltip.show(<ActionHint action={label} description={hint} />, rect.left, rect.bottom);
        }} onBlur={tooltip.leave} onClick={event => { tooltip.hide(); onClick?.(event); }}>{children}</button>;
}
