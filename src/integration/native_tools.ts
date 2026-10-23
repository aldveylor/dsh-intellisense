import { createHash } from 'node:crypto';
import type { ManifestEntry } from './namespace.js';

/** @brief Bind namespace paths to unique API-safe names without shadowing physical tools. */
export function nativeBindings(entries: ManifestEntry[], reserved: Iterable<string>): { entry: ManifestEntry; name: string }[] {
    const used = new Set(reserved);
    return entries.map(entry => {
        const encoded = 'ns_' + entry.path.replace(/[^a-zA-Z0-9-]/g, char => char === '.' ? '__' : `_${char.charCodeAt(0).toString(16)}_`);
        const base = encoded.length <= 64 ? encoded : 'ns_' + createHash('sha256').update(entry.path).digest('hex').slice(0, 60);
        let name = base;
        for (let index = 1; used.has(name); index++) {
            const suffix = `_${index}`;
            name = base.slice(0, 64 - suffix.length) + suffix;
        }
        used.add(name);
        return { entry, name };
    });
}
