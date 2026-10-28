import { useTranslation } from '../../../locale/locale.js';
import type { TreeProps } from '../tree_props.js';
import { EditableText } from '../editable_text/editable_text.js';
import { PinButton, RemoveButton, DisableButton } from '../tree_controls/tree_controls.js';
import { acceptTreeDrag, leaveTreeDrag } from '../native_drag.js';
import type { ReactNode } from 'react';
import type { NamespaceTreeNode } from '../../tree_node.js';
import { HintButton } from '../../../tooltip/action_hint.js';
import { NamespaceDetails, useTreeTooltip } from '../../../tooltip/tree_details.js';
import { TreeChildren } from '../tree_children/tree_children.js';

/** @brief Namespace row whose children toggle only through the leading disclosure button. */
export function NamespaceNode({ node, tree, children }: { node: NamespaceTreeNode; tree: TreeProps; children: ReactNode }) {
    const t = useTranslation();
    const { path, fixed, metadata: config, count } = node;
    const open = tree.expanded[path] ?? false;
    const tooltip = useTreeTooltip(<NamespaceDetails path={path} description={node.description} queries={tree.namespaceQueriesByPath[path] ?? 0} />);
    return <li data-tree-path={path} data-disabled={tree.disabled(path) || undefined}>
        <div {...tooltip} className={`ts-node-block${fixed ? ' ts-fixed-node' : ''}`} data-namespace-path={path} data-drop-disabled={!node.permissions.acceptsChildren || undefined} draggable={!tree.busy && node.permissions.movable} onDragStart={event => {
            if (!node.permissions.movable) { event.preventDefault(); return; }
            if ((event.target as HTMLElement).tagName === 'INPUT') { event.preventDefault(); return; }
            event.stopPropagation(); event.dataTransfer.setData('application/x-ts-namespace', path); event.dataTransfer.effectAllowed = 'move';
        }} onDragOver={event => acceptTreeDrag(event, tree.busy || !node.permissions.acceptsChildren)} onDragLeave={leaveTreeDrag} onDrop={event => tree.dropNode(event, path, true)}>
            <HintButton className="ts-disclosure" type="button" aria-label={t('toggle_namespace', { path })} aria-expanded={open} title={t('toggle_namespace', { path })} disabled={tree.busy}
                onClick={() => tree.toggle(path)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
            </HintButton>
            {!node.permissions.renamable ? <span className="ts-node-name">{path.split('.').at(-1)}</span> : <EditableText className="ts-node-name" value={path.split('.').at(-1)!} label={t('namespace_path_name', { path })} busy={tree.busy}
                commit={name => tree.renameNamespace(path, name)} />}
            <small className="ts-node-count" aria-label={t('command_count', { path })}>{count}</small>
            {fixed ? <span className="ts-node-preview">{node.description}</span> : <><EditableText className="ts-node-preview" value={config?.description ?? ''} label={t('namespace_comment', { path })} busy={tree.busy} empty
                commit={description => { tree.configure(path, { description }); return true; }} />
            <span className="ts-node-actions">
                <PinButton label={t('pin_namespace', { path })} active={config?.alwaysVisible ?? false} busy={tree.busy}
                    toggle={() => tree.configure(path, { alwaysVisible: !config?.alwaysVisible })} />
                {node.permissions.disableable && <DisableButton disabled={tree.disabled(path)} busy={tree.busy || tree.disabledByAncestor(path)} toggle={() => tree.toggleDisabled(path)} />}
                {node.permissions.removable && <RemoveButton label={t('delete_namespace', { path })} hint={t('delete_namespace_hint', { path })} busy={tree.busy} remove={() => tree.deleteNamespace(path)} />}
            </span></>}
            {node.pinMode === 'locked' && <span className="ts-node-actions">
                {node.permissions.disableable && <DisableButton disabled={tree.disabled(path)} busy={tree.busy || tree.disabledByAncestor(path)} toggle={() => tree.toggleDisabled(path)} />}
                <PinButton label={t('fixed_namespace')} tooltip={t('fixed_namespace')} active busy={tree.busy} locked toggle={() => {}} />
            </span>}
            {node.pinMode === 'provided' && <span className="ts-node-actions">
                {node.permissions.disableable && <DisableButton disabled={tree.disabled(path)} busy={tree.busy || tree.disabledByAncestor(path)} toggle={() => tree.toggleDisabled(path)} />}
                <PinButton label={t('pin_namespace', { path })} active={tree.namespaceVisible[path] ?? false} busy={tree.busy} toggle={() => tree.toggleProvidedNamespace(path)} />
            </span>}
        </div>
        <TreeChildren open={open}>{children}</TreeChildren>
    </li>;
}

