# 执行命名空间投影

node.ts、command_node.ts 表达可执行的 tree/leaf 节点、父引用、路径和无环序列化。DefinedNamespaceNode 在外部操作前安装已有子对象；命令契约由 command_contract.ts 投影参数、结果及声明。context.ts 提供可选的命名空间执行投影构造器。

这里的执行节点与 Profile 编辑节点分工不同。默认 Profile 及权限检查使用 tools/profile_nodes/ 的 RootNamespace、ImplToolsNamespace、ImplToolsProfileNamespace、ImplToolsInspectCommand 和共享 ImplToolsCommand；它们实际构造默认树并检查 apply、set、remove 等操作。执行层读取该树的声明与权限，不再用 InnerCommandNode 承担内置工具策略。

内置命令签名、重载、结果策略和预加载由 ToolAddition.project/value 提供，最终投影为 CommandNode。固定等级与禁用状态仍通过 Profile 配置传入运行时；普通 NamespaceNode/CommandNode 不识别具体内置命令名称。
