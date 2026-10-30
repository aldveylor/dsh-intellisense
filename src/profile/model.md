# Profile 节点与版本引用

`service.ts` 定义 ToolsNamespace、ProfileSaveEvent 与 ProfileSaveEffect，`component.ts` 实现具名 Profile 服务；`ctx.toolsNamespace` 与 `ctx.intellisense.profiles` 使用此处的同一接口，通过 `on('save', handler)` 注册保存事件监听并返回取消监听函数。`namespace/` 管理命名空间消费投影、声明、提示和运行时装配；`catalog/` 管理全局目录与会话引用；`plane/` 保存扁平编辑状态 PlaneProfile/PlaneProfileState 及 toPlaneProfile 转换接口。原 src/registry 与 src/namespace 已迁入本模块。

Profile 与 ProfileSnapshot 是同义匿名节点树接口。EditableNode、EditableNamespace、EditableFunction、EditableSnapshot 提供普通实现；默认 RootNamespace 与内置子节点位于 tools/profile_nodes/。create/getOrCreate 接受无参数工厂并返回实际对象，get/set 使用 ProfileNode，按 type 区分 namespace/function，函数节点的绑定数据位于 function: {tool, doc?}。ProfileNode 通过 copyNode(value) 与 bindName(path) 接口负责独立复制、恢复数据及路径绑定。命名空间不检查 EditableNode 基类，纯接口节点也参与克隆、恢复和重命名/移动策略；受保护的省略节点同样独立复制。默认类的 copyNode 按自身原型复制，含私有字段或其它特殊状态的提供方应自行实现复制。

resolve(path) 返回快照内原始启用节点，支持 global. 前缀；空路径返回根，禁用节点或祖先使路径无效；非法成员标识符或尾点路径返回 undefined，不通过 get 抛出名称校验错误。查询通过每层命名空间的 get(name) 直接查找，不为单个成员查询复制 children Map。查询不访问物理目录、执行工具或统计调用，未绑定的无关成员不影响解析。

节点与 Profile 快照不提供 apply/save 方法。Agent 读取在 tools/profile_data.ts 遍历 snapshot，通过节点接口生成 JSON；写入由 tools/profile_save.ts 读取服务最新快照，save 先 normalize 完整目标并计算差异，apply 保留增量字段，再由 edit.ts 的 applyProfile 遍历独立克隆，调用 get/create/remove 和 setTool/setDescription/setFixedLevel/setDisabled/setBrief。全部校验通过后通过 ToolsNamespace.edit 原子发布，失败不改变原版本。删除与替换由节点自身检查，permissions 只描述规则。

ProfileFunction 可通过具体类的 discovery、presentation、readValue、refresh 提供发现身份、命令契约及预加载行为。这些职责不再放入 ToolAddition。普通工具 schema 与隐藏/PTC 描述元数据只在扁平输出契约中补充，不生成另一套节点树。

SnapshotStore 为全局修改分配递增数值指针，当前具名版本保存在全局表。ProfileReference 保存不可变匿名内容，snapshot getter 返回独立的编辑副本；会话不能发布该副本。进入会话前才将对应版本归档到指针 → Profile 表，未使用的中间全局版本不归档。

AgentSessionAddition.profile 为只读 ProfileReference，name 为独立选择信息。switch 复用全局当前指针，在共享锁内执行存在性检查、首次归档与会话引用持久化；相同指针只归档一次，失败保留原会话引用。save/apply 工具始终修改全局目标，当前会话内容与指针不变。

ProfileSessions 恢复已有引用本身不判断预设或会话是否开始。集成层在空白根会话首次启用、重新选择 Intellisense 预设时，经 load 切换到当前名称的全局最新指针；名称不存在则采用全局默认名称。已开始会话及新子会话继承仍保留原指针，具体初始化边界见 integration/model.md。

ToolsNamespace 统一提供 editor 平面管理接口、initialize/revision、selection/setDefault、具名集合编辑、setAliases、reference/restore/retain 版本读取与归档及保存事件。edit 的 initial 只初始化缺失目标，event 在提交后且事务释放后通知。ProfileVersion 是只读版本接口，持久化类 ProfileReference 实现它。Agent、会话引用和选择器不直接访问 SemanticRegistry；集成层只通过 ToolCatalog 读取和刷新物理工具。

plugin.ts 仅装配 Profile 存储与 toolsNamespace，服务首次读取时独立加载数据，不依赖工具、Agent、统计或 UI 初始化。integration/plugin.ts 负责后续执行和界面集成，卸载它不销毁独立挂载的 Profile 服务。原 namespace 目录不再保留装配入口。session.ts 的 ProfileSessionCollection 为会话引用管理的消费接口。

管理 UI 经 toolsNamespace.editor 的 PlaneProfileEditor 读取平面状态、提供方节点和目录说明，并执行配置/目录操作；不直接依赖 SemanticRegistry 或 NamespaceDefinitions。底层存储通过内部 intellisenseStorage 基础设施共享，不暴露 Profile 业务方法。ctx.intellisense 继续独立提供工具属性、搜索和统计，toolsNamespace 不吸收这些能力。

函数 function.doc 为可选简化注释，默认无，空字符串或纯空白等同于无。无时 agent 使用完整注释，UI 方法块显示默认完整注释，Tooltip 简化注释栏显示“无”。tools.inspect 与 tools.search 不提供简化注释；tools.profile 内部成员保留服务端指定且不可修改的简化注释。
