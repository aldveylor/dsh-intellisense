# Text PTC 差距审计

审计日期：2026-10-23。范围：本仓库源码和实际安装的 dsh `0.2.1-rc.2` 发布源码 / 类型声明。未修改上游，也未使用网络上的其他版本代替本地证据。本文为 T0/T1 交付，尚未实施 T2–T7。

## T0：仓库结构与对应关系

| 现有组件 | SPEC 对应 | 当前行为 / 差距 |
|---|---|---|
| `src/index.ts`、`cordis.patch.yml` | 组件装配、3.8、T6 | 全局接管普通会话；不是独立新 Agent Mode；监听器会修改普通模式工具呈现和提示词 |
| `src/dsh/adapter.ts`、`src/protocol/controller.ts` | 3.1–3.4 | REPL 控制器直接执行，返回最终文本；没有独立 provider 和合成 exec 调用 |
| `src/protocol/markers.ts` | 3.1–3.2 | 接受原始 TS/普通 TS 围栏；LINE_BREAK 与新要求 LINEBREAK 不同；不支持带审计注释的 marker |
| `src/runtime/isolated.ts`、`worker.ts` | 3.5–3.6 | 每会话进程、超时、取消、IPC 桥已有；无 schema 校验、epoch 或自动重建；子进程加载源码需读取 dist/node_modules |
| `src/runtime/session.ts` | 3.5–3.6 | VM 真实词法绑定、冻结 null 原型命名空间已有；执行语义为 REPL，删除 console，提供 vm.print/restart |
| `src/registry/`、`src/storage/` | 3.5 | Profile、映射、schema 校验、统计可复用；未映射工具落 unknown；无独立 YAML 别名清单 / argMap 机制 |
| `src/typescript/` | 3.7 | TS Language Service 与 VM 补全可复用；新服务格式、取消、长度限制和注入净化仍需实现 |
| `src/dsh/execution_trace.ts`、`src/protocol/execution_trace.ts` | 3.8 | 已有 ts-repl/source 与原生 PTC 子调用轨迹；缺 exec/intellisense 和 exec/rewrite 事件 |
| `src/web/` | UI 要求 | Profile、映射树、轨迹已有；固定节点只有 vm，unknown 是共享虚拟节点 |
| `src/protocol/prompt.ts` | 第 7 节 | REPL 提示词；非末尾 exec 围栏协议，必须为新模式单独生成 |
| `tests/` | A1–A13 | 现有测试验证旧模式；不能作为新协议验收证据 |
| `scripts/`、`run.mjs` | T6 | 原生 bundle 登记已有；缺独立 text-ptc preset |

## V1–V9：源码核实

### V1：codeRuntime 假设不成立

证据：`node_modules/@deepseek-ai/dsh-ptc-runtime/lib/types/index.d.ts` 的 Context 合并和 PtcRuntime；安装目录不存在 dsh-code-runtime 包。

实际服务为 `ctx.ptcRuntime`，契约为 `resolve(PtcRunRequest)`、`run(PtcRunSpec)`、`release(owner)`；请求 bindings 注入宿主回调。支持 language/isolation/programFormat、状态 owner、超时等描述。现有 Node 后端分为 per-call 和 persistent-in-memory。SPEC 指定的 codeRuntime-worker-thread 路径不是当前发布包结构。

依赖此假设的 T3 provider 工作项暂缓。替代方案：在独立 preset realm 实现公开 PtcRuntime 契约，或保留插件自有 codeRuntime 并由 exec 直接消费。建议前者，避免重复上游服务定义；名称差异须在设计说明明确。

### V2：run_code 存在，但不是可配置的命名空间桥

证据：`dsh-tools/lib/types/ptc.js` 的 createRunCodeTool；`ptc.d.ts` 的 RunCodeBridgeOptions；`index.d.ts` 的 requirePtcTransport/presentAs。

run_code 是保留传输工具，参数包含 code 和 description，内部通过注册表 execute 分派，包含排队、guard、取消与 PTC 子调用审计。桥接构造器包含注册表私有闭包，不能从公共入口依赖这些私有能力；没有公开任意分组 / 嵌套别名配置钩子。公开 root 导出 CodeRunFailedError，code 为 CODE_RUN_FAILED。

替代方案：注册独立 exec 工具，使用公开 tools.execute 与父 execution token；实现自己的别名桥及配对审计，不深度导入 createRunCodeTool。

### V3：流契约确认，wire 形态与提示路径有差异

证据：`dsh-llm/lib/types/index.d.ts` 的 LlmAdapter/registerAdapter；`types.d.ts` 的 GenerateOptions/StreamChunk；`dsh-llm-deepseek/lib/types/adapter.d.ts`、公开 index.d.ts；`lib/index.js` 的 request 序列化。

