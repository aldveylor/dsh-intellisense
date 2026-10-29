# Intellisense 模型

包名为 `@aldveylor/dsh-intellisense`。默认入口组合命名空间服务与受限运行时；独立 `./preset` 入口注册 Intellisense（native DSML）与 Intellisense PTC（TS/JS）预设。两种 presentation 均向 DSH 呈现 native 工具，PTC 使用插件自有 tools_run_code 与隔离 RuntimeHost，不替换部署的全局后端。

## 全局配置与会话引用

`profile/service.ts` 定义 ToolsNamespace，`profile/component.ts` 实现服务，`profile/plugin.ts` 独立装配 Profile 存储与服务；节点位于 `profile/`，目录与持久化适配器位于 `profile/catalog/`，命名空间投影位于 `profile/namespace/`，装配位于 `integration/plugin.ts`。

`ctx.toolsNamespace` 管理共享具名 Profile 及保存事件；`ctx.intellisense.profiles` 指向同一服务。Profile/ProfileSnapshot 是匿名的原始节点树，节点使用 namespace/command 类型。默认工厂创建 RootNamespace 及具体内置命令类；克隆和恢复保留工厂声明的实际原型。节点类负责权限、校验和修改策略。

全局表保存名称 → 当前数值指针与匿名 Profile。每次 save/apply（包括内容相同的成功保存）分配新的全局递增指针，只更新目标名称，不影响现有会话。重命名或选择默认 Profile 不生成内容版本。全局配置的平铺 PlaneProfile/PlaneProfileState 仅作为管理界面的内部编辑适配器，不作为会话状态。

`agent.session.intellisense?.profile` 是只读 ProfileReference，包含数值 pointer。snapshot getter 提供可供全局编辑的独立值，修改该值不会改变会话快照。会话不提供快照编辑或版本发布能力；name 与 profile 为只读 getter，save() 仅持久化当前引用。

旧快照存储为指针 → 匿名 Profile，仅当版本进入会话（初始化或 switch）时归档；未被会话引用的全局中间版本不归档。switch(name) 读取全局名称的当前指针，已归档则复用，否则复制入表，最后仅提交当前会话指针，不创建新版本号。存在性检查、首次归档与会话引用持久化在同一共享锁内；同一会话的切换另行串行化。写入失败不发布新会话指针。

子会话首次进入时继承有效父会话的同一快照指针；后续父子切换独立。已有会话记录优先恢复。presentation 指定 profile 时从该全局名称初始化，禁止用户切换；相同名称的既有会话仍保留旧版本。全局目录删除、修改或默认值变化均不改变已归档版本。

## 工具与消费边界

`ctx.intellisense.toolAdditions` 保存独立的物理工具元数据，支持可撤销分层 set/get。仅保留 hidden、ptcDescription；命名空间服务不注册或特殊处理 ToolAddition。fixed、discovery、project、value 不再由工具附加表表达：固定身份来自具体节点权限，发现、声明契约、预加载值和刷新策略来自命令类。

服务端没有第二套 NamespaceNode/CommandNode 运行时树，也没有会话 SemanticRegistry。inspect、提示词、搜索、原生工具注册及 PTC 遍历同一 ProfileSnapshot 节点。commandEntries 仅在消费边界生成扁平契约并保留原节点引用，bindingFor 输出 VM 绑定数据；serializeProfile 只输出前端 DTO，不构造语义节点对象。YAML 别名在全局版本发布或首次引用前显式写入 Profile，运行时不合成额外成员。

ProfileSnapshot.resolve(path) 返回原始启用节点，支持 global. 前缀和空根路径；节点或祖先禁用时返回 undefined。它不访问物理目录、不执行工具、不统计查询。物理目录只补充当前作用域可用工具的原始文档、参数和输出 schema，DSH 原生执行流水线负责权限与审计。

inspect 使用当前会话引用的快照解析路径。尾点查询列出直接成员，精确命令查询输出完整契约；Profile 简略注释和命名空间描述来自原节点。native 返回 JSON，精确命令查询才扩大当前会话工具发现集合并刷新提示；PTC 返回 TypeScript global 声明。两种模式均无 console 命名空间，VM 自身 console 独立可用。

初始提示按节点固定等级呈现：0 隐藏、1 简述、2 完整契约；原生模式等级 2 命令直接注册，等级 1 只显示目录。代理工具名称添加 ns_ 前缀并用 __ 编码点号，长名称使用摘要避免冲突；代理不进入物理目录，释放时注销。PTC 将参数和结果适配编译到 VM 绑定中，宿主只按物理名称派发，不重复解析命名空间。

## Profile 命令

load() 返回当前会话不可变快照的 JSON 副本，load(name) 读取全局当前 Profile，均不切换。save(name?, profile) 完整替换全局目标，apply(name?, patch) 从全局目标最新版本应用补丁；省略名称使用当前会话选择的名称。两者只改全局表，生效需显式 switch。save 通过节点 normalize 修正必需内置成员，tools 默认禁用；apply 保留未提交字段，null 删除可选字段或成员，不使用 save 的默认禁用规则。

写入树不允许 name、permissions 或未知字段；无名根仅支持 type/children。实际权限由 RootNamespace、ImplToolsNamespace、ImplToolsProfileNamespace、ImplToolsCommand 等具体节点执行。可读 permissions 仅用于说明，不决定服务端实现。普通节点可删除，受保护节点的名称、路径、绑定和文档不可篡改；不存在状态兼容要求。

profile.profiles 返回全局名称与当前会话选择；profile.tools 返回非内置物理工具、当前会话挂载路径（包含禁用和不可用挂载）及全局调用次数。native 每次重新读取；PTC 由命令类生成只读预加载值，profiles 每次调用后刷新，tools 在切换指针后刷新，同次执行内由 VM 更新调用次数。

## 存储、统计与界面

默认 JSON backend 的 ts_intellisense 单元保存全局当前表、编辑偏好、会话引用和统计；独立 intellisense_profile_snapshots 单元保存递增计数器及进入过会话的匿名版本。会话记录仅为 name/pointer，旧版本不随会话释放删除。JournalStore 负责编号及归档的中断恢复；先完成快照归档，再持久化会话引用。

ctx.intellisense 还提供 statistics.calls/queries、按 Profile 名称隔离的 inspectStatistics、searchEngines。通用统计仅处理计数，业务层决定调用或查询时机。计数延迟合并，关闭存储前刷新。搜索支持按作用域契约生成的 BM25 或字符串匹配语料。

管理界面在 web/panel、tool_picker、profile_picker 等组件中实现，服务端 Profile 输出权限及 transport DTO，浏览器仅构建显示树。Profile 下拉框、另存为、JSON 编辑、拖动排序、固定等级、禁用状态及国际化沿用共享协议。文档截图由 scripts/screenshots.mjs 生成；构建和性能产物位于 build/dist，不记录生成中间文件或 agent 文件。
