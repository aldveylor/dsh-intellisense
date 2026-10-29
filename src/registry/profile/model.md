# Profile 便携接口模型

Profile 是匿名命名空间 snapshot 的 interface，ProfileSnapshot 是同义类型；不包含目录名称、root getter 或 commit。ProfileCollection 是具名集合 interface，提供 list/get/create/getOrCreate/remove/edit。create 原子创建空 Profile，get 返回独立 snapshot，直接编辑查询副本不影响目录；edit(name, modifier) 读取最新副本，校验并原子保存回调返回的 snapshot。回调失败、无效节点或存储失败不发布修改，同名编辑按顺序执行。目录名称由集合持有，会话目标使用独立工作配置。

ProfileNode 是共享 interface；ProfileNamespace 和 ProfileCommand 继承该接口。EditableNode 是实现基类，EditableNamespace、EditableCommand、EditableSnapshot 为实现 class，主入口只导出便携 interface/type。所有公开集合方法和子节点操作返回接口；调用方无需引用实现类或构造器。

命名空间持有直接子对象 Map，get/create/getOrCreate/remove 只接收直接成员名，不接受扁平路径。create/getOrCreate 默认创建命名空间，kind: command 创建命令；setTool 绑定物理工具。setPermissions 合并显式覆盖，未指定字段保留已有设置或类型默认值。setBrief 编辑 snapshot 的用途说明。

node_settings.ts 将权限与插件覆盖说明按直接 children 递归保存；providedRoot 只保存显式提交的插件节点树，空树不自动补入内置命令。configuration.ts 是受信编辑投影，允许固定工具挂载和显式权限设置；validate_edit.ts 为人工、agent 及管理 HTTP 写入校验原始服务端权限。运行时树在安装已有成员后应用权限，acceptsChildren=false 不阻止加载已有子节点。

list() 仅返回目录名称数组，不包含 Profile 数据或当前选择；remove(name) 与创建、编辑串行执行，复用目录删除校验与持久化。删除默认 Profile 时回退到已有配置，拒绝删除最后一个 Profile；既有会话快照保持独立。


工具节点统一为 CommandNode；permissions 保留为 agent 和前端可读的权限声明，实际阻止由保存 effect 与具体节点实现负责。工具提供者通过 setToolAddition 注册 project（模式契约、签名、参数布局、返回策略）、discovery 标记及 value 生产器/刷新策略；通用树构建不识别内置命令表。默认固定等级由节点定义提供，RegistryConfiguration 不假设 tools.inspect。

agent 的 tools.profile.save/apply 统一调用 toolsNamespace.saveProfile，经过 effect('save', handler) 顺序处理独立的 ProfileSaveEvent，由提供者修复与检查后原子持久化；通用保存入口不再通过 profileConfiguration 对内置树执行额外权限判断。事件提供 profile、baseline 可编辑快照、operation、tools 和可修改的 result；异常不写入目录。内置插件自行注册修复 effect，恢复 tools 子树、工具绑定、权限及 inspect 固定等级；save 仍默认禁用 tools，apply 保留原禁用状态。插件侧 edit 是可信编辑入口，不触发 agent 保存 effect；新建 Profile 仍为空。

agent save/apply 由 NamespaceComponent 经保存 effect 处理，再使用 editedConfiguration 投影，permissions 声明按原节点保留但投影函数不执行提供者策略。profileConfiguration 作为独立不受信转换辅助函数仍提供声明校验；它不再是 agent 保存路线。插件侧 edit 可修改独立 snapshot；运行时具体命名空间类的 add/remove 限制不作用于这种可信编辑副本。
