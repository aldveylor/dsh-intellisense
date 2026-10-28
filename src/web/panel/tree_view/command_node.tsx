import { useTranslation } from '../../locale/locale.js';
import type { TreeProps } from './tree_props.js';
import { EditableText } from '../../controls/editable_text.js';
import { PinButton, RemoveButton, DisableButton } from './tree_controls.js';
import { acceptTreeDrag, leaveTreeDrag } from './native_drag.js';
import { nameWidth } from './name_width.js';
import type { CommandTreeNode } from '../tree_node.js';
import { CommandDetails, useTreeTooltip } from '../../tooltip/tree_details.js';

/** @brief Render commands with shared fixed, read-only and movement policies supplied by their data source. */
export function CommandNode({ node, tree }: { node: CommandTreeNode; tree: TreeProps }) {
    const t = useTranslation();
    const { path, mapping, command, fixed, description } = node;
    const id = mapping?.id ?? command?.id;
    const contract = node.serialize().command;
    const tool = (id ? tree.toolsById.get(id) : undefined) ?? {
        id: id ?? contract?.tool ?? path, description: description ?? '', parameters: contract?.schema ?? {}, output: contract?.output,
    };
    const summary = mapping?.description ?? (id && Object.hasOwn(tree.toolComments, id) ? tree.toolComments[id] : undefined) ?? '';
    const tooltip = useTreeTooltip(<CommandDetails path={path} tool={tool} summary={summary} calls={tree.callsByTool[tool.id] ?? 0} queries={tree.queriesByTool[tool.id] ?? 0} />);
    const readOnly = !node.permissions.renamable;
    const invalid = !!mapping && !(id && tree.toolsById.has(id));
    const draggable = !tree.busy && node.draggable;
    const disableButton = node.permissions.disableable ? <DisableButton disabled={tree.disabled(path)} busy={tree.busy || tree.disabledByAncestor(path)} toggle={() => tree.toggleDisabled(path)} /> : null;
    const pinButton = <PinButton label={t('pin_command', { path })} active={!!node.level} level={node.level} busy={tree.busy || !!command?.disabled}
        locked={node.permissions.availableFixLevels.length <= 1}
        toggle={() => { if (command) tree.pinBuiltin(path); else if (mapping) tree.pinTool(mapping); else if (id) tree.pinUnmounted(id); }} />;
    return <li className={`ts-tree-tool${fixed ? ' ts-fixed-node' : ''}${invalid ? ' ts-tool-invalid' : ''}`}
        aria-disabled={tree.disabled(path) || undefined} data-tool-status={tree.disabled(path) ? 'disabled' : invalid ? 'invalid' : 'available'} data-tree-path={path} data-tool-id={id} data-drop-disabled={readOnly || undefined}
        {...tooltip} draggable={draggable}
        onDragStart={event => {
            if (!draggable || (event.target as HTMLElement).tagName === 'INPUT') { event.preventDefault(); return; }
            event.stopPropagation(); event.dataTransfer.setData('application/x-ts-tool', id!);
            event.dataTransfer.setData('application/x-ts-mapping', path); event.dataTransfer.effectAllowed = 'move';
        }} onDragOver={event => acceptTreeDrag(event, tree.busy || readOnly)}
        onDragLeave={leaveTreeDrag}
        onDrop={event => { if (readOnly) { event.preventDefault(); event.stopPropagation(); } else tree.dropNode(event, path, false); }}>
        {readOnly ? <code>{path.split('.').at(-1)}</code> :
            <EditableText className="ts-node-name" value={path.split('.').at(-1)!} label={t('mapping_name', { path })} busy={tree.busy || !!mapping?.pinned}
                calculateWidth={nameWidth} commit={name => tree.rename(path, name)} />}
        {id && <span className="ts-mapping-source"><span aria-hidden="true">→ </span>{id}{invalid && <span role="status"> · {t('unavailable')}</span>}</span>}
        <span className="ts-tool-preview" role={fixed ? undefined : 'button'} tabIndex={fixed ? undefined : tree.busy ? -1 : 0}
            onDoubleClick={() => { if (!fixed && id) tree.editDescription(path); }} onKeyDown={event => {
                if (!fixed && id && event.key === 'Enter') { event.preventDefault(); tree.editDescription(path); }
            }}>{mapping?.description ?? (id && Object.hasOwn(tree.toolComments, id) ? tree.toolComments[id] : undefined) ?? description ?? t('edit_comment')}</span>
        <span className="ts-node-actions">
            {command && disableButton}
            {pinButton}
            {!command && disableButton}
            {node.permissions.removable && <RemoveButton label={t('remove_mapping', { path })} hint={t('remove_mapping_hint', { path })} busy={tree.busy || !!mapping?.pinned} remove={() => tree.remove(path)} />}
        </span>
    </li>;
}

