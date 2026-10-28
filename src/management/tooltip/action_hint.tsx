import { forwardRef, useRef, type ComponentProps, type ComponentType } from 'react';
import type { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import { useTooltip } from './tooltip.js';

/** @brief Show an action followed by a subdued explanation of its effect. */
export function ActionHint({ action, description }: { action: string; description: string }) {
    return <div className="ts-action-hint"><strong>{action}</strong><span>{description}</span></div>;
}

/** @brief A native or portable button with a two-line pointer and keyboard hint. */
export const HintButton = forwardRef<HTMLButtonElement, ComponentProps<typeof Button> & {
    action?: string; render?: ComponentType<ComponentProps<typeof Button>>;
}>(function HintButton({ action, title, render: Renderer, children, onPointerEnter, onPointerMove, onPointerLeave, onPointerDownCapture, onKeyDownCapture, onFocus, onBlur, onClick, ...props }, ref) {
    const tooltip = useTooltip();
    const pointerFocus = useRef(false);
    const label = action ?? props['aria-label'] ?? (typeof children === 'string' ? children : '');
    const content = <ActionHint action={label} description={title ?? ''} />;
    const events = {
        'aria-describedby': title ? tooltip.id : props['aria-describedby'],
        onPointerEnter: ((event) => {
            onPointerEnter?.(event);
            if (title) tooltip.show(content, event.clientX, event.clientY);
        }) as NonNullable<typeof onPointerEnter>,
        onPointerMove: ((event) => {
            onPointerMove?.(event);
            if (title) { event.stopPropagation(); tooltip.move(event.clientX, event.clientY, event.ctrlKey); }
        }) as NonNullable<typeof onPointerMove>,
        onPointerLeave: ((event) => { onPointerLeave?.(event); if (title) tooltip.leave(); }) as NonNullable<typeof onPointerLeave>,
        onPointerDownCapture: ((event) => {
            onPointerDownCapture?.(event);
            pointerFocus.current = true;
            if (title) tooltip.hide();
        }) as NonNullable<typeof onPointerDownCapture>,
        onKeyDownCapture: ((event) => { onKeyDownCapture?.(event); pointerFocus.current = false; }) as NonNullable<typeof onKeyDownCapture>,
        onFocus: ((event) => {
            onFocus?.(event);
            if (title) {
                event.stopPropagation();
                if (pointerFocus.current) return;
                const rect = event.currentTarget.getBoundingClientRect();
                tooltip.show(content, rect.left, rect.bottom);
            }
        }) as NonNullable<typeof onFocus>,
        onBlur: ((event) => { onBlur?.(event); pointerFocus.current = false; if (title) tooltip.leave(); }) as NonNullable<typeof onBlur>,
        onClick: ((event) => { if (title) tooltip.hide(); onClick?.(event); }) as NonNullable<typeof onClick>,
    };
    if (Renderer) return <Renderer type="button" {...props} {...events} ref={ref}>{children}</Renderer>;
    const { variant, size, ...html } = props;
    return <button type="button" {...html} {...events} ref={ref} data-variant={variant} data-size={size}>{children}</button>;
});
