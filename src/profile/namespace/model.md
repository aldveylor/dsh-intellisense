# 命名空间消费模型

`../service.ts` 定义 ToolsNamespace，`../component.ts` 实现 NamespaceComponent。ToolsNamespace 仅管理全局具名 Profile、初始工厂和保存事件，不存储或注册 ToolAddition。NamespaceComponent 使用全局配置适配器发布 Profile 版本；每次修改都取得新的数值指针。会话只引用独立快照存储中的不可变版本。

namespace.ts 的 profileMembers/queryNodes 直接遍历 ProfileNode 或调用 ProfileSnapshot.resolve，不创建另一套节点对象。FunctionEntry 是携带原始 ProfileFunction 引用的扁平输出契约；functionEntries 将作用域物理 schema 与原节点的契约方法、ctx.intellisense.toolAdditions 元数据组合。bindingFor 输出 VM 协议数据，declaration 输出 TypeScript 声明，serializeProfile 输出前端 DTO。

不存在 manifest/createNamespace 或服务端 NamespaceNode/FunctionNode 语义树。ProfileSnapshot.resolve 返回实际节点而非物理名称；命令消费者自行读取 ProfileFunction.tool。物理可用性由消费边界过滤，执行权限交给 DSH。

本目录不含插件装配入口。../plugin.ts 独立发布 toolsNamespace 并管理 Profile 存储；../../integration/plugin.ts 消费服务并发布 intellisense 和内部 namespaceIntegration，管理统计、路由与执行生命周期。native_tools.ts 处理扁平原生工具命名和直接节点发现；prompt.ts/declaration.ts 只生成显示文本。runtime.ts 将原节点导出的扁平绑定接入隔离 RuntimeHost，取消后等待真实子调用完成。

内置行为由 tools/profile_nodes/ 的具体类拥有。definitions.ts 只维护初始 Profile 工厂、其序列化默认声明及保存观察者；builtin_profile.ts 仅选择 RootNamespace，不注册工具附加属性。

serializeProfile 通过命名空间直接属性生成 DTO，不调用容器的递归 serialize。EditableNamespace.serialize 仅复制本层设置，子节点各自负责输出独立数据，避免重复深拷贝子树。

protectedToolNames 从初始节点权限收集受保护物理工具身份。目录复用 definitions.revision 对应的初始树与身份集合；集成层复用 ToolsNamespace.revision 对应的集合，工厂变化后失效，批量工具列表不逐项重建初始 Profile。
