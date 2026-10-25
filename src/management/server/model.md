# 管理服务

`routes.ts` 通过原生 Connection 的认证及 Host/Origin 策略提供管理页面、客户端脚本、工具目录配置、Profile 操作；整理提案改由原生客户端创建未提交的新会话草稿，旧提案接口移除。`page.ts` 定义独立页面 HTML。旧 history 操作及 historyLimits 响应字段已移除。状态接口返回 state、tools、effective、defaultProfile 和全局 callsByTool（按物理工具 ID 的累计派发次数），不再计算无人消费的 declarations 或 sessions，配置请求不保留旧 id 字段。配置字段 unmountedVisible 保存未挂载工具的固定提示偏好。

命令固定等级统一为 0（不固定）、1（固定但简略）、2（固定且详细）。Mapping.alwaysVisible 保存等级；builtinVisible、unmountedVisible 为路径或物理 ID 到等级的映射，随 Profile 保存，挂载和移除映射时保留等级。命名空间 alwaysVisible 仍为布尔值。

POST 在事务前校验严格请求结构，畸形 JSON 返回稳定的 Invalid JSON body。GET 的可选 profile 查询参数读取该配置，不切换默认配置；defaultProfile 独立返回全局默认名称。configure 必须携带完整配置且不接受 profile，可通过 editingProfile 指定编辑目标；另存为使用显式 save_as 操作及非空 profile，携带 editingProfile 的保存及另存为保持默认 Profile；activate=false 的另存为可直接持久化本地新增的空白配置而不切换默认配置；profile 管理操作独立校验，创建时 activate=false 仅创建非默认配置。

工具目录的每项附带 outputDeclaration；return_type.ts 复用 DSH jsonSchemaToTs 转换原始 output schema 并解码 HTML 实体，有合法 title 标识符的对象通过 TypeScript AST 生成 interface，其余类型生成 type 声明，匿名类型命名为 Result，供 Tooltip 代码块展示，浏览器无需加载服务端工具运行依赖。
