# 工具目录与 Profile

`registry.ts` 保存物理工具、语义映射、命名空间元数据、固定提示偏好和具名 Profile，配置写入按 revision 串行提交。未挂载工具默认使用 tools 下的编码路径，unmountedVisible 保存其固定提示偏好。`profiles.ts` 以独立工作快照隔离会话配置，每会话仅覆盖保存一份草稿，释放时删除，`path.ts` 统一校验路径及编码物理名称。工具权限由原生工具执行策略决定。整理对话通过 tools.profile.save 保存完整配置。

命令固定等级统一为 0（不固定）、1（固定但简略）、2（固定且详细）。Mapping.alwaysVisible 保存等级；builtinVisible、unmountedVisible 为路径或物理 ID 到等级的映射，随 Profile 保存，挂载和移除映射时保留等级。命名空间 alwaysVisible 仍为布尔值。

`profile_node.ts` 定义 load/save/annotation 共用的 Profile 节点模型：ProfileNode 包含 type: string、name、permissions、fixedLevel?: number 与 disabled；CommandNode 和 NamespaceTreeNode 继承该接口，type 分别为 command/namespace。命令 fixedLevel 限制为 0/1/2，命名空间限制为 0/1，实际可用等级由服务端 permissions.availableFixLevels 决定。Profile.root 为 NamespaceTreeNode，children 为命令与命名空间的联合数组；command 只保存 tool、可选 doc，description 为命名空间描述。disabled 表示节点自身显式禁用。`profile_tree.ts` 在运行时节点与 Profile 数据之间投影。创建 Profile 时先构建带上下文的普通匿名 NamespaceNode 及 console/tools 受保护子树，再添加配置映射；没有专门的根节点类型。导入先递归补齐缺少的受保护子对象，再由父节点对应的服务端策略拒绝替换、改名、移动及向受限命名空间添加成员；客户端提交的 permissions 不作为权限依据。每个挂载路径保存一条 Mapping，同一物理 ID 可重复挂载，各路径独立保存 fixedLevel、disabled 与 command.doc 描述偏好；不存在主路径或别名之分。

namespaceVisible 为随 Profile 保存的命名空间路径 → 固定提示布尔值映射，默认空对象；不使用 console 专有存储字段。管理面板始终展示 console 及其命令，console 命名空间图钉可切换是否固定提示；命令各自保留独立的提示等级。IntelliSense 与原生 console 的可用性不受固定状态影响。PTC 初始 prompt 提示可使用运行时提供的原生 Node.js 变量。

注册表负责配置与工具目录；声明由 namespace/namespace.ts 投影实际 manifest 的命令契约，namespace/declaration.ts 统一渲染命名空间树，供单项声明、IntelliSense 与提示词共用，执行由原生工具流水线负责。

`path.ts` 的 reserved 集合禁止用户配置覆盖内置 tools、console、运行时全局及 TypeScript 标准库名称（如 Map、Set、Date、Number、Intl）。该限制作用于路径根节点；即使当前 guest 没有使用对应全局，也统一保留这些名称，避免生成的命名空间声明与全局值/类型合并冲突，或遮蔽运行时标准接口。所有层级还禁止原型相关名称、then 和 __dsh 前缀；语言关键字不能作为根名称。

管理编辑可显式指定 editingProfile，在同一 revision 事务中校验和保存该配置，另存为创建非默认配置，不切换默认 Profile。创建配置支持 activate=false，仅加入目录。未指定编辑目标的旧配置操作保留原行为。

configure 支持 activate=false，将指定的新副本写入非默认目录；未指定编辑来源时从空配置校验新建草稿，不继承默认配置的锁定映射。

Mapping.disabled 与 Namespace.disabled 分别控制命令及子树的可用性；builtinDisabled 保存内置树的禁用路径。三者随 Profile、会话快照和编辑保存持久化。Profile 树的命令及命名空间节点允许 disabled 字段，导入导出保留该字段。SemanticRegistry.disabled 统一判断路径与祖先禁用状态。

`tools` 根命名空间与 `tools.intellisense` 不可禁用，disabled 查询始终返回 false，builtinDisabled 校验拒绝这两个路径；tools 下其它节点按各自路径及可禁用父命名空间继承禁用。

CommandBrief 与 profileAnnotation 中共享同一数据定义：name 为原始物理命令名，brief 为描述，paths 为当前会话 Profile 的挂载路径（包含路径自身或祖先禁用的路径及已挂载工具的 YAML 配置路径；未挂载时为空数组，当前作用域不可用不移除已配置路径），不包含插件内置命令；totalCalls 为跨会话的累计派发次数，用于 AI 整理时参考调用频率。

`profile_tree.ts` 的 Profiles 定义可用配置名称 profiles 与当前会话选择 selected，并通过 Profile annotation 提供相同声明。

子 agent 首次创建 Profile 工作快照时，从运行时父 Agent 的当前工作配置复制名称、映射、命名空间、固定提示与禁用状态等配置，包括尚未发布到具名目录的修改。父子后续修改独立，已有工作快照优先恢复，不被父配置覆盖；普通根会话继续读取全局默认 Profile。父子关系由 AgentRegistry.isOwnedBy 确认，不仅凭持久化 parentSession 推断。


Profile 仅包含 name 与 root；permissions 是唯一节点编辑限制说明，由服务端节点权限生成，输入不能覆盖服务端权限。annotation 与 JSON Schema 按字段独立说明节点权限：removable 控制移除，disableable 控制禁用，availableFixLevels 控制固定等级；不额外引入 console/tools 特殊限制。

Profile 导入的重复成员错误包含完整 root 路径、同一父节点中双方 children 数组索引和物理工具来源。受保护节点按保留的相对子路径及物理命令身份识别改名和移动，分别报告 renamable/movable；省略受保护成员时递归恢复，恢复值取自保存目标原有目录配置；新名称取自当前会话配置，已提交成员的 fixedLevel/disabled 等设置优先。console.info 与根级 info/log 名称空间互不冲突，重复只针对同级同名成员。

Profile annotation 说明可使用 load 返回的树作为编辑起点，缺少的受保护节点会自动补齐；新增命令节点使用 commands 中的精确物理名称、普通命令权限和自定义 command.doc，无需从已挂载节点复制。详细调用声明由运行时原生契约生成。command.doc 用一句话描述命令功能，不能修改命令原始注释或 schema；命名空间描述编辑 description。

Permission.commentable 控制简化注释编辑：普通节点默认为 true，受保护命名空间及命令为 false。服务端不信任提交的 permissions；禁止修改的 description/command.doc 被忽略。CommandNode 的 command.doc 为可选输入，缺省不创建描述覆盖，实际展示回退原始注释首行。输入树及原配置均不被修改。

SemanticRegistry.generation 由配置 revision 和物理目录内容版本组成；目录内容相同时不重新克隆。profileSelection 仅读取名称列表和当前选择，不复制完整配置，供每次工具回复的 Profile 元数据刷新使用。执行、搜索与发现的单次操作共享同一 registry 快照。

全局 registry 的 version 为独立于包版本的整数，当前为 1；缺失按 0 处理。仅全局加载在版本变化时逐项校验和保留有效映射、命名空间、偏好及具名配置，丢弃无效项和冲突项，保存清理后的当前版本后才更新内存状态。相同版本继续严格校验，会话工作快照不执行版本清理。版本变化时不转换旧模型字段。
