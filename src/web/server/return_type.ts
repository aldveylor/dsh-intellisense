import { outputSchema } from '../../output_schema.js';
import { jsonSchemaToTs } from '@deepseek-ai/dsh-tool-executor-ptc';
import { decodeHTML } from 'entities';

/** @brief Render the result type directly, without an alias or interface wrapper. */
export function returnTypeDeclaration(schema: unknown): string {
    return decodeHTML(jsonSchemaToTs(outputSchema(schema)));
}
