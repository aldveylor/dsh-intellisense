# 源码模型

本插件由独立命名空间组件与依赖它的 Text PTC 组件组成。`integration/namespace_plugin.ts`（包入口 `./namespace`）挂载 Profile、工具表、管理 UI、初始命名空间提示与 IntelliSense/BREAK 协议，不创建 VM；`index.ts` 默认组合该组件与 exec 工具、codeRuntime 及 Text PTC 协议适配器。旧 REPL 实现、接口及其专用测试已移除。公开入口导出 RuntimeHost、TextExecAdapter 与 SemanticRegistry。

## 执行与审计

`protocol/` 负责末尾 js:exec/ts:exec 围栏、marker 流缓冲、补全续写、usage 合并、合成工具调用和历史投影。无执行块直接回答，非 stop 不执行。原生 AgentLoop 执行 exec，并将工具结果作为下一步输入。详细模型见该目录 model.md。

`runtime/` 管理每会话的受限 Node 进程、严格 AsyncFunction 执行、IPC 校验、取消、超时、epoch 和 descriptor 内省。普通声明不持久，显式 globalThis 状态只在进程存活期间保留。使用原生 console，无 vm.print。详细模型见该目录 model.md。

`integration/` 将真实 agent scope 工具和 Profile 投影为命名空间清单，支持 YAML 别名、宿主参数校验和原生 guarded tools.execute 子调用。注册 Text PTC provider 和 Agent Mode，将 PTC 协议及命名空间只读树写入系统提示词装配，模型工具 schema 为空；保存 exec/context、exec/intellisense、exec/rewrite 及原生父子调用轨迹。详细模型见该目录 model.md。

## Profile 与工具表

`registry/registry.ts` 管理全局具名 Profile 目录、映射、别名、注释、排序、启用状态、固定路径和使用统计。`registry/profiles.ts` 为每会话持有不可变配置版本的智能引用，修改按 CoW 分离；目录覆盖/删除不修改既有会话。新会话捕获 UI 当前选中配置。工具权限始终由原生 guard/策略决定。

tools 命名空间及 tools_* 管理工具暂时不进入实际执行与补全环境，未配置物理工具需挂载或提供自定义别名后调用；不生成 unknown 命名空间。路径保留名称、重复和树碰撞检查。失效工具保留配置，但不进入实际 manifest、补全或执行环境。builtinVisible 记录内置固定提示偏好，按 Profile 保存；默认只提示非 Node 标准的自定义命令，console 等标准接口默认不固定提示。unmountedVisible 保存未挂载工具的固定提示偏好，不兼容旧字段名。

`storage/store.ts` 通过 DSH JSON backend 保存工具目录、Profile 版本和会话引用；MemoryStore/FileStore 用于独立使用。运行时不保存可执行状态或重放工具。

## 管理 UI

`management/panel/management_panel.tsx` 和 `management/panel/tree_provider.ts` 显示 console、tools、vm 固定树与可配置命名空间；内置描述/注释/tooltip 固定英文，其余 UI 支持中英文。内置命令不可改名、拖动或删除，除暂时禁用的 tools 命令外，图钉可以开启/取消，并按当前 Profile 草稿保存。

UI 不再显示 unknown 块。树上方显示当前可用但未挂载的工具数量，点击打开只含未挂载工具的选择器；数量随挂载、移除映射和切换 Profile 更新。失效工具不计入，已挂载但禁用的工具仍算已挂载；内置管理工具和 exec 不计入未挂载工具。

`management/panel/namespace_tree.ts` 处理路径、树迁移和混合拖动排序，固定内置节点禁止落入或移动。工具选择器仍可搜索普通可用工具并挂入根或指定命名空间。`management/profile_picker/` 实现 Profile 切换、创建、删除、重命名、保存和另存为；草稿名称带 *。`management/locale/` 保留本地化与原生语言桥接。协议续写预算由 zod Config 管理；旧历史偏好接口及控件已移除。

`management/server/routes.ts` 的管理接口沿用原生 Connection 的认证和 Host/Origin 保护。`integration/organization.ts` 通过只读维护子代理产生提案，明确批准后按 revision 提交，不变更原生工具权限。

## 构建和部署

`run.mjs` 与 `scripts/local_plugin.mjs` 将本包登记为原生 bundle；cordis.patch.yml 注册插件和 Text PTC preset，并设为默认选择。`presets/text_ptc/` 保存模式元数据、Agent 能力清单及工具别名。`scripts/build.mjs` 先清理 dist，防止移除的模块残留在发布包；随后编译生产源码，并调用 `scripts/build_client.mjs` 构建共享宿主 React 的客户端、独立页面及运行时 worker bundle。生成产物位于 dist/build，不提交 Git。新运行时需要 Linux、Python3、libseccomp 和 Node >=24，加载时实测隔离条件，无法满足则失败。

## 验证

协议、运行时和原生 AgentLoop 的测试使用 fake adapter 与隔离进程，不调用真实模型。`tests/registry/` 与 `tests/management/` 保留当前工具目录及管理界面测试。旧 REPL、unknown 合成命名空间和 vm.print 专用测试已删除。构建检查所有生产源码。

命名空间独立模式保留原生工具协议，BREAK 在转交原生调用前废弃当前响应的调用（包括 DSML）；PTC 模式由末尾执行块协议接管。插件审计使用 `plugin:ts_intellisense/*` 可忽略记录，原生系统提示词更新保存到 `system/message`。
