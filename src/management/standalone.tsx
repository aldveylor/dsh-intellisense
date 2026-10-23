import { createRoot } from 'react-dom/client';
import { browserLanguage, translate, TranslationContext } from './locale/locale.js';
import { ManagementPanel } from './panel/management_panel.js';

const container = document.getElementById('root');
if (!container) throw new Error('Management root is missing');
const language = browserLanguage(navigator.languages);
const t = translate(language);
document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en-US';
document.title = t('page_title');
createRoot(container).render(<TranslationContext.Provider value={t}><ManagementPanel api={new URL('./ts-intellisense-state', location.href).href} /></TranslationContext.Provider>);
