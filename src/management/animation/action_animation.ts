import { useEffect, useRef, useState } from 'react';

/** @brief Loop SVG actions until their operation settles, then finish at the next full cycle. */
export function useActionAnimation() {
    const operations = useRef(new Map<string, boolean>());
    const [running, setRunning] = useState<ReadonlySet<string>>(new Set());
    const mounted = useRef(true);

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; operations.current.clear(); };
    }, []);

    /** @brief Start each operation once and keep its animation alive through success or failure. */
    async function run(name: string, operation: () => Promise<void>): Promise<void> {
        if (operations.current.has(name)) return;
        operations.current.set(name, false);
        setRunning(new Set(operations.current.keys()));
        try { await operation(); }
        finally { if (mounted.current) operations.current.set(name, true); }
    }

    /** @brief Stop a settled operation when its icon reports a full animation cycle. */
    function finish(name: string): void {
        if (!operations.current.get(name)) return;
        operations.current.delete(name);
        setRunning(new Set(operations.current.keys()));
    }

    return { running, run, finish };
}
