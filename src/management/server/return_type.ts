import ts from 'typescript';
import { jsonSchemaToTs } from '@deepseek-ai/dsh-tools';
import { decodeHTML } from 'entities';

/** @brief Render named object results as interfaces and anonymous or union results as aliases. */
export function returnTypeDeclaration(schema: unknown): string {
    const type = decodeHTML(jsonSchemaToTs(schema));
    const title = schema && typeof schema === 'object' && 'title' in schema ? schema.title : undefined;
    const named = typeof title === 'string' && /^[A-Za-z_$][\w$]*$/.test(title)
        && ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, title).scan() === ts.SyntaxKind.Identifier;
    const name = named ? title : 'Result';
    const source = ts.createSourceFile('result.ts', `type ${name} = ${type};`, ts.ScriptTarget.Latest, true);
    const alias = source.statements[0];
    if (named && alias && ts.isTypeAliasDeclaration(alias) && alias.name.text === name && ts.isTypeLiteralNode(alias.type)) {
        const declaration = ts.factory.createInterfaceDeclaration(undefined, name, undefined, undefined, alias.type.members);
        return ts.createPrinter().printNode(ts.EmitHint.Unspecified, declaration, source);
    }
    return `type ${name} = ${type};`;
}
