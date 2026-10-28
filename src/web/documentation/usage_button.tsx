import { HelpIcon } from '../ui/icons/icons.js';
import { useState } from 'react';
import { HintButton } from '../ui/tooltip/action_hint.js';
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
        <HelpIcon valid={true} />
        {!viewed && <span className="ts-usage-unread" aria-hidden="true" />}
    </HintButton>;
}
