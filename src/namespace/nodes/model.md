# 命名空间节点实现

每个节点类放在同名下划线文件。node.ts 和 command_node.ts 实现普通 tree/leaf、parent 引用、子树序列化、直接成员解析和可执行契约；NamespaceNode 的 add 拒绝覆盖，remove 由父节点校验子对象 removable。

inner_namespace_node.ts 限制外部结构编辑；inner_command_node.ts 实现工具特有绑定、重载、结果与预加载。tools_namespace_node.ts 和 profile_namespace_node.ts 管理自身内部子对象及权限；intellisense_command_node.ts 定义固定等级 2 和可禁用策略。

context.ts 提供作用域物理目录、禁用查询与管理目录展示选项。command_contract.ts 统一投影参数、schema、结果与普通声明。上层 namespace/namespace.ts 组织初始普通匿名根及受保护子树并注册映射；查询不创建节点。客户端只接收共享 Permission 和 leaf/tree 序列化描述，不需要识别服务端子类。

序列化节点不包含 signature；内部命令保留签名供声明和预加载字段类型展示使用，普通命令声明由原生 schema 投影生成。
