import { createContext, useContext, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** @brief Shared tooltip controls; pointer movement updates the floating element directly. */
interface TooltipControls {
    id: string;
    show: (content: ReactNode, x: number, y: number) => void;
    move: (x: number, y: number) => void;
    hide: () => void;
}

const TooltipContext = createContext<TooltipControls | undefined>(undefined);

/** @brief A pointer-following tooltip in the top layer, including inside modal dialogs. */
export function Tooltip({ id, children, position, element }: {
    id: string; children: ReactNode; position: () => void; element: React.RefObject<HTMLDivElement>;
}) {
    useLayoutEffect(() => {
        const node = element.current;
        node?.setAttribute('popover', 'manual');
        node?.showPopover?.();
        position();
        return () => { node?.hidePopover?.(); };
    }, [children, element, position]);

    return <div ref={element} id={id} role="tooltip" className="ts-tooltip">{children}</div>;
}

/** @brief Share one floating tooltip across anchors without rerendering cards on pointer movement. */
export function TooltipProvider({ children }: { children: ReactNode }) {
    const id = useId();
    const element = useRef<HTMLDivElement>(null);
    const point = useRef({ x: 0, y: 0 });
    const [content, setContent] = useState<ReactNode>();

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
        show: (next, x, y) => { point.current = { x, y }; setContent(next); },
        move: (x, y) => { point.current = { x, y }; position(); },
        hide: () => setContent(undefined),
    }}>
        <div className="ts-tooltip-scope" onScrollCapture={() => setContent(undefined)} onKeyDownCapture={event => {
            if (event.key === 'Escape' && content !== undefined) { event.preventDefault(); event.stopPropagation(); setContent(undefined); }
        }}>{children}</div>
        {content !== undefined && <Tooltip id={id} element={element} position={position}>{content}</Tooltip>}
    </TooltipContext.Provider>;
}

/** @brief Access the enclosing provider's shared tooltip. */
export function useTooltip(): TooltipControls {
    const controls = useContext(TooltipContext);
    if (!controls) throw new Error('Tooltip requires TooltipProvider');
    return controls;
}
