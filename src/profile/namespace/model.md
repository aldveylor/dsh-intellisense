# 命名空间消费模型

`../service.ts` 定义 ToolsNamespace，`../component.ts` 实现 NamespaceComponent。ToolsNamespace 仅管理全局具名 Profile、初始工厂和保存事件，不存储或注册 ToolAddition。NamespaceComponent 使用全局配置适配器发布 Profile 版本；每次修改都取得新的数值指针。会话只引用独立快照存储中的不可变版本。

namespace.ts 的 profileMembers/queryNodes 直接遍历 ProfileNode 或调用 ProfileSnapshot.resolve，不创建另一套节点对象。CommandEntry 是携带原始 ProfileCommand 引用的扁平输出契约；commandEntries 将作用域物理 schema 与原节点的契约方法、ctx.intellisense.toolAdditions 元数据组合。bindingFor 输出 VM 协议数据，declaration 输出 TypeScript 声明，serializeProfile 输出前端 DTO。

不存在 manifest/createNamespace 或服务端 NamespaceNode/CommandNode 语义树。ProfileSnapshot.resolve 返回实际节点而非物理名称；命令消费者自行读取 ProfileCommand.tool。物理可用性由消费边界过滤，执行权限交给 DSH。

plugin.ts 发布 toolsNamespace、intellisense 和内部 namespaceIntegration，负责独立快照 KV 单元与普通配置/统计单元的生命周期。native_tools.ts 处理扁平原生工具命名和直接节点发现；prompt.ts/declaration.ts 只生成显示文本。runtime.ts 将原节点导出的扁平绑定接入隔离 RuntimeHost，取消后等待真实子调用完成。

内置行为由 tools/profile_nodes/ 的具体类拥有。definitions.ts 只维护初始 Profile 工厂、其序列化默认声明及保存观察者；builtin_profile.ts 仅选择 RootNamespace，不注册工具附加属性。
