import { useContext, useMemo, useSyncExternalStore, type ComponentType } from 'react';
import type { CodeBlockProps } from '@deepseek-ai/dsh-client-ui-primitives';
import { CodeBlockContext } from '../code_block/code_block.js';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import { ManagementPanel, type ManagementPanelProps } from '../panel/management_panel.js';
import { TranslationContext, messageKey, type LocaleKey } from './locale.js';

/** @brief Bridge host locale revisions into the editor without remounting or losing drafts. */
export function NativePanel({ locale, CodeBlock, ...props }: ManagementPanelProps & { locale: Context['locale']; CodeBlock?: ComponentType<CodeBlockProps> }) {
    const inheritedBlock = useContext(CodeBlockContext);
    const snapshot = useSyncExternalStore(listener => locale.subscribe(listener), () => locale.getSnapshot());
    const t = useMemo(() => {
        const bound = locale.bind('ts_intellisense');
        return (key: string, values?: Record<string, string | number>) => {
            const known = messageKey(key);
            return known ? bound(known as LocaleKey, values) : key;
        };
    }, [locale, snapshot.revision]);
    return <TranslationContext.Provider value={t}><CodeBlockContext.Provider value={CodeBlock ?? inheritedBlock}><ManagementPanel {...props} /></CodeBlockContext.Provider></TranslationContext.Provider>;
}