StreamChunk 要求 usage 在终止 finish 前、finish 后无输出；tool-call-delta.argumentsDelta 是原始 JSON 字符串。finish 为带 kind 的类型，不是直接字符串。GenerateOptions 带 sessionId 和 signal，不带 turn/step；无 prefix 请求字段。DeepSeekAdapter 是公开导出的可实例化适配器，目前使用 Messages API，并非旧 Chat Completions translate.ts 结构。新 wrapper 可使用公开构造器，无须私有导入。

### V4：loop 执行以 assembled 内容为准

证据：`dsh-agent-loop/lib/index.js` 的 buildRequest 和 request 路径，尤其 1130–1166 行附近；`lib/types/assistant-stream.d.ts`。

loop 将完整 chunk 流送入 AssistantStreamAttempt。error/aborted 走失败路径，max-tokens 终止；正常消息中的 tool-call block 经 executeToolCalls 执行。必须完整合成 block-start、tool-call-delta、block-end，并发送合法 finish；仅发 name/arguments delta 不能作为充分验证。length 需从 wire 归一化的 max-tokens 判断。适配器不得先执行同一 exec 再让 loop 重复执行。

### V5：事件扩展和关联可用

证据：`dsh-session/lib/types/types.d.ts` 的 SessionEventMap/SessionEventType；`dsh-agent/lib/types/runtime-types.d.ts` 的 agent/request；现有 execution_trace.ts。

可 declaration merging 扩展 SessionEventMap。agent/request 提供 agent/turn/step/signal，是 waterfall，默认必须调用 next。通过 sessionId 关联请求；需按会话持有上下文并在结束/卸载清理，不得使用单一全局 currentAgent。审计须保存完整补充信息和所有原始生成段，不能只存引用。

### V6：前缀续写未获公开契约支持

证据：GenerateOptions 无 prefix；`dsh-llm-deepseek/lib/index.js` 的 Messages 请求序列化无 prefix/reasoning_content 设置；思考历史使用 native replay 元数据。

不能依赖 SPEC 所示 Chat Completions 前缀协议，也不能宣称远端一定支持 assistant prefill。按 SPEC 已授权的退化方案实现 assistant 已生成文本 + user 续写指令与拼接去重。思考 replay 必须仅附属于真实 emitted blocks，不能把内部续写段原封不动绑定到合成后的 blocks。远端实际兼容性未实测。

### V7：冻结 / 可重建要求存在

证据：`dsh-agent-loop/lib/index.js` 1226–1288 附近，request/header、request/context、deriveMessages、deepFreeze；`dsh-llm/lib/types/index.d.ts` 的 llm/stream 契约。

loop 请求是日志的纯函数且被冻结，不能直接改消息。request/header 记录模型配置与工具，request/context 记录模型上下文元数据；后者不是任意 prompt 注入接口。wrapper 可建立新的纯投影请求，但自定义审计事件不会自动进入 deriveMessages。续写输入须可由已记录的原文、补全全文和确定性投影重建；这应由 fake adapter 回放证明。不能以“写了自定义事件”就宣称满足全部原生日志断言。

### V8：原生 preset 和隔离 realm 可用

证据：`dsh-agent-preset-registry/lib/types/definition.d.ts`、`mount.js`、`index.d.ts`；`dsh-agent-preset/lib/types/index.d.ts`；根 cordis.patch.yml。

PresetDefinition 为 id/name/description/order/plugins；注册返回 disposer。mount 审计会发现 provider 泄漏到根 realm；需给新运行时服务配置独立 isolate realm。composedPreset(agent.ctx) 和 serviceFor 可辨识作用域。当前包并无 dsh-block-ptc 样例，不能假设其文件布局；agent.cordis.yml/preset.yml 可由本仓库 bundle 明确引用，不能仅放文件就视作原生可发现。旧入口全局拦截必须对新 preset 委托 next，同时保留旧会话行为。

### V9：工具清单和执行 API 可用

证据：`dsh-tools/lib/types/index.d.ts` 的 schemas(scope)、get(name,scope)、execute(exec)；ToolExecutionInput.parent；现有 dsh/adapter.ts。

schemas 提供 model-facing 参数 schema，get 可拿到实际定义，均须带 agent scope。嵌套调用传入父 execution token，通过原生执行管线保留 pre-execute/guard；parent 不是随意拼接的字符串。别名、argMap、配置 schema 校验和结果边界限制由新宿主负责，不能信任 vm 侧参数检查。

## 风险排序及待明确的语义

