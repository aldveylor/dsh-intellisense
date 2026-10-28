import { createContext, useContext, useId, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** @brief Shared tooltip controls; pointer movement updates the floating element directly. */
interface TooltipControls {
    id: string;
    show: (content: ReactNode, x: number, y: number) => void;
    move: (x: number, y: number, ctrlKey: boolean) => void;
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
    const hovered = useRef<'anchor' | 'tooltip'>();
    const hideTimer = useRef<ReturnType<typeof setTimeout>>();
    const settleTimer = useRef<ReturnType<typeof setTimeout>>();
    const settled = useRef(false);

    /** @brief Keep following tooltips transparent to pointer hit testing until interaction is enabled. */
    function updateInteractivity(): void {
        if (element.current) element.current.style.pointerEvents = settled.current ? 'auto' : 'none';
    }

    /** @brief Cancel dismissal while crossing the gap into the tooltip. */
    function cancelHide(): void {
        clearTimeout(hideTimer.current);
        hideTimer.current = undefined;
    }

    /** @brief Cancel pending pointer rest detection without releasing an already fixed tooltip. */
    function cancelSettle(): void {
        clearTimeout(settleTimer.current);
        settleTimer.current = undefined;
    }

    /** @brief Fix the current tooltip after pointer rest or an immediate Ctrl shortcut. */
    function settle(): void {
        cancelSettle();
        if (!element.current) return;
        settled.current = true;
        updateInteractivity();
        scheduleHide();
    }

    /** @brief Fix the current tooltip after the pointer rests on its anchor for 500ms. */
    function scheduleSettle(): void {
        cancelSettle();
        if (settled.current || hovered.current !== 'anchor') return;
        settleTimer.current = setTimeout(settle, 500);
    }

    /** @brief Immediately dismiss for explicit actions such as selection or Escape. */
    function hide(): void {
        cancelHide();
        cancelSettle();
        settled.current = false;
        setContent(undefined);
    }

    /** @brief Allow pointer transfer into a fixed tooltip. */
    function scheduleHide(): void {
        cancelHide();
        if (hovered.current === 'anchor' || (settled.current && hovered.current === 'tooltip')) return;
        hideTimer.current = setTimeout(hide, 200);
    }

    useEffect(() => {
        /** @brief Trigger the same fixed state as completing the pointer rest timer. */
        function keydown(event: KeyboardEvent): void {
            if (event.key === 'Control') settle();
        }

        /** @brief Synchronize held Ctrl for newly mounted providers and outside-anchor movement. */
        function pointermove(event: PointerEvent): void {
            if (event.ctrlKey && !settled.current) settle();
        }

        /** @brief Dismiss when the browser loses focus. */
        function blur(): void { hovered.current = undefined; hide(); }

        window.addEventListener('keydown', keydown, true);
        window.addEventListener('pointermove', pointermove, true);
        window.addEventListener('blur', blur);
        return () => {
            cancelHide();
            cancelSettle();
            window.removeEventListener('keydown', keydown, true);
            window.removeEventListener('pointermove', pointermove, true);
            window.removeEventListener('blur', blur);
        };
    }, []);

    /** @brief Flip around the pointer and clamp the tooltip inside the viewport. */
    function position(): void {
        const node = element.current;
        if (!node) return;
        updateInteractivity();
        const { width, height } = node.getBoundingClientRect();
        const { x, y } = point.current;
        node.style.left = `${Math.max(8, Math.min(x + width + 20 > window.innerWidth ? x - width - 16 : x + 16, window.innerWidth - width - 8))}px`;
        node.style.top = `${Math.max(8, Math.min(y + height + 20 > window.innerHeight ? y - height - 16 : y + 16, window.innerHeight - height - 8))}px`;
    }

    return <TooltipContext.Provider value={{ id,
        show: (next, x, y) => {
            cancelHide(); hovered.current = 'anchor';
            settled.current = false;
            point.current = { x, y }; setContent(next);
            scheduleSettle();
        },
        move: (x, y, ctrlKey) => {
            if (ctrlKey) settle();
            if (settled.current) return;
            if (point.current.x === x && point.current.y === y) return;
            point.current = { x, y }; position();
            scheduleSettle();
        },
        leave: () => {
            if (hovered.current === 'anchor') hovered.current = undefined;
            cancelSettle(); scheduleHide();
        },
        hide,
    }}>
        <div className="ts-tooltip-scope" onScrollCapture={hide} onKeyDownCapture={event => {
            if (event.key === 'Escape' && content !== undefined) { event.preventDefault(); event.stopPropagation(); hide(); }
        }}>{children}</div>
        {content !== undefined && <Tooltip id={id} element={element} position={position}
            enter={() => { hovered.current = 'tooltip'; cancelSettle(); scheduleHide(); }}
            leave={() => { hovered.current = undefined; scheduleHide(); }}>{content}</Tooltip>}
    </TooltipContext.Provider>;
}

/** @brief Access the enclosing provider's shared tooltip. */
export function useTooltip(): TooltipControls {
    const controls = useContext(TooltipContext);
    if (!controls) throw new Error('Tooltip requires TooltipProvider');
    return controls;
}
