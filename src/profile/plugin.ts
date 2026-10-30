import type { Context } from '@deepseek-ai/cordis';
import { storageBackendServiceKey } from '@deepseek-ai/dsh-storage';
import { DshStore, type Store } from '../storage/store.js';
import { snapshotVersion, storageVersion } from '../storage/version.js';
import { SemanticRegistry } from './catalog/registry.js';
import { NamespaceComponent } from './component.js';

export const name = 'intellisense-profiles';
export const inject = ['storage', storageBackendServiceKey('json')];

/** @brief Shared persistence infrastructure carries no Profile, namespace or IntelliSense operations. */
declare module '@deepseek-ai/cordis' { interface Context { intellisenseStorage: Store } }

/** @brief Mount the standalone, lazily loaded Profile service and own only its storage lifetime. */
export async function apply(ctx: Context): Promise<void> {
    const backend = ctx.storage.backend.get('json');
    if (!backend.kv) throw new Error('DSH json backend does not support KV storage');
    const unit = await backend.kv.open({ name: 'ts_intellisense', version: storageVersion, compatibleVersions: [1, 2, 3], tables: ['state'], hasGlobal: false, layout: 'per-record' });
    const store = new DshStore(unit);
    const snapshotUnit = await backend.kv.open({ name: 'intellisense_profile_snapshots', version: snapshotVersion, compatibleVersions: [1], tables: ['state'], hasGlobal: false, layout: 'per-record' });
    const catalog = new SemanticRegistry(store, 'global', undefined, new DshStore(snapshotUnit));
    let loading: Promise<void> | undefined;
    const initialize = (recover: boolean | 'reset' = false): Promise<void> => {
        if (!recover && loading) return loading;
        const previous = loading;
        loading = (async () => { if (recover) await previous?.catch(() => {}); await catalog.load(recover); })();
        return loading;
    };
    ctx.effect(() => async () => { try { await catalog.snapshots.flush(); } finally { await snapshotUnit.close(); await unit.close(); } });
    ctx.provide('intellisenseStorage', store);
    ctx.provide('toolsNamespace', new NamespaceComponent(ctx, catalog, initialize));
}
