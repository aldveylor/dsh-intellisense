import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { TreeDragSource, TreeDropTarget } from './namespace_tree.js';

/** @brief Resolve a visible row and its center/edge drop zones for both drag implementations. */
export function treeDropTarget(element: HTMLElement, clientY: number): TreeDropTarget {
    const namespace = element.dataset.namespacePath;
    if (element.classList.contains('ts-namespace-placeholder')) return { path: namespace ?? '', position: 'inside' };
    const rect = element.getBoundingClientRect();
    const ratio = rect.height ? (clientY - rect.top) / rect.height : 0;
    return { path: namespace ?? element.dataset.treePath ?? '', position: namespace !== undefined && ratio >= .25 && ratio <= .75 ? 'inside' : ratio > .5 ? 'after' : 'before' };
}

/** @brief Clear shared drop feedback for pointer and native drag completion. */
export function clearTreeDropFeedback(root: ParentNode = document): void {
    root.querySelectorAll('[data-drop-edge]').forEach(node => node.removeAttribute('data-drop-edge'));
    root.querySelectorAll('.ts-drop-insertion').forEach(node => node.remove());
}

/** @brief Show a line in the destination sibling gap, or highlight a namespace destination. */
export function showTreeDropFeedback(element: HTMLElement, clientY: number): void {
    const tree = element.closest<HTMLElement>('.ts-tree');
    if (!tree) return;
    clearTreeDropFeedback(tree);
    const destination = treeDropTarget(element, clientY);
    element.dataset.dropEdge = destination.position;
    if (destination.position === 'inside') return;
    const row = element.closest('li')!;
    const rect = row.getBoundingClientRect();
    const before = destination.position === 'before';
    const sibling = before ? row.previousElementSibling : row.nextElementSibling;
    const edge = before ? rect.top : rect.bottom;
    const other = sibling?.getBoundingClientRect();
    const y = other ? (edge + (before ? other.bottom : other.top)) / 2 : edge + (before ? -5 : 5);
    const marker = document.createElement('div');
    marker.className = 'ts-drop-insertion';
    marker.style.cssText = `left:${rect.left}px;top:${y}px;width:${rect.width}px`;
    tree.append(marker);
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
        let target: HTMLElement | undefined;

        /** @brief Refresh the hit target after pointer movement, wheel scrolling or automatic scrolling. */
        function locate(): void {
            if (container.current) clearTreeDropFeedback(container.current);
            const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('.ts-node-block,.ts-tree-tool,.ts-namespace-placeholder');
            target = hit && hit.dataset.dropDisabled !== 'true' && container.current?.contains(hit) ? hit : undefined;
            if (target) showTreeDropFeedback(target, y);
        }

        /** @brief Stop scrolling and clear transient drag feedback on every completion path. */
        function finish(): void {
            cancelAnimationFrame(frame); frame = 0;
            target?.removeAttribute('data-drop-edge'); target = undefined;
            if (container.current) clearTreeDropFeedback(container.current);
            ghost?.remove(); ghost = undefined;
            container.current?.classList.remove('ts-dragging');
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
                ghost = document.createElement('div'); ghost.className = 'ts-drag-preview';
                ghost.textContent = start.source.path?.split('.').at(-1) || start.source.id || '';
                container.current?.append(ghost); frame = requestAnimationFrame(tick);
            }
            event.preventDefault();
            if (ghost) ghost.style.transform = `translate(${x + 14}px,${y + 14}px)`;
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
        pending.current = { source: { namespace: source.dataset.namespacePath !== undefined, path: source.dataset.namespacePath ?? source.dataset.treePath, id: source.dataset.toolId }, x: event.clientX, y: event.clientY, pointer: event.pointerId };
    }
    return { container, pointerDown, preventNativeDrag: (event: { preventDefault(): void; stopPropagation(): void }) => { if (pending.current) { event.preventDefault(); event.stopPropagation(); } } };
}
