import { profileWrite, ProfileWriteSchema, validateProfilePatch, type ProfilePatch, type ProfileWrite } from '../profile_write.js';
import { mergeProfilePatch } from '../../tools/profile_save.js';
import { compareProfile } from './compare.js';
import type { ProfileData } from '../profile_tree.js';
import { EditableNamespace } from './namespace.js';
import type { ProfileSnapshot } from './profile.js';

/** @brief Internal anonymous snapshot implementation with no persistence or catalog identity. */
export class EditableSnapshot extends EditableNamespace implements ProfileSnapshot {
    brief: string | undefined;

    constructor(data?: Pick<ProfileData, 'root' | 'brief'>) { super('', data?.root); this.brief = data?.brief; }

    /** @brief Clone stored data using this concrete root implementation. */
    clone(value: Pick<ProfileData, 'root' | 'brief'> = { root: this.serialize(), brief: this.brief }): ProfileSnapshot {
        const Constructor = this.constructor as new (value?: Pick<ProfileData, 'root' | 'brief'>) => EditableSnapshot;
        return new Constructor(value);
    }

    /** @brief Base patch operation dispatches the root object to namespace-level validation. */
    override apply(patch: ProfilePatch): this {
        validateProfilePatch(patch as Record<string, unknown>);
        const draft = this.clone() as EditableSnapshot;
        draft.applyPatch(patch);
        this.members.clear();
        for (const [name, child] of draft.children) this.members.set(name, child);
        this.brief = draft.brief;
        return this;
    }

    /** @brief Mutate only the detached draft; concrete child methods perform all policy checks. */
    protected applyPatch(patch: ProfilePatch): void {
        ProfileWriteSchema.parse(mergeProfilePatch(profileWrite({ name: '', root: this.serialize(), brief: this.brief }), patch as Record<string, unknown>));
        if (Object.hasOwn(patch, 'brief')) this.brief = patch.brief ?? undefined;
        if (patch.root) super.apply(patch.root as Record<string, unknown>);
        ProfileWriteSchema.parse(profileWrite({ root: this.serialize(), brief: this.brief, name: '' }));
    }

    /** @brief Save is a differential application, including deletion of omitted ordinary members. */
    save(value: ProfileWrite): this {
        const target = ProfileWriteSchema.parse(value);
        const normalized = profileWrite({ name: '', brief: target.brief, root: this.normalize(target.root) as ProfileData['root'] });
        const before = profileWrite({ root: this.serialize(), brief: this.brief, name: '' });
        return this.apply(compareProfile(before, normalized) as ProfilePatch);
    }

    setBrief(value: string): this { this.brief = value; return this; }
}
