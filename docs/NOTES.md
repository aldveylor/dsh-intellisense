# Text PTC 审计记录

当前状态：Text PTC 已替换旧 REPL 并设为默认；实际 Web preset-mounted 会话已完成执行往返。最新交付与验证见文末“Text PTC 已接入并启用”。下方初始审计结果保留为历史记录。

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

## Text PTC 已接入并启用

后续用户明确要求移除旧模式、替换为新模式并使新 Agent Mode 生效，覆盖了初始“保留旧模式行为”的限制。本轮已完成：

- index.ts 不再装配 TypeScriptAdapter/runConversation，使用 TextPtcAdapter 合成原生 exec 调用，直接 prose 回答不再编译为 TS。
- codeRuntime 为本插件公开的 RuntimeHost 服务定义；上游当前服务仍是 ptcRuntime，没有改动上游或私有深导入。
- ctx.intellisense 为可选补全服务；静态别名、Profile 和运行时 descriptor 提供按需 TS/Doxygen 信息。
- text-ptc provider 通过公开 llm API 复用已注册的上游适配器与凭据，不重新实例化 DeepSeek 凭据连接；界面原 provider/model 仍可沿用，同样使用新协议。
- preset.yml + agent.cordis.yml 已通过原生 agentPresets 注册。完整 Web profile 启动实测 mode=text-ptc、isDefault=true、broken=null；通过 agents.create + preset mount 创建的会话，header.agentPreset 为 text-ptc，并完成一次 exec → tools.profiles → 普通文本回答。
- 当前本地 Web profile 过去保存的 selectedDefault=ptc 会覆盖 bundle 默认，已修改为 text-ptc，并通过官方 dump-config 确认 default/selectedDefault 均为 text-ptc。该配置位于 build，未提交。
- 移除实际运行时、声明、补全、提示和 UI 的 vm.print，使用原生 Console；内置描述固定英文，图钉可取消，Node 标准接口默认不提示，自定义 vm/tools 默认提示，Profile 保存偏好。
- UI 无 unknown 块，未挂载计数入口按草稿与 Profile 更新；运行时默认路径改为 tools，维护命令为 tools.<method>。
- 新运行时在 Linux/Python3/libseccomp/Node permission 下启动。网络套接字创建/连接/监听与文件读取拒绝已实测；bootstrap 通过一次性 stdin 关闭后只留 IPC。超时/取消/卸载测试验证终止、清理和 epoch 增加。
- 上游 Node PTC 默认 timeoutMs 源码为 120000（dsh-ptc-runtime-node/lib/index.js），本服务与 bundle 默认已对齐；本地用户显式配置仍可覆盖。

检查日志在 build/text_ptc_active_*.log 和 build/text_ptc_mode_activation.log，不提交生成产物。完整 Web 激活 smoke 使用独立 build/activation_smoke 数据目录、随机本地端口、关闭浏览器和遥测，运行后已关闭服务，不调用真实模型。

最新运行的新模式测试为 35 项全部通过；生产构建、typecheck:active、当前 lint 范围全部通过。历史全量测试未宣称通过，也没有删除旧测试或调整断言来隐藏不兼容。A1–A13 的协议/运行时/guard/卸载路径均有实际测试；不能将有限反例当作对任意 hostile JS 的安全性证明。

已知边界：新进程后端目前只支持 Linux；超大工具结果明确拒绝，不使用句柄存储或静默截断。provider 使用公开上游服务转发而非重复持有新的 DeepSeek 实例；实际远端 API 与思考模式未做联网测试。