1. **P0：AsyncFunction 与跨调用词法变量保留冲突。** SPEC 3.6/第 7 节同时要求严格 AsyncFunction 与变量跨调用保留。实测每次新建函数时 let/const 只在本次函数局部存在；持久 vm.Context 不会改变其词法作用域。建议新模式只承诺 globalThis 显式状态跨调用保留，重启后丢失；若要求 let/const，应继续采用 REPL，或接受额外源码转换。2026-10-23 用户已确认该方案；prompt.agent.md 已修正，不再阻塞。
2. **P0：仅 IPC 与 stdin/stdout 的边界不明确。** prompt 前言要求 agent 交互走 stdin/stdout，SPEC 运行时描述要求目标进程仅 IPC。建议 stdin/stdout 用于 Agent 文本通道，运行时控制/工具 RPC 走 IPC，console 作为有执行 ID 的数据事件回传；2026-10-23 用户已确认上述通道分工；prompt.agent.md 已修正，不再阻塞。
3. **P0：进程级“仅 IPC”尚未成立。** 现有 Node permission 启动允许读 dist/node_modules，不能证明拒绝所有网络能力。原生 PTC 后端允许模块导入及按 sandbox policy 进行文件访问，也不能直接复用并宣称达到 SPEC。需独立验证限制机制，无法满足应加载失败，不能降级为仅删除 vm 中模块。A12 只检查 require/process 名称仍不足以证明进程权限边界。
4. **P1：新旧模式共享 UI/注册表。** 全局 unknown 改 tools、全局 vm.print 改 console 会改变旧模式。建议只在新模式投影 namespace 和 builtins，旧 Profile 保存结构继续共享；UI 按模式显示固定节点。该建议为可行分类，不是已实施行为。
5. **P1：日志与流。** marker 跨 chunk、源码缓冲、合成 block、native thinking replay、取消和确定性重放需整体设计；不得沿用旧控制器直接执行后再合成 exec。
6. **P2：marker 前言与系统提示词冲突。** 前言要求保留 LINEBREAK/BREAK 并允许任意注释；第 7 节却禁止输出 INTELLISENSE 以外的特殊标记。需说明它们是兼容输入而非模型推荐输出，以及 BREAK 的块关闭语义。

## 按任务顺序的改动清单

- T0/T1：本报告、版本与验证记录；记录失效假设和设计问题，不改业务源码。
- T2：新建 llm_text_exec 组件；实现围栏扫描/marker 缓冲、最后有效块选择、续写与一次修复、usage 合并、确定性工具 ID、历史逆向投影、取消和审计；fake inner adapter 覆盖 A1–A9/A13。
- T3：语义确定后实现 runtime_host provider；品牌 ID、配置 schema、消息 schema、每会话队列、epoch、取消/超时/卸载；先验证进程限制再接入真实执行。
- T4：新模式 namespace manifest；保留 Profile/工具映射，宿主 argMap/schema/权限/限额校验；冻结 vm 树，execute(parent) 与子调用审计；覆盖 A11。
- T5：独立 intellisense 服务，按需 TypeScript/Doxygen 声明；前缀/尾部上下文/session 输入，限长净化、超时和取消。
- T6：text-ptc preset、bundle patch、独立新 provider 路由和系统提示；作用域内 console/tools/vm UI 固定节点；确保旧模式回归。
- T7：A1–A13 实测、disposer/epoch/隔离测试、源码 model.md 与设计说明、版本精确固定和 npm 包交付检查。

## 当前完成边界

已完成静态勘察与源码契约核实，未完成任何新模式验收。V1 失效假设已隔离；V6 使用 SPEC 明确允许的退化路线。依据 AGENTS.md“存在需要解决的问题、警告或者错误，则停止任务，写入文件，以等待下一步指令”，在上述 P0 语义明确前停止实现，不将文档审计视为重构完成。基线检查结果见 NOTES.md。

## 用户确认后的推进

2026-10-23：已明确 AsyncFunction 仅持久化显式 globalThis 状态，以及 Agent stdin/stdout 与运行时 IPC 通道边界。继续 T2；V1 的 provider 替代接口与进程隔离证明仍须在 T3 单独处理。

## T2 协议层实现记录

新增 `src/llm_text_exec/`，包括 zod Config、围栏/marker 流解析、确定性历史投影、补全续写、usage 合并、完整合成工具块、取消联动和 session 审计事件声明。采用公开 LlmAdapter 契约注入 inner.stream，生产 DeepSeek 实例的装配属于后续 preset/provider 工作项。新组件不调用运行时，执行完全交给原生 loop。

fake adapter 的 20 项回放测试通过，覆盖 A1–A9/A13 与错误、修复、分片、取消、usage 边界。完整源码构建通过；组件类型检查和 ESLint 通过；全量旧测试类型检查保持既有 12 条错误。此处只声明协议层完成，不声明 T3–T7、新 Agent Mode、真实 IPC 取消、工具宿主或进程沙箱验收完成。
