import { outputSchema } from '../../output_schema.js';
import { dshCompatibility } from '../../compatibility/compatibility.js';
import { decodeHTML } from 'entities';

/** @brief Render the result type directly, without an alias or interface wrapper. */
export function returnTypeDeclaration(schema: unknown): string {
    return decodeHTML(dshCompatibility.jsonSchemaToTs(outputSchema(schema)));
}
