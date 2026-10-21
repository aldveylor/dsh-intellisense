# DSH TypeScript IntelliSense

为 DeepSeek Harness 提供持久 TypeScript REPL、主动补全协议和工具命名空间管理。使用 npm 安装的 `@deepseek-ai/dsh`，无需修改 DSH 核心。

## 启动

需要 Node.js 24 或更高版本。依赖安装在本项目 `node_modules/`。

```bash
npm ci
node run.mjs
# 保留终端运行，远程环境可禁止自动打开浏览器：
node run.mjs --no-open --port 3000
```

脚本构建插件并启动 **DSH Web 服务**。首次启动按 DSH 引导配置上游模型的 API 凭据；默认上游为 `deepseek-official` / `deepseek-flash`，可在 `cordis.patch.yml` 修改。Web 登录 token 与模型 API key 是两种凭据：打开终端输出的带 token 登录链接，取得浏览器会话后再使用页面。不要分享该链接。管理界面继承 DSH 的认证，直接未登录访问会返回 401。

在登录后的同一浏览器访问 `/api/ts-intellisense`，配置工具路径和授权。路径示例 `std.fs.read`。未配置工具使用工具原名对应的 `unknown.tool_name` 路径（非标识符字符以 `$十六进制码点$` 转义，数字开头和保留名称添加 `$tool$` 前缀），默认不可执行；创建映射不自动授权。新建会话选择 `ts-repl` 路由，启动补丁也将其设为默认提供方。授权设置与 DSH 本身的工具策略、guard 都必须允许调用。

`node run.mjs --help` 查看原生 Web 启动参数，`./run.sh` 为同一入口的包装。Node.js 入口直接调用 DSH 启动 API，自动构建插件、生成 `build/run.patch.yml`，并通过绝对路径加载本项目插件。进程目录及注册的 Web 工作区均为本项目的 `build/workspace`，默认配置和数据目录为 `build/workspace/.dsh`；可通过 `DSH_HOME` 显式覆盖。默认首次运行需要在此独立配置中设置模型凭据。

## 使用

模型直接输出 TypeScript，工具函数接收与原生工具 JSON Schema 对应的**单个参数对象**，并返回 Promise：

```ts
const file = await std.fs.read({ path: "notes.txt" });
file;
```

实际工具名称、参数和返回值来自当前 DSH 注册表；上例需要先配置对应工具。模型通过 `await std.fs.<|INTELLISENSE|>` 请求真实补全，主动结束本次生成；插件在完整响应结束后加入内部 system 补全上下文和原始 assistant 前缀，再请求续写。不会添加伪造用户消息，也不会中断正在生成的流。`<|LINE_BREAK|>` 累积输入并换行，`<|BREAK|>` 放弃输入；补全用于构造待执行代码；续写完成后解析、类型检查、编译并执行，向用户返回最后一个表达式的执行结果，不回显源码。不执行不完整源码。若模型误输出 DSML 包装或原生工具调用，插件拒绝该响应，并在续写次数上限内要求改用 TypeScript，保留此前未执行的前缀。

每个会话有独立 VM，直接使用 VM 顶层词法变量：`const`、`let`、函数和闭包在后续段可访问。最后一个表达式的结果自动显示，Promise 自动等待。变量使用 JS 原生规则，没有 `del` 命令或绑定代理；`delete object.optionalProperty` 使用正常 TypeScript 检查和 JS 行为，不能删除词法绑定后重新声明。不要把 `const` / `let` 当成 `globalThis` 的属性。

一步完成且无需保留局部变量的操作可写为：

```ts
await (async () => {
    const result = await std.fs.read({ path: "notes.txt" });
    return result;
})()
```

