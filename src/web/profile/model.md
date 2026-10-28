# Profile 数据校验

`profile_json.ts` 定义完整配置的共享 Zod 字段与 JSON 导入解析，供 `../server/routes.ts` 的配置写入及 `../panel/management_panel.tsx` 的上传操作共用，不依赖浏览器组件或服务端环境。
