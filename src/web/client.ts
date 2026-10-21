import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client';
import { registerReplTrajectory } from './execution_trace/trajectory.js';
import { ManagementPanel } from './management_panel.js';

export const inject = ['slots'];

/** @brief Register global namespace configuration in the native Plugins page. */
export function apply(ctx: Context): void {
    registerReplTrajectory(ctx);
    ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config', key: 'dsh-ts-intellisense',
        inject: () => ({ api: new URL('api/ts-intellisense-state', document.baseURI).href }),
    }, ManagementPanel));
}
