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

本次已将 package.json 中所有 @deepseek-ai 包的直接依赖、开发依赖和 peer 约束固定为实际安装的精确版本，并同步 package-lock.json。新增直接依赖 zod 4.6.7；新增精确版本 ESLint 9、@eslint/js 9 与 typescript-eslint 8，实际 patch 版本见 package.json。未更换已安装 dsh 版本。

## 验证结果

- `npm run typecheck`：失败，退出码 2，共 12 条既有测试类型错误。包括 3 处旧 Config.provider，4 处 controller 参数数量，1 处缺失 src/registry/session_registry.js，4 处 IsolatedSession 参数数量。
- `npm test`：执行了源码编译和客户端构建，构建成功。测试输出已记录 3 个失败、2 个通过，随后 controller.test.ts 挂起超过两分钟，手动终止本次 npm test 子进程树。无完整测试总计，不能宣称套件通过或仅有 3 个失败。
- 日志：`build/text_ptc_audit_tests.log`，属于生成产物，不提交。
- 初始审计时没有 lint script；本次已新增真实 ESLint 配置，只检查新协议组件和对应测试，不宣称已检查旧源码。
- 运行时语义复现：在持久 vm.Context 内运行严格 async 函数，函数局部 let retained=1、globalThis.explicit=2；下一次查询返回 `{ "lexical": "undefined", "explicit": 2 }`。证明持久 Context 不意味着 AsyncFunction 局部绑定持久化。
- A1–A13：尚未实现 / 运行；未连接真实模型；进程隔离和卸载不能视为已验收。

## 实现边界

初始审计只有文档。本次用户确认后已新增独立 llm_text_exec 协议组件、fake adapter 回放测试和校验工具链；未修改上游、旧 Agent Mode 或 UI。没有 monkey patch、私有模块导入或新 provider 注册。

新模式建议采用独立 preset，优先使用当前公开 ptcRuntime 服务契约；对旧模式保留原始 REPL 与 unknown 映射，在新模式生成 tools/console/vm 视图。前缀续写按 SPEC 已允许的 assistant + user 退化方案设计，不依赖未暴露的 prefix 字段。

用户已确认 AsyncFunction 仅保留显式 globalThis 状态，以及 Agent stdin/stdout 与运行时 IPC 的分工；prompt.agent.md 已修正。T2 已实现为独立组件，尚未接入生产 provider、运行时或 preset；T3–T7 未交付。V1 的 ctx.codeRuntime 假设失效，按 prompt 规则隔离该工作项；替代接口建议是当前公开 ctx.ptcRuntime。

## 用户确认后的 T2 检查

- `npm run typecheck:text-exec`：通过，检查新组件和测试。
- `npm run lint`：通过，ESLint 实际检查新组件和测试。
- `npm run test:text-exec`：20 项全部通过，覆盖 A1–A9、A13 及额外边界条件；每个测试配置 10 秒超时，无真实模型请求。
- `npm run build`：通过，包括完整源码 tsc 和客户端打包。
- `npm run typecheck`：再次执行仍失败，保持原有 12 条旧测试错误；新组件没有新增错误。未改旧测试文件掩盖错误，也未重新运行已知会挂起的完整测试套件。
- A10–A12 尚未完成，不把 query mock 的取消测试视为真实 runtime RPC 验收。
- 隔离探测：`node --permission` 下仍可在 127.0.0.1 监听端口；`unshare -Urn -- true` 成功，系统存在 libseccomp.so.2。后两项仅证明环境有候选机制，未实现或证明完整“仅 IPC”约束。
- prompt.agent.md 和 history.agent.md 属于 agent 文件，按仓库规范只在本地更新，不加入 Git 提交。
