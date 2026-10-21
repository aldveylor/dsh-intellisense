import { useState } from 'react';
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { NativeConfigurationSelect } from '../configuration_select/native_select.js';
import { ManagementPanel, type ManagementPanelProps } from '../management_panel.js';

/** @brief Open the namespace editor from a General settings row using the host modal. */
export function NamespaceSettings(props: ManagementPanelProps) {
    const [open, setOpen] = useState(false);

    return <>
        <style>{`
            .ts-namespace-setting { display:flex; align-items:center; justify-content:space-between; gap:24px;
                padding:16px 0; border-bottom:.5px solid var(--dsw-alias-border-l2); font-size:14px; line-height:20px; }
            .ts-namespace-setting-label { display:flex; align-items:center; gap:8px; }
            .ts-namespace-dialog { width:min(1100px, calc(100vw - 64px)); max-width:calc(100vw - 64px); }
        `}</style>
        <div className="ts-namespace-setting">
            <span className="ts-namespace-setting-label">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M14.7 6.3a5.5 5.5 0 0 0-7 7L2.5 18.5a2.12 2.12 0 0 0 3 3l5.2-5.2a5.5 5.5 0 0 0 7-7l-3.2 3.2-3-3z" />
                </svg>
                工具命名空间
            </span>
            <Button variant="outline" size="sm" aria-label="打开工具命名空间" aria-haspopup="dialog" onClick={() => setOpen(true)}>管理</Button>
        </div>
        <Modal open={open} onClose={() => setOpen(false)} title="工具命名空间" closeLabel="关闭工具命名空间"
            className="ts-namespace-dialog">
            {open && <ManagementPanel {...props} ConfigurationSelect={NativeConfigurationSelect} />}
        </Modal>
    </>;
}
