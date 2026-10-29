# 命名空间节点实现

每个节点类放在同名下划线文件。node.ts 和 command_node.ts 实现普通 tree/leaf、parent 引用、子树序列化、直接成员解析和可执行契约；NamespaceNode 的 add 拒绝覆盖，remove 由父节点校验子对象 removable。

defined_namespace_node.ts 从递归定义安装拥有的子对象，权限不妨碍内部构建已有成员。command_node.ts 从通用 CommandPresentation 契约读取绑定、重载、结果与预加载，不区分内置工具类型。内置结构、固定等级及权限通过上层 builtin_profile.ts 调用便携接口设置，移除 Tools/Profile/Inspect 专用命名空间节点类。

tools.profile 命名空间允许在固定等级 0 和 1 之间切换，固定偏好通过 Profile 的 namespaceVisible 保存；结构编辑限制保持不变。

context.ts 提供作用域物理目录、执行模式（默认 ptc）、禁用查询与管理目录展示选项。受保护节点安装前将 BuiltinTool 按模式投影为 BuiltinCommand，声明与序列化直接使用投影后的注释。command_contract.ts 统一投影参数、schema、结果与普通声明。上层 namespace/namespace.ts 组织初始普通匿名根及受保护子树并注册映射；查询不创建节点。客户端只接收共享 Permission 和 leaf/tree 序列化描述，不需要识别服务端子类。

序列化节点不包含 signature；内部命令保留签名供声明和预加载字段类型展示使用，普通命令声明由原生 schema 投影生成。


工具节点统一为 CommandNode，操作许可仅由 permissions 决定。工具提供者通过 setToolAddition 注册 project（模式契约、签名、参数布局、返回策略）、discovery 标记及 value 生产器/刷新策略；通用树构建不识别内置命令表。默认固定等级由节点定义提供，RegistryConfiguration 不假设 tools.inspect。

NamespaceInitialization 与 NamespaceImplementation 描述提供者构造器；类负责自己的变更策略。ImplToolsNamespace 位于 tools/，不属于通用节点模块；InnerCommandNode 已删除。
