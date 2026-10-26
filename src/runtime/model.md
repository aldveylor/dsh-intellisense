# 进程运行时模型

`host.ts` 提供插件自有的 `codeRuntime` 服务实现 `RuntimeHost`。每个 session 独立进程、串行执行；同一进程复用 node:vm Context，每次 init 刷新命令与预加载值，不保证环境连续；不提供 vm 命名空间及重启命令。运行时状态只驻留内存，不从会话日志重放副作用或恢复闭包。每次调用由宿主 TypeScript transpileModule 编译为新的严格 async 函数体，支持 await 与显式 return；函数内普通声明不跨调用保留，允许通过 globalThis 挂载变量、对象和闭包以在同一对话的多次调用间共享状态；不同对话相互隔离，VM 重启后状态丢失，不保证连续。

`protocol.ts` 定义共享 zod 消息 schema。执行/RPC ID 带品牌；每条 IPC 消息验证类型、字段及传输大小。宿主只接受当前父执行所属的调用；结果和参数为 JSON 数据，不传递宿主对象。

`worker.ts` 在空 node:vm Context 内安装冻结、null 原型的命名空间，以及 VM realm 的函数包装。宿主 RPC/console 回调只由闭包持有，不作为 guest 属性暴露；工具返回值序列化后在 VM realm 解码，拒绝变成 VM 内的 rejected Promise。console 包装使用 Node 原生 Console 格式化，输出写入内存 Writable，随后通过 IPC 结果帧归入当前执行；不占用宿主 stdin/stdout/stderr。stdin 仅一次性传入 worker 启动源码，stderr 仅收集进程诊断。没有额外输出命令。describe 仅读 own data descriptor，跳过 Proxy/accessor，不执行 getter；默认全局目录过滤标准 ECMAScript/Node.js 名称。

`host.ts` 直接通过 process.execPath 启动带 --permission 的 Node 进程。Node 未授予文件读写、子进程、worker、addon、WASI、inspector 等权限。启动脚本由宿主构建为 bundle，经 stdin 一次性送入并关闭 stdin，之后控制与工具交互只有 IPC。没有为加载源码开放 dist/node_modules 文件读取权限。`sandbox.ts` 启动时检查权限未授权，并实际验证文件读取及子进程创建被 ERR_ACCESS_DENIED 拒绝；缺少能力时加载失败，无宽松回退。隔离范围由当前 Node 权限模型决定；Node 24 的 --permission 不限制网络，不再提供系统调用级网络或 ptrace 封锁。guest 仍不暴露 process、require、fetch 或模块导入能力。这不是已证明覆盖所有 Node/V8 漏洞的安全性结论。

执行超时、取消、进程退出或 release 都终止进程，拒绝未决请求并取消宿主工具信号。重建 epoch 增加，后续运行获得新的进程状态。dispose 等待工具回调和进程退出。可调预算全部由 RuntimeConfig 验证；默认 wall timeout 为 120000ms，与安装的原生 Node PTC 后端默认一致，另有可调同步 VM deadline。

程序返回值先按标准 JSON.stringify 语义序列化，再校验传输数据：对象中的 undefined 字段省略，数组中的 undefined 和空位转换为 null，顶层 undefined 仍表示无返回值；循环引用和 BigInt 等不可序列化返回值明确报告程序返回值序列化失败。工具命令的 void 返回契约不变。

程序返回或抛错后，worker 先等待已发出的 RPC 全部结算，再发送执行结果；等待期间仍受执行超时和取消控制。一个子调用失败不取消并发兄弟调用，正常收尾不终止进程；只有完整收尾后才释放本次执行的宿主调用信号。

宿主启动和结果受大小上限限制，过大数据明确拒绝；不静默截断工具返回值。日志捕获达到上限则执行报错。运行时原生错误信息直接回传，不做语言过滤或翻译。

`protocol.ts` 的 CommandBinding 定义初始化命令契约：命名空间路径、物理 tool 名称、参数适配器（字段、rest、重载或对象别名）与返回值适配器。worker 在 VM realm 内以 NamespaceCommand 类将这些契约编译为可调用函数，调用前直接生成底层命名参数对象；可选字段 undefined 被省略，显式 null 保留。IPC call 只发送物理 tool 与命名参数 args，不传命名空间路径或位置参数元组。返回值通过存在标志保留 undefined，VM 命令对象完成单字段解包或丢弃结果。

插件自有 tools_run_code 通过 namespace/runtime.ts 使用本运行时。命名空间在初始化时解析一次；宿主收到 IPC 后通过 NamespaceComponent.dispatchTool 直接调用 DSH 原生 tools.execute，保留父子审计和上下文。插件不逐次解析 manifest 或自行判定权限，权限及底层参数校验交给 DSH，不依赖全局 ptcRuntime。worker 内的 ToolCallError 属于 guest realm，包含失败命名空间路径 toolName。

init 消息携带 data-only values，VM realm 内解析并递归冻结，执行前预加载 tools.profile.annotation 与 tools.profile.commands；不传递宿主对象。每次运行刷新这些值，工具仍通过原生 PTC 闭包派发。

tools.profile.commands 中各项 totalCalls 使用 VM 内只读 getter，从预加载的全局计数起算。NamespaceCommand 包装在参数转换和序列化成功、发出调用后，按物理 tool ID 同步递增闭包内的计数；同一执行中多次读取同一行即可看到更新，别名共享计数，失败派发也计数，未发出调用的参数错误不计数。数组、行对象及其它预加载数据仍冻结；计数增量不额外发送 IPC 或写回宿主，宿主继续由 dispatchTool 独立计数和持久化。下一次执行从宿主最新全局统计重新初始化，不重复叠加 VM 增量。

`builtins.ts` 的 `PluginCommands` 持有插件命令契约表，通过共享实例 `pluginCommands` 提供物理命令查找、搜索签名、默认提示等级及运行时/UI 投影所需的命令分组。

`reservedToolIds` 统一列出 exec、run_code 与插件自有执行入口，供物理工具目录、manifest 和管理选择器过滤使用。

PTC 初始化先建立运行时环境（包括 console 输出对象），再安装生成的命令与预加载数据。每次初始化移除上次生成的命名空间根，再部署当前命令和值；生成的根属性可配置但不可赋值，子树冻结。部署只写入环境中不存在的根属性，不覆盖已有 console、标准对象或其它运行时全局。生成树内重复命令或命令/值冲突会明确拒绝，不以后写覆盖先写。environment 节点参与普通 IntelliSense 查询，但不进入物理工具绑定。

`tools.profile.profiles` 为 VM 内冻结的只读对象，通过 getter 提供目录名称列表与会话当前选择。宿主在成功工具回复中携带最新 profiles 数据；VM 在兑现调用 Promise 前更新闭包快照并冻结名称数组，保持对象引用稳定，不开放写入。
