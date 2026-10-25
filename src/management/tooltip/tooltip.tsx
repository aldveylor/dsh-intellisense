import { createContext, useContext, useId, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** @brief Shared tooltip controls; pointer movement updates the floating element directly. */
interface TooltipControls {
    id: string;
    show: (content: ReactNode, x: number, y: number) => void;
    move: (x: number, y: number, altKey: boolean) => void;
    leave: () => void;
    hide: () => void;
}

const TooltipContext = createContext<TooltipControls | undefined>(undefined);

/** @brief A pointer-following tooltip in the top layer, including inside modal dialogs. */
export function Tooltip({ id, children, position, element, enter, leave }: {
    id: string; children: ReactNode; position: () => void; element: React.RefObject<HTMLDivElement>;
    enter: () => void; leave: () => void;
}) {
    const pointerInside = useRef(false);

    useLayoutEffect(() => {
        const node = element.current;
        node?.setAttribute('popover', 'manual');
        node?.showPopover?.();
        position();
        return () => { node?.hidePopover?.(); };
    }, [children, element, position]);

    useEffect(() => {
        const node = element.current;
        if (!node) return;
        let previous = performance.now();
        let resumeAt = previous + 800;
        let offset = node.scrollTop;
        let direction = 1;
        let frame: number;

        /** @brief Slowly scroll overflowing content, pausing for hover and at either end. */
        function scroll(time: number): void {
            if (!node) return;
            const elapsed = Math.min(time - previous, 64);
            previous = time;
            if (pointerInside.current || document.hidden) {
                offset = node.scrollTop;
                resumeAt = time + 600;
            } else {
                const limit = Math.max(0, node.scrollHeight - node.clientHeight);
                if (limit > 0 && time >= resumeAt) {
                    offset = Math.max(0, Math.min(limit, offset + direction * elapsed * 0.025));
                    node.scrollTop = offset;
                    if (offset === 0 || offset === limit) { direction *= -1; resumeAt = time + 1000; }
                }
            }
            frame = requestAnimationFrame(scroll);
        }

        frame = requestAnimationFrame(scroll);
        return () => cancelAnimationFrame(frame);
    }, [children, element]);

    return <div ref={element} id={id} role="tooltip" className="ts-tooltip"
        onPointerEnter={() => { pointerInside.current = true; enter(); }}
        onPointerLeave={() => { pointerInside.current = false; leave(); }}>{children}</div>;
}

/** @brief Share one floating tooltip across anchors without rerendering cards on pointer movement. */
export function TooltipProvider({ children }: { children: ReactNode }) {
    const id = useId();
    const element = useRef<HTMLDivElement>(null);
    const point = useRef({ x: 0, y: 0 });
    const [content, setContent] = useState<ReactNode>();
    const alt = useRef(false);
    const hovered = useRef<'anchor' | 'tooltip'>();
    const hideTimer = useRef<ReturnType<typeof setTimeout>>();

    /** @brief Cancel dismissal while crossing the gap into the tooltip. */
    function cancelHide(): void {
        clearTimeout(hideTimer.current);
        hideTimer.current = undefined;
    }

    /** @brief Immediately dismiss for explicit actions such as selection or Escape. */
    function hide(): void {
        cancelHide();
        setContent(undefined);
    }

    /** @brief Allow pointer transfer to the tooltip and keep Alt-held details open. */
    function scheduleHide(): void {
        cancelHide();
        if (alt.current || hovered.current) return;
        hideTimer.current = setTimeout(() => setContent(undefined), 200);
    }

    useEffect(() => {
        /** @brief Track Alt even when the pointer is outside the original card. */
        function keydown(event: KeyboardEvent): void {
            if (event.key === 'Alt') { alt.current = true; cancelHide(); }
        }

        /** @brief Resume normal dismissal when Alt is released outside both regions. */
        function keyup(event: KeyboardEvent): void {
            if (event.key === 'Alt') { alt.current = false; scheduleHide(); }
        }

        /** @brief Clear held modifiers and dismiss when the browser loses focus. */
        function blur(): void { alt.current = false; hovered.current = undefined; hide(); }

        window.addEventListener('keydown', keydown);
        window.addEventListener('keyup', keyup);
        window.addEventListener('blur', blur);
        return () => {
            cancelHide();
            window.removeEventListener('keydown', keydown);
            window.removeEventListener('keyup', keyup);
            window.removeEventListener('blur', blur);
        };
    }, []);

    /** @brief Flip around the pointer and clamp the tooltip inside the viewport. */
    function position(): void {
        const node = element.current;
        if (!node) return;
        const { width, height } = node.getBoundingClientRect();
        const { x, y } = point.current;
        node.style.left = `${Math.max(8, Math.min(x + width + 20 > window.innerWidth ? x - width - 16 : x + 16, window.innerWidth - width - 8))}px`;
        node.style.top = `${Math.max(8, Math.min(y + height + 20 > window.innerHeight ? y - height - 16 : y + 16, window.innerHeight - height - 8))}px`;
    }

    return <TooltipContext.Provider value={{ id,
        show: (next, x, y) => {
            cancelHide(); hovered.current = 'anchor';
            if (alt.current && element.current) return;
            point.current = { x, y }; setContent(next);
        },
        move: (x, y, altKey) => {
            alt.current = altKey;
            if (altKey) return;
            point.current = { x, y }; position();
        },
        leave: () => { if (hovered.current === 'anchor') hovered.current = undefined; scheduleHide(); },
        hide,
    }}>
        <div className="ts-tooltip-scope" onScrollCapture={hide} onKeyDownCapture={event => {
            if (event.key === 'Escape' && content !== undefined) { event.preventDefault(); event.stopPropagation(); hide(); }
        }}>{children}</div>
        {content !== undefined && <Tooltip id={id} element={element} position={position}
            enter={() => { hovered.current = 'tooltip'; cancelHide(); }}
            leave={() => { hovered.current = undefined; scheduleHide(); }}>{content}</Tooltip>}
    </TooltipContext.Provider>;
}

/** @brief Access the enclosing provider's shared tooltip. */
export function useTooltip(): TooltipControls {
    const controls = useContext(TooltipContext);
    if (!controls) throw new Error('Tooltip requires TooltipProvider');
    return controls;
}
