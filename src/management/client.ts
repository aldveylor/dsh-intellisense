import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client';
import { NativeProfileSelect } from './profile_picker/native_profile_select.js';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import { NativePanel } from './locale/native_panel.js';
import { zh } from './locale/zh.js';
import { enUs } from './locale/en_us.js';
import { intellisenseTraceDefinition } from './trajectory/intellisense_trace.js';
import type { LocaleKey } from './locale/locale.js';

declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** @brief Namespace editor interface text. */
        ts_intellisense: LocaleKey;
    }
}

export const inject = ['slots', 'locale'];

/** @brief Register global namespace configuration in the native Plugins page. */
export function apply(ctx: Context): void {
    ctx.effect(() => ctx.locale.register('ts_intellisense', { zh, en: enUs }));
    ctx.inject(['uiConversation'], ctx => {
        ctx.uiConversation.events.register(intellisenseTraceDefinition(key => ctx.locale.bind('ts_intellisense')(key)));
    });
    ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config', key: 'dsh-ts-intellisense',
        inject: () => ({ locale: ctx.locale, ProfileSelect: NativeProfileSelect, api: new URL('api/ts-intellisense-state', document.baseURI).href }),
    }, NativePanel));
}
