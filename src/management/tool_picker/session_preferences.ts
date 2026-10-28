import { useEffect, useState } from 'react';
import { toolCategories, type ToolCategory } from './tool_filter/tool_filter.js';

/** @brief Tool picker choices retained for the current page lifetime. */
interface PickerPreferences {
    view: string;
    grouping: string;
    categories: ToolCategory[];
}

let savedPreferences: PickerPreferences | undefined;

/** @brief Keep layout and category choices in memory across picker mounts. */
export function usePickerPreferences(unmountedOnly: boolean) {
    const [preferences, setPreferences] = useState<PickerPreferences>(() => savedPreferences ?? {
        view: 'cards', grouping: 'none', categories: unmountedOnly ? ['unmounted'] : toolCategories,
    });
    useEffect(() => { savedPreferences = preferences; }, [preferences]);
    return [preferences, setPreferences] as const;
}
