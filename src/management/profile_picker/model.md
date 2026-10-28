# Profile picker

`profile_picker.tsx` renders an editor-only configuration selector without the visible Profile label, followed by borderless SVG Refresh / Save / Save as actions. `action_button.tsx` gives all five action buttons shared themed function tooltips on hover and keyboard focus, with no duplicate native title tooltip. Clicking hides the tooltip. Progress messages remain hidden; accessible names and error reporting are retained. `save_as_dialog.tsx` provides modal name entry for Save as, with input focus, Escape dismissal and Cancel / Confirm actions. Entering a new name in the editor dropdown creates only a local empty draft; Save persists it as a non-default profile. Save as stores a named copy without changing the default profile. Empty or existing names cannot be confirmed.

`ProfileSelect` delegates to `NativeProfileSelect`, giving standalone views and the embedded tree editor the same animated dropdown. The embedded default selector uses HostProfileSelect and the native Menu component. Both accept readOnly to suppress creation, renaming and deletion for the default selector, and allowCreate=false to hide creation independently. protectedProfile prevents deleting the last persisted profile even when an unsaved draft is also listed.

`native_profile_select.tsx` implements an independent anchored dropdown styled with host menu theme variables, without the host Menu dependency. `NativeProfileSelect.Item` renders a selection button and a borderless delete button with a 20px icon inside the shared item border; double-clicking the name opens inline renaming (Enter or blur commits, Escape cancels). Selection leaves the dropdown open. The bottom input in the editor selector creates a local empty profile draft on Enter; the default selector hides it. The panel animates opacity and vertical movement/scale on both opening and closing; closing retains the panel until its own animation ends and blocks pointer interaction. The trigger keeps its chevron aligned to the right and rotates it with a transform transition when expanded. The panel supports arrow navigation, outside dismissal and Escape; composition does not submit names. Persistence remains in the registry and management API.

Select props also accept an optional accessible label; management callbacks are optional for read-only reuse. NativeProfileSelect supports closeOnSelect (default false), used by the tool sort selector to close after selection and restore trigger focus.

`profile_json.ts` shares the complete JSON configuration schema with the management API. Download and Upload icon buttons follow Save as. Download exports the selected editor draft (including unsaved changes) as a formatted `<Profile>.json` configuration without catalog or revision metadata. Upload validates the entire JSON before replacing the selected editor draft; it preserves the selected name and default Profile and requires Save to persist. Invalid files leave the draft intact and use the existing error dialog. File selection resets after each attempt so the same file can be uploaded again.

Refresh, Save, Save as, Download and Upload return promises to the shared action animation hook. SVG master cycles repeat during the operation and finish at the next complete cycle boundary after success or failure; child animation events do not stop the master cycle. Save as begins on name confirmation, Upload begins after file selection, and cancelling either picker starts no operation animation. Profile deletion shifts surviving dropdown items with transform animations. Reduced-motion preferences shorten cycles and suppress movement while retaining completion events.

Profile 下拉选项支持可选 brief，存在时在名称下显示灰色简介，无简介时省略该行。命名空间树保留 NativeProfileSelect 自定义可编辑菜单，默认配置在宿主中使用 HostProfileSelect 对接原生 Menu。ProfileLabel 共享名称与简介布局。JSON 导入导出保留可选 brief。

配置操作按钮通过独立 hint 显示中英文功能说明，保留简短可访问名称；说明刷新覆盖草稿、保存的会话范围、另存为及导入导出的实际效果。选择器支持独立 hint，区分默认配置、编辑配置与工具排序用途。

按钮提示统一使用第一行动作、第二行浅色说明的 ActionHint；菜单按钮由 HintButton 提供相同的鼠标和键盘提示，不再生成浏览器 title 浮层。

Profile 菜单行通过 controls/editable_text 的 EditableText 共用草稿、提交、取消及输入法保护，renderDisplay 保留 HintButton 选择与简介布局，输入限制 80 字符并聚焦全选。

配置校验按需导入 Zod API，浏览器与管理服务继续共用 profileConfiguration；DSH 客户端复用宿主 Zod，独立页面构建仅保留所需校验实现。
