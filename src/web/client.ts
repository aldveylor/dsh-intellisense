import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import { NamespaceSettings } from './namespace_settings/namespace_settings.js';

export const inject = ['slots'];

/** @brief Register the namespace manager in the native General settings rows. */
export function apply(ctx: Context): void {
    ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item', id: 'ts-intellisense', order: 30,
        inject: () => ({ api: new URL('api/ts-intellisense-state', document.baseURI).href }),
    }, NamespaceSettings));
}
