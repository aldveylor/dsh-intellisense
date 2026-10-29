# 工具元数据

ctx.intellisense.toolAdditions 是跨作用域共享的 ToolAdditions。set(tool, metadata) 添加可撤销属性层，get(tool) 返回合并副本，后注册值覆盖先前值；撤销恢复旧层并递增 revision。

ToolAddition 仅包含 hidden（从工具目录、发现及挂载选择中隐藏）和 ptcDescription（仅 PTC 的物理说明覆盖）。默认隐藏 exec/run_code/tools_run_code。此服务不属于 ToolsNamespace，不管理 Profile、权限、固定身份、发现命令、签名适配或预加载生产器。

fixed/discovery/project/value 等与具体命令类重叠的附加功能已移除。固定身份从实际节点权限识别，内置命令类提供 discovery/presentation/readValue/refresh。
