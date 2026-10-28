import { useLayoutEffect, useRef, type RefObject } from 'react';

/** @brief Animate surviving rows from their previous screen positions after deletion or reordering. */
export function useLayoutMotion(root: RefObject<HTMLElement>, selector: string, key: (element: HTMLElement) => string, disclosure?: unknown) {
    const previous = useRef(new Map<string, { left: number; top: number }>());
    const animations = useRef(new Map<HTMLElement, Animation>());
    const previousDisclosure = useRef(disclosure);

    /** @brief Preserve row identity when a subtree moves to another namespace. */
    function remap(source: string, destination: string): void {
        previous.current = new Map([...previous.current].map(([path, rect]) => [
            path === source || path.startsWith(`${source}.`) ? destination + path.slice(source.length) : path, rect,
        ]));
    }

    useLayoutEffect(() => {
        const elements = Array.from(root.current?.querySelectorAll<HTMLElement>(selector) ?? []);
        const next = new Map<string, { left: number; top: number }>();
        const origin = root.current?.getBoundingClientRect();
        const disclosing = previousDisclosure.current !== disclosure;
        previousDisclosure.current = disclosure;

        /** @brief Compare content coordinates so scrolling does not become a layout animation. */
        function position(element: HTMLElement) {
            const rect = element.getBoundingClientRect();
            const scroll = element.closest<HTMLElement>('.ts-tree,.ts-profile-options');
            return { left: rect.left - (origin?.left ?? 0) + (scroll?.scrollLeft ?? 0),
                top: rect.top - (origin?.top ?? 0) + (scroll?.scrollTop ?? 0) };
        }
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        for (const element of elements) {
            const identity = key(element);
            const before = previous.current.get(identity);
            const active = animations.current.get(element);
            // Read the visual position before cancelling an interrupted movement.
            const visual = active ? position(element) : before;
            active?.cancel();
            animations.current.delete(element);
            const after = position(element);
            next.set(identity, after);
            if (!visual || reduced || disclosing || !element.animate) continue;
            const x = visual.left - after.left;
            const y = visual.top - after.top;
            if (Math.abs(x) < .5 && Math.abs(y) < .5) continue;
            const animation = element.animate([
                { transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' },
            ], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
            animations.current.set(element, animation);
            animation.onfinish = () => {
                if (animations.current.get(element) !== animation) return;
                animations.current.delete(element);
                previous.current.set(identity, position(element));
            };
        }
        for (const [element, animation] of animations.current) if (!root.current?.contains(element)) {
            animation.cancel(); animations.current.delete(element);
        }
        previous.current = next;

        // CSS disclosure animations change layout between React commits.
        // Track their real positions without feeding active transforms back into the cache.
        const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => {
            for (const element of elements) if (!animations.current.has(element)) {
                previous.current.set(key(element), position(element));
            }
        });
        for (const element of elements) if (element.parentElement) observer?.observe(element.parentElement);
        return () => observer?.disconnect();
    });

    useLayoutEffect(() => () => {
        for (const animation of animations.current.values()) animation.cancel();
        animations.current.clear(); previous.current.clear();
    }, []);

    return remap;
}