VM 不暴露 `console`；使用最后一个表达式返回执行结果。VM 直接支持原生 `Promise`，使用 `Promise.all` / `Promise.race` 等标准接口。每次请求提示当前会话变量及类型、可用根命名空间，以及从持久化调用统计中选出的常用/最近工具路径。`await tools.sort()` 创建维护子代理，返回命名空间整理提案；也可在管理页面触发。提案经过结构、身份、稳定路径、固定别名和版本验证，在页面明确批准后才写入。整理子代理只能提交结构化输出，不能执行物理工具；新映射仍需单独授权。

## 实现与边界

- 固定 DSH `0.2.1-rc.2` 和 TypeScript `5.9.3`。虚拟 Language Service 提供类型诊断、变量/成员补全和参数提示，`transpileModule` 生成 JS 与 source map。源码树、环境声明和会话符号独立更新。
- `LlmAdapter` 注册 `ts-repl` 路由，在插件拥有的上游请求中管理续写历史，原生 AgentLoop 只看到合并后的完整响应。该路由不向模型暴露原生工具 schema；工具实际调用仍通过 `agent.ctx.tools.execute`，保留原生参数验证、策略和 guard。
- 原生 API 包括 `agent/created`、`system-prompt/assemble`、`ctx.agents.get/list`、`ctx.llm.registerAdapter/stream/listModels`、`ctx.storage.backend.get('json').kv.open`、`ctx.subagents.startActivation`、`ctx.connection.fetch.register` 和 `ctx.effect`。管理接口使用原生 Connection 认证、Host/Origin 和 owner-peer 检查。
- 普通段编译为原生 `vm.Script`，保留该段内的提升和 TDZ。顶层 await 使用分阶段执行：等待初始化值后创建真实顶层声明，或等待异步表达式。**跨 await 阶段的提升和 TDZ 不等同完整 ECMAScript 模块**；含 await 的块不支持提升 `var`，可使用 async IIFE。跨段保留运行时值与推导类型，独立的 interface/type 声明不会作为完整源码模块持续保留；不支持 import/namespace。这不是完整 Node.js/ts-node 环境。
- 每会话一个受 Node Permission Model 限制的子进程，限制内存、同步 VM 时间和异步执行时间；禁用普通 VM 字符串动态代码生成。`node:vm` 本身不是安全边界，注入的宿主函数可能提供宿主 realm 的间接入口。子进程权限拒绝任意文件读取、写入、启动子进程等能力；**不提供操作系统级隔离，也不限制所有网络访问**。运行对抗性不可信代码时应额外使用非特权容器或系统沙箱。
- 数据检查点使用 V8 序列化；可序列化值在重启后恢复，函数、闭包等不可序列化绑定会被省略，不通过重放源码恢复。运行中的 Promise 和完整 VM 堆不持久化。
- 执行和物理派发日志写入 DSH KV。相同完成请求可读取缓存；失败或结果不确定的请求拒绝自动重放，避免重复副作用。不能保证外部系统上的分布式 exactly-once。超时或取消后结束该会话子进程，需要新会话继续。
- 控制协议依赖模型主动遵循停止标记；对截断、重复标记和越界续写拒绝执行。最多续写 12 次，可配置。外层 UI 在生成与执行完成后显示执行结果。

## 开发与验证

```bash
npm run typecheck  # tests/tsconfig.json，同时检查源码与测试
npm test           # 构建后运行 node:test / tsx
npm pack --dry-run # 查看发布内容
```

测试覆盖原生 DSH AgentLoop/注册表/存储集成、补全续写、原生工具 guard、VM 词法规则、持久检查点、映射事务、独立授权、超时和子进程权限。真实 Web 服务另做过 HTTP 验证：未登录 401，经 token 登录后 HTML、JS 和状态接口均为 200。自动测试使用确定性上游适配器，没有调用付费模型；未验证真实模型遵循协议的稳定性。

实现参考：[DSH 插件发布文档](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish.html)、[dsh-find-plugin](https://github.com/awesome-dsh-plugin/dsh-find-plugin)、[dsh-deploy-master](https://github.com/Olympianz/dsh-deploy-master)。内部模块说明见 [src/model.md](src/model.md)。
