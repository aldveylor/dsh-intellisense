import { zh } from './zh.js';

/** @brief Publish both languages without imposing a response language on the model. */
export function bilingualDescription(english: string): string {
    return zh[english] ? `${english} / ${zh[english]}` : english;
}
