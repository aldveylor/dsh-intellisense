# Usage guide

Follow the example below to prepare a Coding Profile and start a conversation with it. Open the `@aldveylor/dsh-intellisense` plugin configuration page in DSH; the Usage guide button at the top right opens this guide. Screenshots use light mode; the interface follows your DSH theme.

## Namespaces and configuration Profiles

A namespace works like a folder for tools. For example, create `project`, add file-reading and content-search tools, and name them `read` and `search`. The agent can then look them up as `project.read` and `project.search`. These names are aliases you choose; select tools actually available in your DSH installation when adding them.

A configuration Profile saves your tool groups, aliases, comments, pin settings and enabled states. For example, Coding holds project tools, while Research holds web tools. One tool can appear in several Profiles or several places within a Profile, with independent settings for each placement.

## Example one: prepare a Coding Profile

Open the selector beside the namespace tree, enter Coding at the bottom and press Enter to create an empty Profile. If a similar arrangement already exists, select it and use Save as to create Coding while keeping the original for other tasks. The default selector at the top sets the choice for new conversations; the tree's selector chooses what you edit.

![Default Profile, editor selection and save controls](../../assets/en/profile_editor.png)

Click Edit Profile description, enter “Read project files, search code and assist with changes,” then click Apply. A star beside the name means unsaved edits; click Save after arranging the tools below. Double-click a Profile name in the menu to rename it, or use its delete button to remove it. The last saved Profile cannot be deleted.

## Add tools to the example Profile

Double-click the placeholder offering to create a namespace, enter `project` and press Enter; Escape cancels. Expand `project`, click its plus button, and find and add an installed file-reading tool. Add a content-search tool next. The tool icon beside the tree heading adds tools at the root instead.

![Search, sort and select tools](../../assets/en/tools.png)

For example, search for “read” or the tool's original name, hover its card to check its purpose and parameters, then add it. The unmounted-tools entry lists tools not yet added to this Profile. Card footers show existing placements; adding a tool again creates another placement. Gray built-in cards cannot be added again.

Sort by name, call count or query count, and use the direction button for ascending or descending order; direction is unavailable for the default order. Filters can combine unmounted, mounted and built-in fixed tools.

## Give the tools useful names

Double-click the added reading tool's name and rename it to `read`; rename the search tool to `search`. Double-click their comments and enter “Read text files in the project” and “Search project files by keyword.” Apply updates the draft comment, Reset restores the original tool description, and Cancel discards the current input.

![Names, comments and row controls in the namespace tree](../../assets/en/namespace_tree.png)

The tools now have the paths `project.read` and `project.search`. If you added them at the root, drag them into the middle of `project` to move them inside. Drop in a gap before or after an entry to reorder it. Groups can also be dragged. Built-in names and positions are protected.

## What the agent can see

For this example, keep the built-in `tools.inspect` discovery entry enabled, click the pin on `project.read` until it is solid yellow for detailed hints, leave `project.search` unpinned, then save. The agent starts with full calling information for reading and can discover the search tool when needed.

Ordinary tool pins cycle through unpinned (0), brief (1), detailed (2) and back to unpinned. Brief hints introduce a name and purpose; detailed hints provide full calling information. A group pin introduces the group without pinning every child in detail. Expanding and collapsing only changes your view. The discovery entry's pin level is locked.

In Intellisense mode, the agent calls tools individually, gaining additional calling entries after looking up specific tools. In Intellisense PTC, it can combine tool operations in code. Both share your Profiles, and calls depend on tools and permissions available in the conversation. A tool appearing in the management catalog still needs to be added to the current Profile before the agent can use it.

## Use a Profile in a conversation

Save Coding, open a blank conversation, select Intellisense or Intellisense PTC, and choose Coding from the Profile menu beside the mode. A grayed-out Profile button means the mode specifies a fixed configuration.

![Mode and Profile selection in a new conversation](../../assets/en/new_conversation.png)

Try sending: “Read the project overview, then search for the login entry point and tell me which files implement authentication. Leave the files unchanged for now.”

Example flow: the agent reads the overview with `project.read` → discovers parameters for `project.search` as needed → searches for the login entry point → summarizes relevant files and evidence. Replies and call order depend on the model and tool results. Describe your goal; you do not need to write tool-calling code yourself.

The home-screen Profile menu disappears after chatting begins. Existing conversations retain their own working configurations; saving a Profile with the same name or changing the default does not update them automatically. On the home screen, choose another Profile and switch back to reload it. Once chatting, try: “Switch to the saved Coding Profile, then continue investigating authentication.”

## Example two: switch to research

In management, create a Research Profile and a `research` namespace. Add available web-search and page-reading tools as `search` and `read`, keep discovery enabled, then save. If those tools are missing, install or enable them in DSH before adding them here.

Choose Research for a new conversation and try: “Compare how these two projects are installed and maintained. Check their official documentation first and include sources.” The agent can discover tools under `research` and gather information. For an existing conversation, try: “Switch to the Research Profile before starting the comparison.”

## Adjust the example: pause or remove tools

To pause search temporarily, click the circled plus beside `project.search` to disable it. The row turns gray and keeps its settings, while the tool is removed from discovery and execution. Click the circled slash to enable it again. Disabling `project` affects all tools beneath it; enable the parent before changing its children's enabled states.

Drag an entry to correct its location, or delete a placement you no longer need. Deleting a group also removes its contents, while the original tools stay installed. Save your edits. Refresh replaces unsaved changes with the saved configuration; save or download first to keep your work.

## Example three: check parameters and back up a Profile

To check what `project.search` can search, hover the tool for its description and parameters, then hover its original tool name for more details. Hover a parameter type to inspect its structure. Hold Ctrl to keep the tooltip open, then move inside to scroll. Picker cards also show details on hover; placements of the same tool share call and query statistics.

![Tool details and parameter hints](../../assets/en/tooltip.png)

Once satisfied, click Download to back up the current draft as JSON, including unsaved edits. To reuse it, select or create the destination Profile, click Upload, choose the file, review the result and Save. Upload keeps the current Profile name and default selection. Invalid files display an error and leave the draft intact.

## Example four: ask the agent to organize tools

Click Generate organization proposal to open a new conversation draft with suggested instructions. Edit them as needed and send manually. For example: “Organize tools for coding and research, saving separate Coding and Research Profiles. Use short names and one-sentence comments, and keep tool discovery enabled.”

When the agent finishes, return to management, refresh and review the groups, tools and comments. Then choose a default or select a Profile for a new conversation. This button is unavailable on standalone management pages that cannot open a DSH conversation.
