# 管理服务

`routes.ts` 通过原生 Connection 的认证及 Host/Origin 策略提供管理页面、客户端脚本、工具目录配置、Profile 操作；整理提案改由原生客户端创建未提交的新会话草稿，旧提案接口移除。`page.ts` 定义独立页面 HTML。旧 history 操作及 historyLimits 响应字段已移除。状态接口返回 state、tools、effective、defaultProfile 和全局 callsByTool（按物理工具 ID 的累计派发次数），不再计算无人消费的 declarations 或 sessions，配置请求不保留旧 id 字段。配置字段 unmountedVisible 保存未挂载工具的固定提示偏好。

命令固定等级统一为 0（不固定）、1（固定但简略）、2（固定且详细）。Mapping.alwaysVisible 保存等级；builtinVisible、unmountedVisible 为路径或物理 ID 到等级的映射，随 Profile 保存，挂载和移除映射时保留等级。命名空间 alwaysVisible 仍为布尔值。

POST 在事务前校验严格请求结构，畸形 JSON 返回稳定的翻译键 `invalid_json_body`。GET 的可选 profile 查询参数读取该配置，不切换默认配置；defaultProfile 独立返回全局默认名称。configure 必须携带完整配置且不接受 profile，可通过 editingProfile 指定编辑目标；另存为使用显式 save_as 操作及非空 profile，携带 editingProfile 的保存及另存为保持默认 Profile；activate=false 的另存为可直接持久化本地新增的空白配置而不切换默认配置；profile 管理操作独立校验，创建时 activate=false 仅创建非默认配置。

工具目录的每项附带 outputDeclaration；return_type.ts 复用 DSH jsonSchemaToTs 转换移除 description 后的 output schema 并解码 HTML 实体，直接返回类型表达式，不添加 type 或 interface 声明包装，供 Tooltip 代码块展示。

Mapping 请求按单个挂载路径保存，移除 aliases 字段；同一物理工具 ID 可对应多条路径，各条配置独立生效。

配置字段校验与 `profile/profile_json.ts` 共用，确保浏览器上传 JSON 和管理接口使用相同的配置结构。

管理写入成功时返回 ok、revision、defaultProfile、profiles，默认 Profile 选择可只更新返回的元数据，无需重新 GET 全部工具和配置。

状态接口分别读取命令调用与工具查询的全局集合，返回 callsByTool、queriesByTool；queriesByPath 只读取请求中指定（或默认）的 Profile 的 inspect 路径统计。Profile 统计互不混合。

POST action=recover 在既有认证入口执行显式局部修复，不受目录刷新失败阻塞；保留有效 Profile 成员和统计，丢弃无法加载的部分；full=true 时清空两个专属存储单元的所有键并恢复默认配置和空统计。两种操作均清除管理投影缓存，完成后由客户端重新 GET 状态。插件即使数据初始化失败也保留这些管理路由，成功恢复后继续初始化命名空间。

管理 GET 在 registry.generation 不变时复用工具列表与 outputDeclaration，provided 树按所选 Profile 分别缓存；重建只读取一次 registry.tools() 供两种投影共用。配置、物理契约或工具附加属性变化时失效，统计和选中 Profile 状态仍按请求读取，不缓存整个响应。provided 使用实际提交的 providedRoot 及递归 nodeSettings，支持不同 Profile 的内置树和权限差异。


GET ts-intellisense-docs-image 为内置使用文档提供 README 同源截图，复用原生认证入口；严格限制 language 为 en/zh，name 为 namespace_table/tools/tooltip，非法查询或不存在文件返回 404，返回 image/png 与 nosniff，不接受任意文件路径。

文档图片枚举增加 profile_editor、namespace_tree、new_conversation；仅允许固定图片名称与 en/zh 语言组合，仍不接受任意文件路径。

Profile 与 namespace 的管理操作统一调用 toolsNamespace.editor 的 PlaneProfileEditor 接口；物理工具目录通过独立 ToolCatalog 传入。缓存代际由 Profile 服务 revision 与物理目录 generation 共同构成，不依赖具体注册器。
