import type { EditableTextWidthContext } from '../../ui/controls/editable_text.js';

/** @brief Fit the original node name with room for at least twenty monospace characters. */
export function nameWidth({ textWidth, measureText }: EditableTextWidthContext): number {
    return Math.max(textWidth, measureText('0'.repeat(20)));
}
