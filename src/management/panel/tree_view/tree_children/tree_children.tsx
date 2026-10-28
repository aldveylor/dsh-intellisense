import { useEffect, useState, type ReactNode } from 'react';

/** @brief Let CSS resize the child container and release its contents after closing. */
export function TreeChildren({ open, children }: { open: boolean; children: ReactNode }) {
    const [present, setPresent] = useState(open);
    useEffect(() => { if (open) setPresent(true); }, [open]);
    return <div className="ts-tree-children" data-open={open} aria-hidden={!open}
        ref={element => { if (element) element.inert = !open; }} onTransitionEnd={event => {
            if (event.target === event.currentTarget && event.propertyName === 'grid-template-rows' && !open) setPresent(false);
        }}><ul>{(open || present) && children}</ul></div>;
}

