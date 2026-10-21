import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import { createElement } from 'react';
import { NativeConfigurationSelect } from './configuration_select/native_select.js';
import { ManagementPanel, type ManagementPanelProps } from './management_panel.js';

export const inject = ['slots'];

/** @brief Supply the host's shared menu primitives to the reusable registry editor. */
function HostManagementPanel(props: ManagementPanelProps) {
    return createElement(ManagementPanel, { ...props, ConfigurationSelect: NativeConfigurationSelect });
}

/** @brief Mount the React registry editor in the native Plugins settings tabs. */
export function apply(ctx: Context): void {
    ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab', id: 'ts-intellisense', order: 30, label: 'TypeScript 工具',
        inject: () => ({ api: new URL('api/ts-intellisense-state', document.baseURI).href }),
    }, HostManagementPanel));
}
