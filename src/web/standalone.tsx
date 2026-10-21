import { createRoot } from 'react-dom/client';
import { ManagementPanel } from './management_panel.js';

const container = document.getElementById('root');
if (!container) throw new Error('Management root is missing');
createRoot(container).render(<ManagementPanel api={new URL('./ts-intellisense-state', location.href).href} />);
