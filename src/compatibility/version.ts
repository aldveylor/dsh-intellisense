import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { eq, gt, gte, lt, lte, neq, valid } from 'semver';

/** @brief Run version-specific callbacks against an immutable semantic version. */
export class Version {
    private readonly value: string;

    /** @brief Create a version from a valid SemVer string. */
    constructor(value: string) {
        const normalized = valid(value);
        if (!normalized) throw new Error(`Invalid version: ${value}`);
        this.value = normalized;
    }

    /** @brief Run the callback when this version is greater than or equal to the target. */
    gte<T>(version: string, callback: () => T): T | undefined { return gte(this.value, version) ? callback() : undefined; }

    /** @brief Run the callback when this version is greater than the target. */
    gt<T>(version: string, callback: () => T): T | undefined { return gt(this.value, version) ? callback() : undefined; }

    /** @brief Run the callback when this version is less than or equal to the target. */
    lte<T>(version: string, callback: () => T): T | undefined { return lte(this.value, version) ? callback() : undefined; }

    /** @brief Run the callback when this version is less than the target. */
    lt<T>(version: string, callback: () => T): T | undefined { return lt(this.value, version) ? callback() : undefined; }

    /** @brief Run the callback when this version equals the target. */
    eq<T>(version: string, callback: () => T): T | undefined { return eq(this.value, version) ? callback() : undefined; }

    /** @brief Run the callback when this version differs from the target. */
    neq<T>(version: string, callback: () => T): T | undefined { return neq(this.value, version) ? callback() : undefined; }
}

const require = createRequire(import.meta.url);
/** @brief Version of the DSH API package resolved by this plugin. */
export const version = new Version(JSON.parse(readFileSync(require.resolve('@deepseek-ai/dsh-tools/package.json'), 'utf8')).version);
version.lt('0.2.1-rc.2', () => { throw new Error('Unsupported DSH version: expected >=0.2.1-rc.2'); });
