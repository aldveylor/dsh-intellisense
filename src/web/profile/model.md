# Profile 数据校验

`profile_json.ts` 定义完整配置的共享 Zod 字段与 JSON 导入解析，供 `../server/routes.ts` 的配置写入及 `../panel/management_panel.tsx` 的上传操作共用，不依赖浏览器组件或服务端环境。

JSON 导入允许读取内部存储快照中的 nodeSettings/providedRoot 元数据，但不将其作为人工写入字段提交；权限与插件子树仍由目标 Profile 的服务端配置决定。
