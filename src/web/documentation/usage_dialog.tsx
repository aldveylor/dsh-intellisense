import { useEffect, useId, useRef, type ReactNode } from 'react';
import english from '../../../docs/en/usage.md';
import chinese from '../../../docs/zh-cn/usage.md';
import { CloseButton } from '../ui/controls/close_button.js';
import { useTranslation } from '../locale/locale.js';

/** @brief Render inline code in the bundled usage documents without interpreting HTML. */
function inline(text: string): ReactNode[] {
    return text.split(/(`[^`]+`)/).map((part, index) => part.startsWith('`') ? <code key={index}>{part.slice(1, -1)}</code> : part);
}

/** @brief Display the bundled localized guide, sharing the README's light-mode screenshots. */
export function UsageDialog({ api, close }: { api: string; close: () => void }) {
    const t = useTranslation();
    const dialog = useRef<HTMLDialogElement>(null);
    const title = useId();
    const language = t('documentation_language') === 'zh' ? 'zh' : 'en';
    const source = language === 'zh' ? chinese : english;
    useEffect(() => { dialog.current?.showModal(); }, []);

    return <dialog ref={dialog} className="ts-management-dialog ts-usage-dialog" aria-labelledby={title} onClose={close}>
        <header><h2 id={title}>{t('usage_guide')}</h2><CloseButton close={close} /></header>
        <article>{source.trim().split(/\n\s*\n/).map((block, index) => {
            if (block.startsWith('# ')) return null;
            if (block.startsWith('## ')) return <h3 key={index}>{block.slice(3)}</h3>;
            const image = /^!\[([^\]]*)\]\([^)]*\/(namespace_table|profile_editor|namespace_tree|tools|tooltip|new_conversation)\.png\)$/.exec(block);
            if (image) {
                const url = new URL('./ts-intellisense-docs-image', api);
                url.searchParams.set('language', language);
                url.searchParams.set('name', image[2]!);
                return <img key={index} src={url.href} alt={image[1]} loading="lazy" />;
            }
            return <p key={index}>{inline(block)}</p>;
        })}</article>
    </dialog>;
}
