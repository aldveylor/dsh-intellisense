# 本地化与原生桥接

`zh.ts` 与 `en_us.ts` 定义同一套界面文案，`locale.tsx` 提供语言选择、插值及 React 上下文。`native_panel.tsx` 将宿主语言订阅桥接到管理面板。固定运行时命令的描述由 runtime/builtins.ts 提供英文原文；命名空间操作抛出翻译键，不再硬编码中文。整理草稿提示位于中英文界面翻译表。

整理草稿提示要求分别生成并保存 General（全部命令）、Base（仅 bash 与 edit 两个外部工具，完整固定）和按用途划分的 Profile；根据 totalCalls、交互需求与用途精简描述和分级固定，逐 Profile 校验无重复挂载及包含根节点的 floor(N/3) 扇出限制，最终汇报名称、用途与命令数量。
