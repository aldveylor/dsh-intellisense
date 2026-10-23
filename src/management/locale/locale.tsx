import { createContext, useContext } from 'react';
import { zh } from './zh.js';
import { enUs } from './en_us.js';

/** @brief Dictionary keys owned by this plugin. */
export type LocaleKey = keyof typeof zh;

/** @brief Translate UI keys with named interpolation, leaving external tool text intact. */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

/** @brief Match browser language tags to the two supported UI dictionaries. */
export function browserLanguage(languages: readonly string[]): 'zh' | 'en' {
    for (const language of languages) {
        const primary = language.toLowerCase().split('-')[0];
        if (primary === 'zh' || primary === 'en') return primary;
    }
    return 'en';
}

/** @brief Resolve UI state and tree errors to their shared dictionary key. */
export function messageKey(key: string): LocaleKey | undefined {
    return Object.hasOwn(zh, key) ? key as LocaleKey : (Object.keys(zh) as LocaleKey[]).find(entry => zh[entry] === key);
}

/** @brief Standalone translator also recognizes errors from namespace operations. */
export function translate(language: string): Translate {
    const dictionary = language.toLowerCase().split('-')[0] === 'zh' ? zh : enUs;
    return (key, values) => {
        const known = messageKey(key);
        const text = known ? dictionary[known] : key;
        return text.replace(/\{(\w+)\}/g, (token, name: string) => String(values?.[name] ?? token));
    };
}

/** @brief Translation context shared by native and standalone React trees. */
export const TranslationContext = createContext<Translate>(translate(typeof navigator === 'undefined' ? 'en' : browserLanguage(navigator.languages)));

/** @brief Read the current translator without storing translated UI state. */
export function useTranslation(): Translate { return useContext(TranslationContext); }
