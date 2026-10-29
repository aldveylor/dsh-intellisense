import type { ProfileData } from '../profile_tree.js';
import { EditableNamespace } from './namespace.js';
import type { ProfileSnapshot } from './profile.js';

/** @brief Internal anonymous snapshot implementation with no persistence or catalog identity. */
export class EditableSnapshot extends EditableNamespace implements ProfileSnapshot {
    brief: string | undefined;

    constructor(data?: Pick<ProfileData, 'root' | 'brief'>) { super('', data?.root); this.brief = data?.brief; }

    setBrief(value: string): this { this.brief = value; return this; }
}
