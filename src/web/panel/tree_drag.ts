import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { TreeDragSource, TreeDropTarget } from './namespace_tree.js';

/** @brief Resolve a visible row and its center/edge drop zones for both drag implementations. */
export function treeDropTarget(element: HTMLElement, clientY: number): TreeDropTarget {
    if (element.classList.contains('ts-drop-gap')) return { path: element.dataset.treePath!, position: element.dataset.dropPosition as 'before' | 'after' };
    const namespace = element.dataset.namespacePath;
    if (element.classList.contains('ts-namespace-placeholder')) return { path: namespace ?? '', position: 'inside' };
    const rect = element.getBoundingClientRect();
    const ratio = rect.height ? (clientY - rect.top) / rect.height : 0;
    return { path: namespace ?? element.dataset.treePath ?? '', position: namespace !== undefined && element.dataset.acceptsChildren !== 'false' && ratio >= .25 && ratio <= .75 ? 'inside' : ratio > .5 ? 'after' : 'before' };
}

const feedbackAnimations = new WeakMap<HTMLElement, Animation>();

/** @brief Move surrounding rows with transforms when reserving or releasing an insertion slot. */
function changeFeedback(root: ParentNode, change: () => void): void {
    const rows = Array.from(root.querySelectorAll<HTMLElement>('.ts-node-block,.ts-tree-tool,.ts-namespace-placeholder'));
    const positions = rows.map(element => element.getBoundingClientRect());
    for (const element of rows) feedbackAnimations.get(element)?.cancel();
    change();
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    rows.forEach((element, index) => {
        if (!element.isConnected) return;
        const before = positions[index]!;
        const after = element.getBoundingClientRect();
        const x = before.left - after.left; const y = before.top - after.top;
        if (!element.animate || (Math.abs(x) < .5 && Math.abs(y) < .5)) return;
        const animation = element.animate([{ transform: `translate(${x}px,${y}px)` }, { transform: 'translate(0,0)' }],
            { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' });
        feedbackAnimations.set(element, animation);
    });
}

/** @brief Clear shared drop feedback for pointer and native drag completion. */
export function clearTreeDropFeedback(root: ParentNode = document): void {
    root.querySelectorAll('[data-drop-edge]').forEach(node => node.removeAttribute('data-drop-edge'));
    if (root.querySelector('.ts-drop-gap')) changeFeedback(root, () => root.querySelectorAll('.ts-drop-gap').forEach(node => node.remove()));
}

/** @brief Reserve a blank sibling slot beside the entire subtree, or highlight an inside target. */
export function showTreeDropFeedback(element: HTMLElement, clientY: number): void {
    const tree = element.closest<HTMLElement>('.ts-tree');
    if (!tree || element.classList.contains('ts-drop-gap')) return;
    const destination = treeDropTarget(element, clientY);
    const existing = tree.querySelector<HTMLElement>('.ts-drop-gap');
    if (element.dataset.dropEdge === destination.position &&
        (destination.position === 'inside' || existing?.dataset.treePath === destination.path && existing.dataset.dropPosition === destination.position)) return;
    changeFeedback(tree, () => {
        tree.querySelectorAll('[data-drop-edge]').forEach(node => node.removeAttribute('data-drop-edge'));
        existing?.remove();
        element.dataset.dropEdge = destination.position;
        if (destination.position === 'inside') return;
        const row = element.closest('li')!;
        const gap = document.createElement('li');
        gap.className = 'ts-drop-gap';
        gap.setAttribute('aria-hidden', 'true');
        gap.dataset.treePath = destination.path;
        gap.dataset.dropPosition = destination.position;
        const source = tree.querySelector<HTMLElement>('[data-drag-source]')?.closest('li');
        gap.style.height = `${Math.max(36, Math.min(120, source?.getBoundingClientRect().height ?? 44))}px`;
        gap.addEventListener('dragover', event => { event.preventDefault(); event.stopPropagation(); });
        gap.addEventListener('drop', event => {
            event.preventDefault(); event.stopPropagation();
            const rect = element.getBoundingClientRect();
            element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: event.dataTransfer,
                clientY: destination.position === 'before' ? rect.top : rect.bottom }));
        });
        row.insertAdjacentElement(destination.position === 'before' ? 'beforebegin' : 'afterend', gap);
    });
}

