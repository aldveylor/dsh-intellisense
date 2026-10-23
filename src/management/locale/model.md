# 本地化与原生桥接

`zh.ts` 与 `en_us.ts` 定义同一套界面文案，`locale.tsx` 提供语言选择、插值及 React 上下文。`native_panel.tsx` 将宿主语言订阅桥接到管理面板。固定运行时命令的描述由 runtime/builtins.ts 提供英文原文。
