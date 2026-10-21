import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { KvUnit } from '@deepseek-ai/dsh-storage';

/** @brief Durable whole-value storage; callers serialize related transactions. */
export interface Store {
    load<T>(key: string): Promise<T | undefined>;
    save<T>(key: string, value: T): Promise<void>;
}

/** @brief Uses a DSH-owned KV unit and its native durability contract. */
export class DshStore implements Store {
    constructor(private unit: KvUnit) {}

    async load<T>(key: string): Promise<T | undefined> {
        const snapshot = await this.unit.loadAll();
        return snapshot.tables.state?.[key] as T | undefined;
    }

    async save<T>(key: string, value: T): Promise<void> {
        await this.unit.putRecord('state', key, value);
    }
}

/** @brief Atomic file store for explicit standalone use and tests. */
export class FileStore implements Store {
    constructor(private directory: string) {}

    private path(key: string): string {
        if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error('Invalid storage key');
        return `${this.directory}/${key}.json`;
    }

    async load<T>(key: string): Promise<T | undefined> {
        try { return JSON.parse(await readFile(this.path(key), 'utf8')) as T; }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
            throw error;
        }
    }

    async save<T>(key: string, value: T): Promise<void> {
        const path = this.path(key);
        await mkdir(dirname(path), { recursive: true });
        const temporary = `${path}.${crypto.randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
        await rename(temporary, path);
    }
}

/** @brief Detached in-memory snapshots for isolated tests. */
export class MemoryStore implements Store {
    private values = new Map<string, unknown>();

    async load<T>(key: string): Promise<T | undefined> {
        return structuredClone(this.values.get(key)) as T | undefined;
    }

    async save<T>(key: string, value: T): Promise<void> {
        this.values.set(key, structuredClone(value));
    }
}
