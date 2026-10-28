import { useContext, useMemo, useSyncExternalStore, type ComponentType } from 'react';
import { ButtonContext } from '../controls/action_button.js';
import type { Button as DshButton } from '@deepseek-ai/dsh-client-ui-primitives';
import type { ComponentProps } from 'react';
import type { CodeBlockProps } from '@deepseek-ai/dsh-client-ui-primitives';
import { CodeBlockContext } from '../code_block/code_block.js';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import { ManagementPanel, type ManagementPanelProps } from '../panel/management_panel.js';
import { TranslationContext, messageKey, type LocaleKey } from './locale.js';

/** @brief Bridge host locale revisions into the editor without remounting or losing drafts. */
export function NativePanel({ locale, CodeBlock, Button, ...props }: ManagementPanelProps & { locale: Context['locale']; CodeBlock?: ComponentType<CodeBlockProps>; Button?: ComponentType<ComponentProps<typeof DshButton>> }) {
    const inheritedBlock = useContext(CodeBlockContext);
    const snapshot = useSyncExternalStore(listener => locale.subscribe(listener), () => locale.getSnapshot());
    const t = useMemo(() => {
        const bound = locale.bind('ts_intellisense');
        return (key: string, values?: Record<string, string | number>) => {
            const known = messageKey(key);
            return known ? bound(known as LocaleKey, values) : key;
        };
    }, [locale, snapshot.revision]);
    return <TranslationContext.Provider value={t}><CodeBlockContext.Provider value={CodeBlock ?? inheritedBlock}><ButtonContext.Provider value={Button}><ManagementPanel {...props} /></ButtonContext.Provider></CodeBlockContext.Provider></TranslationContext.Provider>;
}
