# Tool management guide

Open the plugin's configuration page to manage reusable tool Profiles. The page's Usage guide button opens this document inside DSH. Screenshots use light mode; the interface follows your DSH theme.

## Choose and save a Profile

The default Profile is used by new conversations. The Profile beside the namespace tree selects the configuration you are editing. Save commits that draft to the catalog; Save as creates a named copy. A star marks unsaved edits. Existing conversations keep their working configurations until you select another Profile for that conversation.

![Namespace tree and Profile controls](../../assets/en/namespace_table.png)

## Add tools

Click the tool icon next to Namespace tree to add tools at the root, or the tool icon within a namespace to add them there. The unmounted count opens a filtered picker. Search names, paths or descriptions, choose a sort order, then click an available card. Built-in cards remain disabled. Adding a second mount of the same physical tool creates another independent path.

![Tool picker in light mode](../../assets/en/tools.png)

## Edit and discover

Expand groups, double-click ordinary names and descriptions to edit, and drag entries to organize the tree. Pin levels cycle through 0 (on demand), 1 (brief) and 2 (full definition). Disable retains configuration while removing a node and its descendants from discovery and execution. Protected members retain their server-owned names, locations and permissions.

Hover a tool for its parameters, return type and call totals. Hold Alt to keep the tooltip in place, then hover a parameter type for its structure. The original command in a tree tooltip opens the physical tool's details.

![Tool details](../../assets/en/tooltip.png)

## Save and apply through tools

Read `tools.profile.annotation` for the current write model. `save` accepts ProfileWrite: omit name and recursively omit permissions from loaded data. Pass the destination name as a separate argument. `apply` accepts a recursive partial write tree; null removes optional fields or named children. Rename or move a mount by deleting its old child key and adding the new one.

Both operations save the catalog and preserve the conversation draft. Verify saved mounts with `load(name)`. `commands.paths` reports the current conversation's paths; explicitly `switch(name)` to update them. Calling apply without a name starts from the current conversation draft, so use a name for successive edits to a saved catalog tree.

A full save defaults the tools namespace to disabled unless its disabled field is explicitly false. Apply preserves its existing state when omitted. Inspect may be disabled; if it is unavailable, every other enabled command should be pinned at level 2. A warning advises about incomplete pins without blocking persistence. Success returns null or a warning, with no change summary. Invalid or forbidden writes throw.
