import { EditableSnapshot } from '../../registry/profile/snapshot.js';
import type { ProfileNode } from '../../registry/profile/node.js';
import type { ProfileData } from '../../registry/profile_tree.js';
import type { NamespaceTreeNode, ProfileTreeNode } from '../../registry/profile_node.js';
import { ImplToolsNamespace } from './impl_tools_namespace.js';
import { nodePermissions, type Permission } from '../../namespace/node.js';
import { ProfilePermissionError } from '../../error.js';

/** @brief Anonymous Profile root owns and protects the tools subtree while ordinary members remain editable. */
export class RootNamespace extends EditableSnapshot {
    constructor(data?: Pick<ProfileData, 'root' | 'brief'>) {
        super({ ...data, root: { type: 'namespace', children: { tools: new ImplToolsNamespace().serialize(), ...data?.root.children } } });
    }

    override get permissions(): Permission { return nodePermissions('tree', { renamable: false, movable: false, removable: false, commentable: false, disableable: false, availableFixLevels: [] }); }

    /** @brief Root hydration always reconstructs tools as its actual implementation class. */
    protected override makeChild(name: string, data: ProfileTreeNode): ProfileNode {
        if (name === 'tools') {
            if (data.type !== 'namespace') throw new ProfilePermissionError('Protected node cannot be replaced: tools');
            return new ImplToolsNamespace(data);
        }
        return super.makeChild(name, data);
    }

    /** @brief Root insertion and replacement explicitly protect the owned tools instance. */
    override set(name: string, node: ProfileNode): this {
        if (name === 'tools') throw new ProfilePermissionError('Protected node cannot be replaced: tools');
        return super.set(name, node);
    }

    /** @brief The root protects tools even if a caller changes the displayed permission declaration. */
    override remove(name: string): boolean {
        if (name === 'tools') throw new ProfilePermissionError('Node cannot be removed: tools');
        return super.remove(name);
    }

    /** @brief Differential save retains the required tools subtree and delegates its corrections to that node. */
    override normalize(value: ProfileTreeNode): ProfileTreeNode {
        if (value.type !== 'namespace') throw new ProfilePermissionError('Expected an anonymous namespace root');
        const target: NamespaceTreeNode = { ...value, children: { ...value.children } };
        const tools = this.get('tools')!;
        target.children!.tools = tools.normalize(target.children!.tools ?? tools.serialize());
        return super.normalize(target);
    }
}
