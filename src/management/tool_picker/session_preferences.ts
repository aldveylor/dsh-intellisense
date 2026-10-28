import { useEffect, useState } from 'react';
import { toolCategories, type ToolCategory } from './tool_filter/tool_filter.js';

/** @brief Tool picker choices retained for the current browser session. */
interface PickerPreferences {
    view: string;
    grouping: string;
    categories: ToolCategory[];
}

const storageKey = 'ts-intellisense-tool-picker';

/** @brief Restore session choices, falling back to the entry point's initial filter. */
function readPreferences(unmountedOnly: boolean): PickerPreferences {
    const defaults = { view: 'cards', grouping: 'none', categories: unmountedOnly ? ['unmounted' as const] : toolCategories };
    try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as Partial<PickerPreferences> | null;
        if (!saved) return defaults;
        return {
            view: ['cards', 'list'].includes(saved.view!) ? saved.view! : defaults.view,
            grouping: ['none', 'type', 'source'].includes(saved.grouping!) ? saved.grouping! : defaults.grouping,
            categories: Array.isArray(saved.categories) ? saved.categories.filter(category => toolCategories.includes(category)) : defaults.categories,
        };
    } catch { return defaults; }
}

/** @brief Keep layout and category preferences across picker mounts without changing Profiles. */
export function usePickerPreferences(unmountedOnly: boolean) {
    const [preferences, setPreferences] = useState(() => readPreferences(unmountedOnly));
    useEffect(() => {
        try { sessionStorage.setItem(storageKey, JSON.stringify(preferences)); }
        catch { /* Session storage can be unavailable in embedded browsers. */ }
    }, [preferences]);
    return [preferences, setPreferences] as const;
}
