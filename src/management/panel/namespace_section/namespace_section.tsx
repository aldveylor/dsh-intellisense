import type { ComponentProps } from 'react';
import { HintButton } from '../../tooltip/action_hint.js';
import { useTranslation } from '../../locale/locale.js';
import { ProfilePicker } from '../../profile_picker/profile_picker.js';
import { NamespaceTreeView } from '../tree_view/namespace_tree_view.js';
import { EditableText } from '../tree_view/editable_text/editable_text.js';
import type { TreeProps } from '../tree_view/tree_props.js';
import type { TreeNode } from '../tree_node.js';

/** @brief Controlled namespace editor container with Profile actions, tree and guidance. */
interface NamespaceSectionProps {
    loaded: boolean;
    busy: boolean;
    editorPending: boolean;
    profile: ComponentProps<typeof ProfilePicker>;
    roots: TreeNode[];
    tree: TreeProps;
    unmountedCount: number;
    brief?: string;
    inspectWarning: boolean;
    pickTools: (unmountedOnly: boolean) => void;
    editBrief: (value: string) => void;
}

/** @brief Compose the namespace region without owning drafts or issuing requests. */
export function NamespaceSection({ loaded, busy, editorPending, profile, roots, tree, unmountedCount, brief, inspectWarning, pickTools, editBrief }: NamespaceSectionProps) {
    const t = useTranslation();
    return <section className="ts-namespaces">
        <div className="ts-namespace-heading"><h2>{t('namespace_tree')}</h2>
            <HintButton className="ts-add-tool ts-open-tools" type="button" aria-label={t('add_tools')} title={t('add_tools_hint_button')} disabled={!loaded}
                onClick={() => pickTools(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <path d="M14 6a5 5 0 0 0-6-4l3 3-3 3-3-3a5 5 0 0 0 6 6l8 8a2 2 0 0 0 3-3z" />
                </svg>
            </HintButton>
            <div className="ts-namespace-profile" aria-busy={editorPending || undefined} ref={element => { if (element) element.inert = editorPending; }}>
                <ProfilePicker {...profile} />
            </div>
        </div>
        {loaded && <div className="ts-profile-summary"><EditableText key={profile.name} className="ts-profile-brief" label={t('profile_brief')}
            value={brief ?? ''} placeholder={t('add_profile_brief')} busy={busy} empty
            commit={value => { editBrief(value); return true; }} /></div>}
        <div aria-busy={editorPending || undefined} ref={element => { if (element) element.inert = editorPending; }}>
            <NamespaceTreeView roots={roots} tree={tree} />
        </div>
        <div className="ts-tree-guidance"><small>{t('tree_hint')}</small>
            {loaded && <HintButton className="ts-unmounted-count" type="button" data-unmounted-count={unmountedCount} aria-live="polite" title={t('unmounted_hint')} disabled={!unmountedCount}
                onClick={() => pickTools(true)}>{t('unmounted_count', { count: unmountedCount })}</HintButton>}
        </div>
        {inspectWarning && <p className="ts-inspect-warning" role="status" aria-live="polite">{t('inspect_disabled_warning')}</p>}
    </section>;
}