/** @brief Pointer-based dragging leaves wheel events native and adds edge scrolling without browser HTML drag capture. */
export function useTreeDrag(drop: (source: TreeDragSource, target: TreeDropTarget) => void) {
    const container = useRef<HTMLDivElement>(null);
    const callback = useRef(drop); callback.current = drop;
    const pending = useRef<{ source: TreeDragSource; x: number; y: number; pointer: number }>();

    useEffect(() => {
        let active = false;
        let x = 0; let y = 0;
        let frame = 0;
        let ghost: HTMLDivElement | undefined;
        let origin: HTMLElement | undefined;
        let offsetX = 0; let offsetY = 0;
        let target: HTMLElement | undefined;

        /** @brief Refresh the hit target after pointer movement, wheel scrolling or automatic scrolling. */
        function locate(): void {
            const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('.ts-node-block,.ts-tree-tool,.ts-namespace-placeholder,.ts-drop-gap');
            target = hit && hit.dataset.dropDisabled !== 'true' && container.current?.contains(hit) ? hit : undefined;
            if (target) showTreeDropFeedback(target, y);
            else if (container.current) clearTreeDropFeedback(container.current);
        }

        /** @brief Stop scrolling and clear transient drag feedback on every completion path. */
        function finish(): void {
            cancelAnimationFrame(frame); frame = 0;
            target?.removeAttribute('data-drop-edge'); target = undefined;
            if (container.current) clearTreeDropFeedback(container.current);
            ghost?.remove(); ghost = undefined;
            origin?.classList.remove('ts-drag-origin'); origin = undefined;
            container.current?.classList.remove('ts-dragging');
            container.current?.querySelectorAll('[data-drag-source]').forEach(element => element.removeAttribute('data-drag-source'));
            active = false; pending.current = undefined;
        }

        /** @brief Scroll the tree proportionally near its upper and lower edges. */
        function tick(): void {
            if (!active) return;
            const tree = container.current?.querySelector<HTMLElement>('.ts-tree');
            if (tree) {
                const rect = tree.getBoundingClientRect();
                if (x >= rect.left && x <= rect.right && y >= rect.top - 24 && y <= rect.bottom + 24) {
                    const edge = Math.min(48, rect.height / 3);
                    const speed = y < rect.top + edge ? -Math.min(16, (rect.top + edge - y) / 3) : y > rect.bottom - edge ? Math.min(16, (y - rect.bottom + edge) / 3) : 0;
                    if (speed) tree.scrollTop += speed;
                }
            }
            locate(); frame = requestAnimationFrame(tick);
        }

        /** @brief Start only after a movement threshold so clicks and double-click editing remain available. */
        function move(event: PointerEvent): void {
            const start = pending.current;
            if (!start || event.pointerId !== start.pointer) return;
            x = event.clientX; y = event.clientY;
            if (!active && Math.hypot(x - start.x, y - start.y) < 6) return;
            if (!active) {
                active = true; container.current?.classList.add('ts-dragging');
                const handle = container.current?.querySelector<HTMLElement>('[data-drag-source]');
                origin = handle?.closest<HTMLElement>('li') ?? handle ?? undefined;
                if (!origin) { finish(); return; }
                const rect = origin.getBoundingClientRect();
                offsetX = start.x - rect.left; offsetY = start.y - rect.top;
                ghost = document.createElement('div'); ghost.className = 'ts-drag-preview';
                ghost.setAttribute('aria-hidden', 'true');
                ghost.inert = true;
                ghost.style.width = `${rect.width}px`;
                const copy = origin.cloneNode(true) as HTMLElement;
                copy.style.margin = '0';
                copy.style.color = getComputedStyle(origin).color;
                copy.style.backgroundColor = getComputedStyle(origin).backgroundColor;
                copy.removeAttribute('id');
                copy.removeAttribute('data-drag-source');
                copy.querySelectorAll('[id],[data-drag-source]').forEach(element => { element.removeAttribute('id'); element.removeAttribute('data-drag-source'); });
                ghost.append(copy);
                container.current?.append(ghost);
                origin.classList.add('ts-drag-origin');
                frame = requestAnimationFrame(tick);
            }
            event.preventDefault();
            if (ghost) ghost.style.transform = `translate(${x - offsetX}px,${y - offsetY}px)`;
            locate();
        }

        /** @brief Commit the final hit-tested destination and always release transient state. */
        function up(event: PointerEvent): void {
            if (event.pointerId !== pending.current?.pointer) return;
            if (active && target) {
                const source = pending.current.source;
                const destination = treeDropTarget(target, event.clientY);
                finish(); callback.current(source, destination);
            } else finish();
        }

        /** @brief Cancel a drag without changing configuration. */
        function key(event: KeyboardEvent): void { if (event.key === 'Escape') finish(); }
        document.addEventListener('pointermove', move, { passive: false });
        document.addEventListener('pointerup', up);
        document.addEventListener('pointercancel', finish);
        document.addEventListener('keydown', key);
        window.addEventListener('blur', finish);
        return () => {
            finish(); document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
            document.removeEventListener('pointercancel', finish); document.removeEventListener('keydown', key); window.removeEventListener('blur', finish);
        };
    }, []);

    /** @brief Capture a tool or tree identity without taking pointer capture away from scrolling. */
    function pointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
        if (event.button !== 0 || (event.target as HTMLElement).closest('input,button,select,textarea')) return;
        const source = (event.target as HTMLElement).closest<HTMLElement>('[draggable=true]');
        if (!source || !container.current?.contains(source)) return;
        source.dataset.dragSource = 'true';
        pending.current = { source: { namespace: source.dataset.namespacePath !== undefined, path: source.dataset.namespacePath ?? source.dataset.treePath, id: source.dataset.toolId }, x: event.clientX, y: event.clientY, pointer: event.pointerId };
    }
    return { container, pointerDown, preventNativeDrag: (event: { preventDefault(): void; stopPropagation(): void }) => { if (pending.current) { event.preventDefault(); event.stopPropagation(); } } };
}
