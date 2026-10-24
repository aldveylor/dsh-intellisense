# 管理服务

`routes.ts` 通过原生 Connection 的认证及 Host/Origin 策略提供管理页面、客户端脚本、工具目录配置、Profile 操作；整理提案改由原生客户端创建未提交的新会话草稿，旧提案接口移除。`page.ts` 定义独立页面 HTML。旧 history 操作及 historyLimits 响应字段已移除。配置字段 unmountedVisible 保存未挂载工具的固定提示偏好。

命令固定等级统一为 0（不固定）、1（固定但简略）、2（固定且详细）。Mapping.alwaysVisible 保存等级；builtinVisible、unmountedVisible 为路径或物理 ID 到等级的映射，随 Profile 保存，挂载和移除映射时保留等级。命名空间 alwaysVisible 仍为布尔值。
