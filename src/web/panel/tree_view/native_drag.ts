import type { DragEvent } from 'react';
import { showTreeDropFeedback, clearTreeDropFeedback } from '../tree_drag.js';

/** @brief Mark a node as a drag target without intercepting ordinary text editing. */
export function acceptTreeDrag(event: DragEvent<HTMLElement>, busy: boolean): void {
    if (event.currentTarget.dataset.dropDisabled === 'true') { event.stopPropagation(); return; }
    if (!busy && event.dataTransfer.types.some(type => ['application/x-ts-tool', 'application/x-ts-namespace'].includes(type))) {
        event.preventDefault(); event.stopPropagation();
        showTreeDropFeedback(event.currentTarget, event.clientY);
    }
}

/** @brief Retain an insertion slot while a native drag enters another row or the slot itself. */
export function leaveTreeDrag(event: DragEvent<HTMLElement>): void {
    if (event.relatedTarget instanceof Node && event.currentTarget.closest('.ts-tree')?.contains(event.relatedTarget)) return;
    clearTreeDropFeedback();
}

