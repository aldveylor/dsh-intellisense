# 集成模型

`namespace_plugin.ts` 装配共享 Profile、管理 UI、tools_intellisense、命名空间树和模式提示。主入口 index.ts 提供 codeRuntime 与 NamespaceRuntime；独立入口 ./namespace 默认 native，不创建 JS 运行时。

`presentation.ts` 参考 dsh-agent-tool-presentation 的作用域生命周期，配置 mode 为 ptc/native，调用 tools.presentAs()。PTC 等待 ptcRuntime 服务。配置按 scope 继承，命名空间组件及初始 prompt 从同一配置读取模式，不依赖 preset ID。主插件 Config.mode 是无显式作用域配置时的默认值。

`preset.ts` 注册 Intellisense PTC 和 Intellisense 两个 Agent Mode；各自 composition 通过 dsh-intellisense/presentation 显式配置 mode。能力清单保留规划、技能及子代理支持。

`namespace_runtime.ts` 实现原生 PtcRuntime seam，使用现有受限 RuntimeHost 执行完整 TS/JS 函数体。run_code 由原生工具层保留及提供，插件不注册同名工具、不拦截模型流、不解析代码围栏。运行时按 Profile manifest 暴露全局命名空间，将位置参数转换为原生参数，并调用 run_code 已绑定的物理工具闭包；原生 transport 拥有调度、guard、父子日志及附加上下文。显式超时限制在部署上限内，取消传播到进程，按实际 Agent owner 释放状态。取消先解除 IPC 回调等待，再由原生 transport 取消并等待真实子调用，避免循环等待。

`namespace_component.ts` 在 native 模式下按会话注册命名空间代理。代理使用命名参数，按 YAML argMap 转换字段；每次执行按实际调用者重新验证 manifest，并通过物理工具的原生执行流水线派发。生成代理不进入物理工具目录，变更 manifest 后替换，释放会话或卸载时清理；插件为无显式配置的会话创建的默认呈现也随插件卸载。PTC 模式仅向模型暴露 run_code，native 模式仅暴露 manifest 命名空间工具。

`intellisense.ts` 注册 tools_intellisense，固定映射 tools.intellisense。参数 queries 为字符串数组；PTC 包装支持可变字符串参数或一个数组。尾点查询列出直接子项，精确路径展开签名和文档，多查询合并为 TypeScript global 命名空间树。结果作为普通工具响应进入原生历史，并保存查询审计，不更新系统提示词或续写程序。

`namespace.ts` 统一 PTC 参数投影、DSML schema/命名参数映射、返回值投影和声明生成。tools.intellisense 为固定内置项，不受 Profile 启用偏好影响。其他 tools_* 管理命令仍暂时禁用。

`prompt.ts` 根据 native/ptc 配置生成初始说明，并渲染 Profile 选中的部分命名空间树。未知命令先直接查询 tools.intellisense；PTC 通过 run_code 调用命名空间，native 直接使用 DSML 命名空间工具。两个模式的查询结果一致。
