import { createContext, useContext, type ComponentType } from 'react';
import type { CodeBlockProps } from '@deepseek-ai/dsh-client-ui-primitives';
import { useTranslation } from '../locale/locale.js';

/** @brief Portable code display when the native DSH renderer is unavailable. */
function PortableCodeBlock({ code, lang }: CodeBlockProps) {
    return <pre><code className={`language-${lang ?? 'text'}`}>{code}</code></pre>;
}

/** @brief Host code renderer shared with tooltip content without adding native dependencies to standalone. */
export const CodeBlockContext = createContext<ComponentType<CodeBlockProps>>(PortableCodeBlock);

/** @brief Render TypeScript with the host's syntax highlighting and localized copy actions. */
export function TypeScriptBlock({ code }: { code: string }) {
    const Block = useContext(CodeBlockContext);
    const t = useTranslation();
    return <Block code={code} lang="typescript" copyLabel={t('copy_code')} copiedLabel={t('copied_code')} />;
}
