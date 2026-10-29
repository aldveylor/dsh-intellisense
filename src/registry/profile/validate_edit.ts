import { ProfilePermissionError } from '../../error.js';
import { nodePermissions } from '../../namespace/node.js';
import type { NamespaceTreeNode, ProfileTreeNode } from '../profile_node.js';

/** @brief Check untrusted tree changes against the original server-owned recursive permissions. */
export function validateProfileEdit(before: NamespaceTreeNode, after: NamespaceTreeNode, rootPath = ''): void {
    const submitted: { path: string; node: ProfileTreeNode }[] = [];
    const collect = (node: ProfileTreeNode, path: string): void => {
        submitted.push({ path, node });
        for (const [name, child] of Object.entries(node.children ?? {})) collect(child, path ? `${path}.${name}` : name);
    };
    collect(after, rootPath);
    const sameIdentity = (a: ProfileTreeNode, b: ProfileTreeNode): boolean => a.type === b.type && (a.type === 'command'
        ? a.command.tool === b.command?.tool
        : Object.entries(a.children ?? {}).some(([name, child]) => b.children?.[name] && sameIdentity(child, b.children[name]!)));
    const visit = (old: ProfileTreeNode, value: ProfileTreeNode | undefined, path: string): void => {
        const permissions = nodePermissions(old.type === 'command' ? 'leaf' : 'tree', old.permissions);
        if (!value) {
            const moved = submitted.find(item => item.path && sameIdentity(old, item.node));
            if (moved && path.split('.').at(-1) !== moved.path.split('.').at(-1) && !permissions.renamable) throw new ProfilePermissionError(`Node cannot be renamed: ${path} -> ${moved.path} (permissions.renamable=false)`);
            if (moved && path.split('.').slice(0, -1).join('.') !== moved.path.split('.').slice(0, -1).join('.') && !permissions.movable) throw new ProfilePermissionError(`Node cannot be moved: ${path} -> ${moved.path} (permissions.movable=false)`);
            if (!permissions.removable) throw new ProfilePermissionError(`Node cannot be removed: ${path} (permissions.removable=false)`);
        } else if (old.type !== value.type || (old.type === 'command' && value.command?.tool !== old.command.tool)) {
            if (!permissions.removable) throw new ProfilePermissionError(`${old.type !== value.type ? 'Protected node' : 'Protected command'} cannot be replaced: ${path}`);
        } else {
            const level = value.fixedLevel ?? 0;
            if (permissions.availableFixLevels.length ? !permissions.availableFixLevels.includes(level) : level !== (old.fixedLevel ?? 0)) throw new ProfilePermissionError(`Node fixed level cannot be changed: ${path} (permissions.availableFixLevels)`);
            if (path && !permissions.commentable && (old.type === 'command' ? old.command.doc !== value.command?.doc : old.description !== value.description)) throw new ProfilePermissionError(`Node documentation cannot be changed: ${path} (permissions.commentable=false)`);
            if (value.disabled && !permissions.disableable) throw new ProfilePermissionError(`Node cannot be disabled: ${path}`);
        }
        for (const [name, child] of Object.entries(old.children ?? {})) visit(child, value?.children?.[name], path ? `${path}.${name}` : name);
        if (value && old.type === 'namespace' && !permissions.acceptsChildren && Object.keys(value.children ?? {}).some(name => !Object.hasOwn(old.children ?? {}, name))) throw new ProfilePermissionError(`Namespace does not accept children: ${path}`);
    };
    visit(before, after, rootPath);
}
