import { en } from '../locale/en.js';

/** @brief Standalone shell for the shared React editor, served by the authenticated Connection carrier. */
export const managementHtml = `<!doctype html>
<html lang="en-US"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${en.page_title}</title></head>
<body class="ts-standalone"><div id="root">${en.page_loading}</div>
<script defer src="./ts-intellisense-client"></script></body></html>`;
