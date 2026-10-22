# DSH TypeScript IntelliSense

为 DeepSeek Harness 提供持久 TypeScript REPL、主动补全协议和工具命名空间管理。使用 npm 安装的 `@deepseek-ai/dsh`，无需修改 DSH 核心。

## 启动

需要 Node.js 24 或更高版本。依赖安装在本项目 `node_modules/`。

```bash
npm ci
node run.mjs
# 保留终端运行，远程环境可禁止自动打开浏览器：
node run.mjs --no-open --port 3000
# 另外加载已构建的本地插件（可重复指定）：
node run.mjs --plugin /absolute/path/to/plugin
```

脚本构建插件并启动 **DSH Web 服务**。首次启动按 DSH 引导配置上游模型的 API 凭据；普通对话自动进入 REPL，使用界面选择的模型通道（provider）和具体模型（model）；切换模型后继续使用当前会话 VM。插件不注册模型路由，也不配置固定上游，直接使用原请求选中的任意模型。Web 登录 token 与模型 API key 是两种凭据：打开终端输出的带 token 登录链接，取得浏览器会话后再使用页面。不要分享该链接。管理界面继承 DSH 的认证，直接未登录访问会返回 401。

登录后打开 **插件 → dsh-ts-intellisense → 配置**，配置工具路径；也可在同一浏览器访问 `/api/ts-intellisense`。所有会话共享全局工具配置；失效工具保留映射并显示红色，不进入 AI 提示、补全或执行环境。两个入口共用 React 管理界面，支持搜索、schema 查看、配置草稿与整理提案审核。路径示例 `std.fs.read`。未配置工具使用工具原名对应的 `unknown.tool_name` 路径（非标识符字符以 `$十六进制码点$` 转义，数字开头和保留名称添加 `$tool$` 前缀），保留下划线，不自动拆分分类。未配置工具可直接调用，执行权限交给 DSH 原生策略判断。插件保留原生默认模型设置，并自动接管普通会话，包括加载前已存在的会话。标题、压缩等辅助请求及原生子代理沿用自身流程。调用仍须通过 DSH 本身的工具策略和 guard。

`node run.mjs --help` 查看原生 Web 启动参数，`./run.sh` 为同一入口的包装。Node.js 入口直接调用 DSH 启动 API，自动构建本项目，并将其以本地目录链接登记到 Web profile 的依赖和 `dsh.profile.bundles` 中，通过原生 bundle 机制加载，支持插件管理页及配置插槽。`--plugin <目录>` 可额外指定已构建且声明 `dsh.bundle.patch` 的本地插件，参数可重复；相对路径以启动命令的当前目录为准，登记结果持久保存在 profile 中。进程目录及注册的 Web 工作区均为本项目的 `build/workspace`，默认配置和数据目录为 `build/.dsh`；可通过 `DSH_HOME` 显式覆盖。默认首次运行需要在此独立配置中设置模型凭据。

## 使用

模型在内部使用 TypeScript 执行，最终回复默认使用用户语言的自然语言字符串；仅在用户明确要求时返回代码或结构化数据。工具函数接收与原生工具 JSON Schema 对应的**单个参数对象**，并返回 Promise：

```ts
const file = await std.fs.read({ path: "notes.txt" });
file;
```

实际工具名称、说明、参数和返回值来自当前 DSH 注册表的原生 schema；命名空间及工具名称前缀补全只提供名称和原生说明，不展开参数；已知路径和参数可直接调用，不必每次补全。`std.fs.read<|INTELLISENSE|>` 提供 read 的签名和参数说明，以及不展开参数的 read* 候选；`std.fs.read(<|INTELLISENSE|>` 只提供已选中调用的参数提示，不列 read*；参数与返回值说明由 TypeScript 根据光标位置按需解析，可在调用、参数对象或返回值成员处请求补全，不直接附完整 schema；上例需要先配置对应工具。模型通过 `await std.fs.<|INTELLISENSE|>` 请求真实补全，主动结束本次生成；插件在完整响应结束后加入内部 system 补全上下文和原始 assistant 前缀，再请求续写。不会添加伪造用户消息，也不会中断正在生成的流。`<|LINE_BREAK|>` 累积输入并换行，`<|BREAK|>` 放弃输入；补全用于构造待执行代码；续写完成后解析、类型检查、编译并执行，向用户返回最后一个表达式的执行结果，不回显源码。不执行不完整源码。若模型误输出 DSML 包装或原生工具调用，插件拒绝该响应，并要求改用 TypeScript，保留此前未执行的前缀。

