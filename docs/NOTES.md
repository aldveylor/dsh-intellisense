# Text PTC 审计记录

## 版本证据

2026-10-23 从实际安装的 package.json 读取。Node 为 v24.20.0，TypeScript 为 5.9.3。

| 包 | 实际版本 |
|---|---|
| @deepseek-ai/cordis | 4.0.5 |
| @deepseek-ai/schemastery | 3.18.5 |
| @deepseek-ai/dsh | 0.2.1-rc.2 |
| @deepseek-ai/dsh-agent | 0.2.1-rc.2 |
| @deepseek-ai/dsh-agent-loop | 0.2.1-rc.2 |
| @deepseek-ai/dsh-agent-preset | 0.2.1-rc.2 |
| @deepseek-ai/dsh-agent-preset-registry | 0.2.1-rc.2 |
| @deepseek-ai/dsh-llm | 0.2.1-rc.2 |
| @deepseek-ai/dsh-llm-deepseek | 0.2.1-rc.2 |
| @deepseek-ai/dsh-ptc-runtime | 0.2.1-rc.2 |
| @deepseek-ai/dsh-ptc-runtime-node | 0.2.1-rc.2 |
| @deepseek-ai/dsh-session | 0.2.1-rc.2 |
| @deepseek-ai/dsh-tools | 0.2.1-rc.2 |

当前 package-lock.json 已记录安装解析版本；package.json 中仍存在范围约束，例如 cordis `~4.0.5`、client-ui-slots `^0.2.1-rc.2`。本次 T0/T1 仅审计，不宣称已完成精确依赖固定；待实现时同步更新 manifest 和 lockfile，并列出新增直接依赖，避免依赖偶然安装的传递包。

## 验证结果

- `npm run typecheck`：失败，退出码 2，共 12 条既有测试类型错误。包括 3 处旧 Config.provider，4 处 controller 参数数量，1 处缺失 src/registry/session_registry.js，4 处 IsolatedSession 参数数量。
- `npm test`：执行了源码编译和客户端构建，构建成功。测试输出已记录 3 个失败、2 个通过，随后 controller.test.ts 挂起超过两分钟，手动终止本次 npm test 子进程树。无完整测试总计，不能宣称套件通过或仅有 3 个失败。
- 日志：`build/text_ptc_audit_tests.log`，属于生成产物，不提交。
- lint：package.json 没有 lint script，未运行，也未新增虚假的通过脚本。T2 前须选择并配置实际 lint 检查。
- 运行时语义复现：在持久 vm.Context 内运行严格 async 函数，函数局部 let retained=1、globalThis.explicit=2；下一次查询返回 `{ "lexical": "undefined", "explicit": 2 }`。证明持久 Context 不意味着 AsyncFunction 局部绑定持久化。
- A1–A13：尚未实现 / 运行；未连接真实模型；进程隔离和卸载不能视为已验收。

## 实现边界

本次只有差距报告和版本/验证记录。未修改上游、旧 API、接口、实现、旧 Agent Mode 或 UI。没有 monkey patch、私有模块导入或新 provider 注册。

新模式建议采用独立 preset，优先使用当前公开 ptcRuntime 服务契约；对旧模式保留原始 REPL 与 unknown 映射，在新模式生成 tools/console/vm 视图。前缀续写按 SPEC 已允许的 assistant + user 退化方案设计，不依赖未暴露的 prefix 字段。

待明确的问题及源码证据见 gap-analysis.md；交互记录已追加 history.agent.md。依照仓库停止规则，本次未开始 T2–T7。
