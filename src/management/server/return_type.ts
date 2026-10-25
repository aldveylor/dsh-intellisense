import { jsonSchemaToTs } from '@deepseek-ai/dsh-tools';
import { decodeHTML } from 'entities';

/** @brief Render the result type directly, without an alias or interface wrapper. */
export function returnTypeDeclaration(schema: unknown): string {
    return decodeHTML(jsonSchemaToTs(schema));
}
