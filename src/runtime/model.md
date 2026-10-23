# 进程运行时模型

`host.ts` 提供插件自有的 `codeRuntime` 服务实现 `RuntimeHost`。每个 session 独立进程、串行执行；运行时状态只驻留内存，不从会话日志重放副作用或恢复闭包。每次调用由宿主 TypeScript transpileModule 编译为新的严格 async 函数体，支持 await 与显式 return；函数内普通声明不跨调用保留，仅 globalThis 状态保留。

`protocol.ts` 定义共享 zod 消息 schema。执行/RPC ID 带品牌；每条 IPC 消息验证类型、字段及传输大小。宿主只接受当前父执行所属的调用；结果和参数为 JSON 数据，不传递宿主对象。

`worker.ts` 在空 node:vm Context 内安装冻结、null 原型的命名空间，以及 VM realm 的函数包装。宿主 RPC/console 回调只由闭包持有，不作为 guest 属性暴露；工具返回值序列化后在 VM realm 解码，拒绝变成 VM 内的 rejected Promise。console 包装使用 Node 原生 Console 格式化，输出归入当前执行结果。没有 vm.print。describe 仅读 own data descriptor，跳过 Proxy/accessor，不执行 getter；默认全局目录过滤标准 ECMAScript/Node.js 名称。

`sandbox.ts` 在 Linux/Python3/libseccomp 下启动 Node 权限进程。seccomp 在 exec Node 前禁止 socket 创建、连接、绑定、监听及 ptrace 等；不禁止继承的 IPC socket 使用 sendmsg/recvmsg。Node 未授予文件读写、子进程、worker、addon 等权限。启动脚本由宿主构建为 bundle，经 stdin 一次性送入并关闭 stdin，之后控制与工具交互只有 IPC。没有为加载源码开放 dist/node_modules 文件读取权限。启动检查实际测试文件读取被 Node permission 拒绝、网络监听被 seccomp 拒绝；缺少能力时加载失败，无宽松回退。这不是已证明覆盖所有 Node/V8 漏洞的安全性结论。

执行超时、取消、进程退出或 release 都终止进程，拒绝未决请求并取消宿主工具信号。重建 epoch 增加，后续运行获得新的进程状态。dispose 等待工具回调和进程退出。可调预算全部由 RuntimeConfig 验证；默认 wall timeout 为 120000ms，与安装的原生 Node PTC 后端默认一致，另有可调同步 VM deadline。

宿主启动和结果受大小上限限制，过大数据明确拒绝；不静默截断工具返回值。日志捕获达到上限则执行报错。运行时原生错误信息直接回传，不做语言过滤或翻译。

工具包装使用 ...args 位置参数，通过 [present, value] 元组跨 IPC 传递每个值，保留可选参数中的 undefined 与显式 null 的区别；返回值也保留 undefined。宿主将位置参数交给命名空间契约重封装为原生对象，单字段原生响应由命名空间层解包后返回 VM。

原生 run_code 通过 integration/namespace_runtime.ts 的 PtcRuntime seam 使用本运行时。工具调用闭包由原生 transport 提供，位置参数和返回值按 manifest 投影。worker 内的 ToolCallError 属于 guest realm，包含失败命名空间路径 toolName。