每个会话有独立 VM，直接使用 VM 顶层词法变量：`const`、`let`、函数和闭包在后续段可访问。最后一个表达式的结果自动显示，Promise 自动等待。变量使用 JS 原生规则，没有 `del` 命令或绑定代理；`delete object.optionalProperty` 使用正常 TypeScript 检查和 JS 行为，不能删除词法绑定后重新声明。不要把 `const` / `let` 当成 `globalThis` 的属性。

一步完成且无需保留局部变量的操作可写为：

```ts
await (async () => {
    const result = await std.fs.read({ path: "notes.txt" });
    return result;
})()
```

VM 不暴露 `console`。使用全局固定的 `vm.print(...values)` 将工具结果或中间值输出给 agent，agent 读取反馈后继续生成下一段程序；打印值不直接作为对话回复。运行时错误同样反馈给 agent，VM、已初始化变量和已有副作用保留，出错代码不会自动重放。无打印、错误或重启的程序以最后一个表达式返回用户回复。`vm.restart()` 立即结束当前段并新建 Context；`vm.restart(["file", "result"])` 可保留指定变量的可复制值及其 const/let/var 属性，其他变量清除。未初始化变量、未知名称或函数等不可复制值会使转移失败，并保留当前 Context。工具配置和固定回调始终保留。管理树中固定显示淡灰色 vm 命名空间，print/restart 以其下的命令块展示，不能改名、删除、拖动或配置。unknown 同样为不可修改的虚拟命名空间，显示未挂载工具；只允许工具拖出，不接受拖入。VM 直接支持原生 `Promise`，使用 `Promise.all` / `Promise.race` 等标准接口。每次请求提示当前会话变量及类型、可用根命名空间，以及从持久化调用统计中选出的常用/最近工具路径。`await unknown.tools_namespace({})`（或配置后的语义路径） 创建维护子代理，返回命名空间整理提案；也可在管理页面触发。提案经过结构、身份、稳定路径、固定别名和版本验证，在页面明确批准后才写入。整理子代理只能提交结构化输出，不能执行物理工具；新映射的执行权限仍由 DSH 原生策略判断。

## 实现与边界

