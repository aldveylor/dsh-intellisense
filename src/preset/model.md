# 预设组件模型

`index.ts` 通过包入口 `@aldveylor/dsh-intellisense/preset` 独立挂载，bundle 配置项 ID 为 `intellisense/preset`，显示名称为 Intellisense Preset，元数据位于根目录 `locale/preset/`。

组件仅依赖 agentPresets 服务，从 `presets/intellisense_ptc` 和 `presets/intellisense` 各自的 preset.yml 与完整 agent.cordis.yml 加载、校验并注册两个 agent 预设，卸载时释放注册。它不挂载主插件、命名空间、运行时、管理 UI 或 presentation，不修改预设内容或默认选择。

两份预设使用 intellisense-presentation 配置项 ID，加载 `@aldveylor/dsh-intellisense/presentation`，显式声明 config.mode 为 ptc/native，并保留规划、技能及子代理能力。默认预设由 bundle 的 agent-preset-registry 配置选择。
