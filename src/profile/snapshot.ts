import type { ProfileData } from './catalog/profile_tree.js';
import { EditableNamespace } from './namespace.js';
import type { ProfileNamespace } from './namespace.js';
import type { ProfileNode } from './node.js';
import type { ProfileSnapshot } from './profile.js';

/** @brief Internal anonymous snapshot implementation with no persistence or catalog identity. */
export class EditableSnapshot extends EditableNamespace implements ProfileSnapshot {
    brief: string | undefined;

    constructor(data?: Pick<ProfileData, 'root' | 'brief'>) { super('', data?.root); this.brief = data?.brief; }

    /** @brief Resolve nodes by identity, respecting disabled ancestors and the optional global prefix. */
    resolve(path: string): ProfileNode | undefined {
        if (this.disabled) return undefined;
        path = path.replace(/^global\./, '');
        if (!path) return this;
        const [first, ...parts] = path.split('.');
        let node: ProfileNode | undefined = this.children.get(first!);
        for (const name of parts) {
            if (!node || node.disabled || node.type !== 'namespace') return undefined;
            node = (node as ProfileNamespace).children.get(name);
        }
        return node && !node.disabled ? node : undefined;
    }

    /** @brief Clone stored data using this concrete root implementation. */
    clone(value: Pick<ProfileData, 'root' | 'brief'> = { root: this.serialize(), brief: this.brief }): ProfileSnapshot {
        const node = this.copyNode(value.root);
        node.brief = value.brief;
        return node;
    }

    setBrief(value: string | undefined): this { this.brief = value; return this; }
}
