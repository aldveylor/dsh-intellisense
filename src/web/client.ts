import { Button, CodeBlock, InlineEditor } from '@deepseek-ai/dsh-client-ui-primitives';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client';
import { SessionProfile } from './session_profile/session_profile.js';
import { HostProfileSelect } from './profile_picker/host_profile_select.js';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { ISessions, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client';
import { NativePanel } from './panel/native_panel.js';
import { zh } from './locale/zh.js';
import { en } from './locale/en.js';
import type { LocaleKey } from './locale/locale.js';

declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** @brief Namespace editor interface text. */
        ts_intellisense: LocaleKey;
    }
}

export const inject = ['slots', 'locale', 'sessions', 'uiWorkspace', 'conversation', 'layout'];

/** @brief Register global namespace configuration in the native Plugins page. */
export function apply(ctx: Context): void {
    ctx.effect(() => ctx.locale.register('ts_intellisense', { zh, en }));
    ctx.slots.inject('conversation.hero.options', () => ctx.slots.register({
        name: 'conversation.hero.options', id: 'intellisense-profile', order: -100, locale: 'ts_intellisense',
        inject: () => ({ api: new URL('api/ts-intellisense-profile', document.baseURI).href }),
    }, SessionProfile));
    ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config', key: '@aldveylor/dsh-intellisense',
        inject: () => ({ organize: async (prompt: string) => {
            const sessions = ctx.sessions as unknown as ISessions;
            const navigation = ctx.layout.beginNavigation();
            const current = (Object.values(sessions.list.getSnapshot().byId) as SessionSummary[]).find(session => session.retainedBy.mainView);
            const id = await sessions.create({ agentPreset: 'intellisense-ptc', ...(current?.cwd ? { cwd: current.cwd } : {}) });
            await sessions.using(id, { source: 'workspaceOperation', signal: navigation }, async reference => {
                const binding = await reference.ready;
                navigation.throwIfAborted();
                if (ctx.conversation.input.requestDraftInitialization(binding, { prompt }) === 'blocked') throw new Error('draft_initialization_failed');
                ctx.uiWorkspace.openSession(id);
            });
        }, locale: ctx.locale, Button, CodeBlock, InlineEditor, DefaultProfileSelect: HostProfileSelect, api: new URL('api/ts-intellisense-state', document.baseURI).href }),
    }, NativePanel));
}
