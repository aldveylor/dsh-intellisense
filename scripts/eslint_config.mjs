import js from '@eslint/js';
import ts from 'typescript-eslint';

export default ts.config({
    files: ['src/llm_text_exec/**/*.ts', 'tests/llm_text_exec/**/*.ts', 'src/runtime_host/**/*.ts', 'src/text_ptc/**/*.ts', 'tests/text_ptc/**/*.ts', 'src/index.ts', 'src/runtime/builtins.ts', 'src/web/tree_provider.ts', 'src/web/management_panel.tsx', 'src/web/tool_picker/**/*.tsx', 'src/web/routes.ts', 'src/web/locale/**/*.ts', 'src/web/locale/**/*.tsx', 'src/dsh/tool_commands.ts', 'src/registry/**/*.ts'],
    extends: [js.configs.recommended, ...ts.configs.recommended],
    languageOptions: {
        globals: { AbortController: 'readonly', AbortSignal: 'readonly', performance: 'readonly' },
    },
    rules: {
        'no-undef': 'off',
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        '@typescript-eslint/no-empty-object-type': ['error', { allowInterfaces: 'with-single-extends' }],
    },
});
