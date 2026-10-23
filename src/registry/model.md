# 工具目录与 Profile

`registry.ts` 保存物理工具、语义映射、命名空间元数据、固定提示偏好、具名 Profile 和使用统计，配置写入按 revision 串行提交。未挂载工具默认使用 tools 下的编码路径，unmountedVisible 保存其固定提示偏好。`profiles.ts` 以不可变版本和写时复制隔离会话配置，`path.ts` 统一校验路径及编码物理名称。工具权限由原生工具执行策略决定。

命令固定等级统一为 0（不固定）、1（固定但简略）、2（固定且详细）。Mapping.alwaysVisible 保存等级；builtinVisible、unmountedVisible 为路径或物理 ID 到等级的映射，随 Profile 保存，挂载和移除映射时保留等级。命名空间 alwaysVisible 仍为布尔值。

`profile_tree.ts` 定义对外 Profile 树、递归校验与配置转换，以及英文 TypeScript 声明文本。CommandBrief 使用物理命令 ID 与原始描述；CommandNode 可提供 simplifiedBrief，保存为工具描述偏好。树按路径聚合别名，沿用存活命令的固定等级；可选名称由会话当前 Profile 决定。

consoleMounted 为随 Profile 保存的命名空间挂载开关，默认 false。管理面板保留 console 节点及挂载按钮；未挂载时不展示其命令，不参与 IntelliSense 和固定提示。运行时原生 console 始终可用，PTC 初始 prompt 明确提示可使用运行时提供的原生 Node.js 变量。