- 固定 DSH `0.2.1-rc.2` 和 TypeScript `5.9.3`。虚拟 Language Service 提供类型诊断、变量/成员补全和参数提示，`transpileModule` 生成 JS 与 source map。源码树、环境声明和会话符号独立更新。
- 通过 `llm/stream` 中间件直接接管原请求选中的任意模型，在插件拥有的上游请求中管理续写历史，原生 AgentLoop 实时接收上游思考流及最终执行结果；“轨迹”以 `ts_repl` 的 `codes: string[]` 参数实时展示每次生成的原始代码段（含控制标记），保留续写及纠错过程，并成对保存每次 INTELLISENSE 查询和完整结果；VM_EXECUTE 子记录保存各段执行结果、打印、异常及当前绑定，通过校验后才执行；思考过程继续流式显示，对话仅显示最终执行结果。轨迹同时记录真实子工具的参数、结果、错误及展示信息，并通过原生请求目录保留子工具 schema。上游请求不向模型暴露原生工具 schema；工具实际调用仍通过 `agent.ctx.tools.execute`，保留原生参数验证、策略和 guard。
- 原生 API 包括 `agent/created`、`system-prompt/assemble`、`ctx.agents.get/list`、`ctx.llm.stream`、`ctx.storage.backend.get('json').kv.open`、`ctx.subagents.startActivation`、`ctx.connection.fetch.register` 和 `ctx.effect`。管理接口使用原生 Connection 认证、Host/Origin 和 owner-peer 检查。
- 普通段编译为原生 `vm.Script`，保留该段内的提升和 TDZ。顶层 await 使用分阶段执行：等待初始化值后创建真实顶层声明，或等待异步表达式。**跨 await 阶段的提升和 TDZ 不等同完整 ECMAScript 模块**；含 await 的块不支持提升 `var`，可使用 async IIFE。跨段保留运行时值与推导类型，独立的 interface/type 声明不会作为完整源码模块持续保留；不支持 import/namespace。这不是完整 Node.js/ts-node 环境。
- 每会话一个受 Node Permission Model 限制的子进程，限制内存、同步 VM 时间和异步执行时间；禁用普通 VM 字符串动态代码生成。`node:vm` 本身不是安全边界，注入的宿主函数可能提供宿主 realm 的间接入口。子进程权限拒绝任意文件读取、写入、启动子进程等能力；**不提供操作系统级隔离，也不限制所有网络访问**。运行对抗性不可信代码时应额外使用非特权容器或系统沙箱。
- 数据检查点使用 V8 序列化；可序列化值在重启后恢复，函数、闭包等不可序列化绑定会被省略，不通过重放源码恢复。运行中的 Promise 和完整 VM 堆不持久化。
- 执行和物理派发日志写入 DSH KV。相同完成请求可读取缓存；失败或结果不确定的请求拒绝自动重放，避免重复副作用。不能保证外部系统上的分布式 exactly-once。超时或取消后结束该会话子进程，需要新会话继续。
- 控制协议依赖模型主动遵循停止标记；对截断、重复标记和越界续写拒绝执行。单次任务仅保留最近 3 次 IntelliSense 信息，超出时淘汰最旧条目；取消最大纠错次数；每次逻辑请求按未执行源码记录 IntelliSense 位置，第三次遇到同一位置立即失败，不执行缓冲；不同位置可持续补全。补全上下文不提交到对话历史，不跨任务保留。思考文本在上游生成时实时显示，工具在执行时记录轨迹，最终回复在执行完成后显示；上游未返回思考文本时不会添加思考内容。

## 调试日志

插件使用 DSH 原生 `ts-intellisense` logger，以 info 级别记录 `ts.response`、`ts.parse`、`intellisense.request/result`、`ts.validate.request/result` 和 `ts.execute.request/result`，包括源码、补全上下文、编译诊断及执行结果；请求错误以 error 级别记录 `ts.request.error`。正常日志包含会话与请求标识，可在 `./run.sh` 启动的 DSH 日志中关联各轮续写。日志包含实际请求及工具数据，按 DSH 的日志配置保存。

## 开发与验证

```bash
npm run typecheck  # tests/tsconfig.json，同时检查源码与测试
npm test           # 构建后运行 node:test / tsx
npm pack --dry-run # 查看发布内容
```

既有测试包含 React 原生入口注册及独立页面交互、实时思考与原生工具轨迹、原生 DSH AgentLoop/注册表/存储集成、补全续写、原生工具 guard、VM 词法规则、持久检查点、映射事务、超时和子进程权限。本轮改动通过源码与客户端构建、所新增测试的严格类型检查，以及 9 项定向检查：补全位置与提示词、完整 IntelliSense 记录、VM 输出/错误反馈、变量保留重启、隔离进程 IPC、真实 DSH 多段执行与最终回复缓存、只读内置块；另以原生客户端组装器检查实时轨迹与历史回放一致。按项目规范未更新或运行依赖旧会话配置和最大纠错参数的测试。自动测试使用确定性上游适配器，没有调用付费模型；未验证真实模型遵循协议的稳定性。

实现参考：[DSH 插件发布文档](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish.html)、[dsh-find-plugin](https://github.com/awesome-dsh-plugin/dsh-find-plugin)、[dsh-deploy-master](https://github.com/Olympianz/dsh-deploy-master)。插件入口与配置位置参考 [ModLens](https://github.com/liustack/modlens/blob/main/dsh/client.js)。内部模块说明见 [src/model.md](src/model.md)。
