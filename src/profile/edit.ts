import type { ProfileSnapshot } from './profile.js';
import type { ProfileNode } from './node.js';
import { EditableNamespace, type ProfileNamespace } from './namespace.js';
import { EditableFunction, type ProfileFunction } from './function.js';
import { profileWrite, ProfileWriteSchema, validateProfilePatch, type ProfilePatch } from './catalog/profile_write.js';
import { mergeProfilePatch } from './patch.js';
import { ProfilePermissionError } from '../error.js';

/** @brief Traverse a detached tree and execute explicit edits through member and field interfaces; failures leave the input untouched. */
export function applyProfile(profile: ProfileSnapshot, patch: ProfilePatch): ProfileSnapshot {
    validateProfilePatch(patch as Record<string, unknown>);
    ProfileWriteSchema.parse(mergeProfilePatch(profileWrite({ name: '', root: profile.serialize(), brief: profile.brief }), patch as Record<string, unknown>));
    const draft = profile.clone();
    const visit = (node: ProfileNode, change: Record<string, unknown>): void => {
        if (change.type !== undefined && change.type !== node.type) throw new ProfilePermissionError('Protected node cannot be replaced');
        if (Object.hasOwn(change, 'disabled')) node.setDisabled(!!change.disabled);
        if (node.type === 'function') {
            const command = node as ProfileFunction;
            const fields = change.function as { tool?: string; doc?: string | null } | undefined;
            if (fields?.tool !== undefined) command.setTool(fields.tool);
            if (fields && Object.hasOwn(fields, 'doc')) command.setDescription(fields.doc ?? undefined);
            if (Object.hasOwn(change, 'fixedLevel')) command.setFixedLevel((change.fixedLevel ?? 0) as 0 | 1 | 2);
            return;
        }
        const namespace = node as ProfileNamespace;
        if (Object.hasOwn(change, 'description')) namespace.setDescription((change.description ?? undefined) as string | undefined);
        if (Object.hasOwn(change, 'fixedLevel')) namespace.setFixedLevel((change.fixedLevel ?? 0) as 0 | 1);
        for (const [name, value] of Object.entries((change.children ?? {}) as Record<string, Record<string, unknown> | null>)) {
            if (value === null) { namespace.remove(name); continue; }
            let child = namespace.get(name);
            if (child && ((value.type !== undefined && value.type !== child.type)
                || (child.type === 'function' && (value.function as { tool?: string } | undefined)?.tool !== undefined
                    && (value.function as { tool: string }).tool !== (child as ProfileFunction).tool))) {
                namespace.remove(name);
                child = undefined;
            }
            if (!child) child = value.type === 'function'
                ? namespace.create(name, () => new EditableFunction()) : namespace.create(name, () => new EditableNamespace());
            visit(child, value);
        }
    };
    if (Object.hasOwn(patch, 'brief')) draft.setBrief(patch.brief ?? undefined);
    if (patch.root) visit(draft, patch.root as Record<string, unknown>);
    ProfileWriteSchema.parse(profileWrite({ name: '', root: draft.serialize(), brief: draft.brief }));
    return draft;
}
