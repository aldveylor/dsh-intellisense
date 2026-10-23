# DSH Text PTC / IntelliSense

通过模型文本中的 `js:exec` / `ts:exec` 执行块调用原生 DSH 工具，保留具名 Profile、工具路径映射及管理界面。旧 REPL 接管已由 Text PTC 替换，不再要求普通回答写成 TypeScript 字符串。

## 启动

需要 Node.js >=24、Linux、Python3 和 libseccomp。插件加载时实际检查文件与网络访问限制，条件不满足会明确失败，不回退为不受限的运行时。

```sh
npm ci
./run.sh
```

`run.mjs` 构建本包并通过原生 bundle 机制登记到 Web profile。支持 `--plugin <目录>` 登记额外本地插件。默认工作区是 `build/workspace`，配置和数据在 `build/.dsh`，可由 `DSH_HOME` 指定其他目录。

Web Agent Mode 中新增 **Text PTC**（`text-ptc`），bundle 将其设为默认选择。已有用户层配置优先于 bundle；本次已将当前本地 Web profile 的默认与 selectedDefault 一并改为 `text-ptc`。无需执行时模型直接回答，需要执行时输出位于末尾的一个执行块。

## 执行协议

````text
```ts:exec
const profiles = await tools.profiles({});
console.log("Current Profile: %s", profiles.current);
globalThis.lastProfile = profiles.current;
return profiles;
```
````

也接受 `js:exec`。代码由宿主编译为严格模式 async 函数体，支持顶层 await 和显式 return。每次函数的普通变量/函数/类声明都是局部的；只有显式写入 globalThis 的状态在同一存活会话进程内保留。dsh 重启、取消、超时或运行时重建会丢失状态，下一次请求会提示重置。不会为恢复状态重放工具。

输出使用 Node 原生 Console 的 log/info/warn/error/dir/table/time 等方法，结果和日志作为 exec 结果回到模型。没有 vm.print。`await vm.restart()` 清空当前运行时；它会终止本次执行并让下一步获得重置提示，不支持旧的变量保留参数。

不确定成员时，在未闭合执行块内的光标位置写 `<|INTELLISENSE|>` 并立即结束输出，系统补充信息后续写剩余代码。详细签名使用 TypeScript namespace 与 Doxygen 注释。兼容 `<|LINEBREAK|>`、`<|BREAK|>` 及带审计注释的形式；注释不进入执行代码。非 stop 结束、不完整围栏修复失败或补全循环超限都不会执行缓冲源码。

## 命名空间与 Profile

登录后打开 **插件 → dsh-ts-intellisense → 配置**，或访问 `/api/ts-intellisense`。可创建、切换、重命名和保存 Profile，编辑命名空间、映射、别名、注释与排序。每会话持有独立配置引用，更新目录不会覆盖其他存活会话。

未挂载物理工具的默认调用路径为 `tools.<encoded-name>`，不再暴露 unknown。路径中的非标识符字符以 `$十六进制码点$` 编码。维护命令固定在 tools 命名空间：

- `tools.mount`、`tools.unmount`：修改当前会话工具路径。
- `tools.comment`、`tools.fix`：修改注释和提示可见性；fix 也支持内置命令。
- `tools.profiles`、`tools.loadprofile`、`tools.commit`：查询、加载和保存 Profile。

`presets/text_ptc/aliases.yml` 提供额外别名，例如将实际存在的 `read_file` 暴露为 `std.fs.read`。别名仅映射工具 ID 和参数字段，不重复实现工具逻辑。参数校验、权限判断和工具派发都在宿主进行，并经过 DSH 原生 pre-execute/guard/execute/post-execute；子调用记录父 exec 身份。

UI 固定显示 console、tools、vm 内置树，名称、描述和 tooltip 使用英文。内置命令不能改名、拖动或删除，但固定提示图钉可以自由切换，并按 Profile 保存。默认仅提示插件自定义命令，Node.js 标准 console 接口默认不固定提示；取消提示不会移除可调用接口。普通 UI 控件仍支持中英文。命名空间、命令及用户注释保留原文；原生 VM/第三方错误直接反馈，不进行语言过滤或强制翻译。

树上方显示当前草稿中未挂载的可用工具数量，点击可以选择挂载。计数随挂载、移除映射和切换 Profile 更新；失效工具和内置管理工具不计入。失效映射保留，显示为不可用，但不进入实际执行清单。整理提案继续通过管理页面生成并明确批准后提交。

## 配置与日志

插件选项使用 zod 验证，包括 timeoutMs（默认 120000）、syncTimeoutMs、maxOutputBytes、maxMessageBytes、maxPendingCalls、heapMb、python、sandboxProbeTimeoutMs、diagnosticChars、aliasesFile，以及 protocol 内的 marker、maxSegments、repeatLimit、maxInfoChars、contextChars、maxBufferedChars 和 malformedPolicy。

每个会话使用单独进程。worker bundle 经关闭后不再使用的 stdin 完成启动，随后运行时控制、补全和工具 RPC 使用严格校验的 IPC；console 不写入 Agent 的 stdout 协议通道。Node 不授予文件、子进程、worker 或 addon 权限，seccomp 禁止创建和连接网络套接字。这些约束已在当前环境验证，不代表已证明覆盖所有 Node/V8 漏洞。

原生 session 日志保存 exec/context（实际动态提示全文）、exec/intellisense（补全原文与注入数据）、exec/rewrite（原始生成段、提取代码和丢弃内容），以及标准 exec 与 PTC 子调用事件。取消/超时终止进程、拒绝未决请求并取消工具信号；卸载撤销 provider、工具、监听器与进程。

## 检查

```sh
npm run build
npm run typecheck
npm run lint
npm test
```

测试使用 fake adapter 和真实隔离进程，不调用真实模型。旧 REPL 实现、接口及专用测试已移除。旧历史保留设置不再提供，执行与续写预算统一由插件 Config 管理。Profile 中未挂载工具提示偏好字段为 `unmountedVisible`，不兼容旧状态字段。
