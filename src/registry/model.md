# 工具目录与 Profile

`registry.ts` 保存物理工具、语义映射、命名空间元数据、固定提示偏好、具名 Profile 和使用统计，配置写入按 revision 串行提交。未挂载工具默认使用 tools 下的编码路径，unmountedVisible 保存其固定提示偏好。`profiles.ts` 以不可变版本和写时复制隔离会话配置，`path.ts` 统一校验路径及编码物理名称。工具权限由原生工具执行策略决定。

命令固定等级统一为 0（不固定）、1（固定但简略）、2（固定且详细）。Mapping.alwaysVisible 保存等级；builtinVisible、unmountedVisible 为路径或物理 ID 到等级的映射，随 Profile 保存，挂载和移除映射时保留等级。命名空间 alwaysVisible 仍为布尔值。

`profile_tree.ts` 定义对外 Profile 树、递归校验与配置转换，以及英文 TypeScript 声明文本。CommandBrief 使用物理命令 ID 与原始描述；CommandNode 以 type: 'command' 标识命令，可提供 simplifiedBrief，保存为工具描述偏好。NamespaceNode（含 Profile.root）以 type: 'namespace' 标识命名空间，children 按本地名称保存命令或子命名空间。CommandNode.fixedLevel 显式选择 none / fixed-brief / fixed-detail，NamespaceNode.fixed 控制命名空间固定提示；树导入导出保留这些属性，按路径聚合别名；可选名称由会话当前 Profile 决定。

consolePinned 为随 Profile 保存的命名空间固定提示开关，默认 false。管理面板始终展示 console 及其命令，console 命名空间图钉可切换是否固定提示；命令各自保留独立的提示等级。IntelliSense 与原生 console 的可用性不受固定状态影响。PTC 初始 prompt 提示可使用运行时提供的原生 Node.js 变量。
