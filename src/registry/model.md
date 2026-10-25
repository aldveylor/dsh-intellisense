# 工具目录与 Profile

`registry.ts` 保存物理工具、语义映射、命名空间元数据、固定提示偏好和具名 Profile，配置写入按 revision 串行提交。未挂载工具默认使用 tools 下的编码路径，unmountedVisible 保存其固定提示偏好。`profiles.ts` 以独立工作快照隔离会话配置，每会话仅覆盖保存一份草稿，释放时删除，`path.ts` 统一校验路径及编码物理名称。工具权限由原生工具执行策略决定。整理对话通过 tools.profile.save 保存完整配置。

命令固定等级统一为 0（不固定）、1（固定但简略）、2（固定且详细）。Mapping.alwaysVisible 保存等级；builtinVisible、unmountedVisible 为路径或物理 ID 到等级的映射，随 Profile 保存，挂载和移除映射时保留等级。命名空间 alwaysVisible 仍为布尔值。

`profile_tree.ts` 定义对外 Profile 树、递归校验与配置转换，以及英文 TypeScript 声明文本。CommandBrief 使用物理命令 ID 与原始描述；CommandNode 以 type: 'command' 标识命令，可提供 simplifiedBrief，保存为工具描述偏好。NamespaceNode（含 Profile.root）以 type: 'namespace' 标识命名空间，children 按本地名称保存命令或子命名空间。CommandNode.fixedLevel 显式选择 none / fixed-brief / fixed-detail，NamespaceNode.fixed 控制命名空间固定提示；树导入导出保留这些属性，按路径聚合别名；可选名称由会话当前 Profile 决定。

consolePinned 为随 Profile 保存的命名空间固定提示开关，默认 false。管理面板始终展示 console 及其命令，console 命名空间图钉可切换是否固定提示；命令各自保留独立的提示等级。IntelliSense 与原生 console 的可用性不受固定状态影响。PTC 初始 prompt 提示可使用运行时提供的原生 Node.js 变量。

注册表负责配置与工具目录；声明由 integration/namespace.ts 投影实际 manifest 的命令契约，integration/namespace_declaration.ts 统一渲染命名空间树，供单项声明、IntelliSense 与提示词共用，执行由原生工具流水线负责。

`path.ts` 的 reserved 集合禁止用户配置覆盖内置 tools、console、运行时全局及 TypeScript 标准库名称（如 Map、Set、Date、Number、Intl）。该限制作用于路径根节点；即使当前 guest 没有使用对应全局，也统一保留这些名称，避免生成的命名空间声明与全局值/类型合并冲突，或遮蔽运行时标准接口。所有层级还禁止原型相关名称、then 和 __dsh 前缀；语言关键字不能作为根名称。

管理编辑可显式指定 editingProfile，在同一 revision 事务中校验和保存该配置，另存为创建非默认配置，不切换默认 Profile。创建配置支持 activate=false，仅加入目录。未指定编辑目标的旧配置操作保留原行为。

configure 支持 activate=false，将指定的新副本写入非默认目录；未指定编辑来源时从空配置校验新建草稿，不继承默认配置的锁定映射。

Mapping.disabled 与 Namespace.disabled 分别控制命令及子树的可用性；builtinDisabled 保存内置树的禁用路径。三者随 Profile、会话快照和编辑保存持久化。Profile 树的命令及命名空间节点允许 disabled 字段，导入导出保留该字段。SemanticRegistry.disabled 统一判断路径与祖先禁用状态。

`tools` 根命名空间与 `tools.intellisense` 不可禁用，disabled 查询始终返回 false，builtinDisabled 校验拒绝这两个路径；tools 下其它节点按各自路径及可禁用父命名空间继承禁用。
