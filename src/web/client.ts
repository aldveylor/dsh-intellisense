import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import { createElement } from 'react';
import { NativeConfigurationSelect } from './configuration_select/native_select.js';
import { ManagementPanel, type ManagementPanelProps } from './management_panel.js';

export const inject = ['slots'];

/** @brief Supply native configuration controls to the SettingsPanel section. */
function NamespaceSettings(props: ManagementPanelProps) {
    return createElement(ManagementPanel, { ...props, ConfigurationSelect: NativeConfigurationSelect });
}

/** @brief Register the namespace manager as a native SettingsPanel navigation section. */
export function apply(ctx: Context): void {
    ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'ts-intellisense', order: 30, label: '工具命名空间',
        inject: () => ({ api: new URL('api/ts-intellisense-state', document.baseURI).href }),
    }, NamespaceSettings));
}
