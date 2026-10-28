# 集成模型

`presentation.ts` 参考 dsh-agent-tool-presentation 的作用域生命周期，配置 mode 为 ptc/native，两个模式均调用 tools.presentAs('native')，避免原生共享 run_code 使用全局后端。PTC 在隔离的 namespaceRuntime/codeRuntime 服务作用域创建插件执行入口。配置按 scope 继承，命名空间组件及初始 prompt 从同一配置读取模式，不依赖 preset ID。无显式 presentation 的会话不启用本插件的工具、运行时或提示词；内置工具在 presentation 作用域注册，PTC 运行时也在该作用域创建。

预设注册由独立的 `../preset/` 组件提供，integration 只负责作用域内的工具呈现。

命名空间服务与节点实现在 `../namespace/`；内置工具注册与审计在 `../tools/`。

`intellisense-presentation.config.profile` 可选指定已有具名 Profile。与 mode 一起按最近 presentation 作用域继承，显式子作用域未配置 profile 时不继承外层锁定。指定后会话以目录快照初始化，优先于父会话草稿和全局默认；已有会话选择不同名称时切换到指定配置，同名工作快照保留。缺失名称报错。
