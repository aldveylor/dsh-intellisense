import { useState } from 'react';
import { HintButton } from '../tooltip/action_hint.js';
import { useTranslation } from '../locale/locale.js';

const viewedKey = 'ts-intellisense:usage-guide-viewed';

/** @brief Read the browser's guide acknowledgement, including restricted storage contexts. */
function hasViewedGuide(): boolean {
    try { return localStorage.getItem(viewedKey) === 'true'; }
    catch { return false; }
}

/** @brief Open the usage guide and retain its first-use indicator until it is viewed. */
export function UsageButton({ open }: { open: () => void }) {
    const t = useTranslation();
    const [viewed, setViewed] = useState(hasViewedGuide);

    /** @brief Acknowledge the guide locally even when persistent browser storage is unavailable. */
    function showGuide(): void {
        setViewed(true);
        try { localStorage.setItem(viewedKey, 'true'); }
        catch { /* The current panel still remembers that the guide was opened. */ }
        open();
    }

    return <HintButton className="ts-usage-button" type="button" aria-label={t('usage_guide')} title={t('usage_guide_hint')} onClick={showGuide}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.75-2.5 2-2.5 4" />
            <circle cx="12" cy="16.5" r=".75" fill="currentColor" stroke="none" />
        </svg>
        {!viewed && <span className="ts-usage-unread" aria-hidden="true" />}
    </HintButton>;
}
