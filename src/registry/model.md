# 工具目录与 Profile

`registry.ts` 保存物理工具、语义映射、命名空间元数据、固定提示偏好、具名 Profile 和使用统计，配置写入按 revision 串行提交。未挂载工具默认使用 tools 下的编码路径，unmountedVisible 保存其固定提示偏好。`profiles.ts` 以不可变版本和写时复制隔离会话配置，`path.ts` 统一校验路径及编码物理名称。工具权限由原生工具执行策略决定。
