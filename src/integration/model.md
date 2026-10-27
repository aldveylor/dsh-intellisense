# 集成模型

`presentation.ts` 参考 dsh-agent-tool-presentation 的作用域生命周期，配置 mode 为 ptc/native，两个模式均调用 tools.presentAs('native')，避免原生共享 run_code 使用全局后端。PTC 在隔离的 namespaceRuntime/codeRuntime 服务作用域创建插件执行入口。配置按 scope 继承，命名空间组件及初始 prompt 从同一配置读取模式，不依赖 preset ID。无显式 presentation 的会话不启用本插件的工具、运行时或提示词；内置工具在 presentation 作用域注册，PTC 运行时也在该作用域创建。

`preset.ts` 由主入口内部挂载，依赖 agentPresets 服务，不提供独立包导出。从 presets/intellisense_ptc 和 presets/intellisense 各自的 preset.yml 与完整 agent.cordis.yml 加载、校验并注册两个 Agent Mode，不在注册时注入或改写配置。各自 YAML 统一使用 intellisense-presentation 配置项 ID，加载 @aldveylor/dsh-intellisense/presentation，显式声明 config.mode 为 ptc/native 以区分执行方式。两份完整能力清单均保留规划、技能及子代理支持。

命名空间服务与节点实现在 `../namespace/`；内置工具注册与审计在 `../tools/`。
