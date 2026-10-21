# 源码模型

入口 `index.ts` 按原生 Cordis 依赖装配 `ts-repl` 路由、注册表、维护服务和认证管理接口；释放时关闭会话进程。无需 DSH core 补丁。根目录 `cordis.patch.yml` 为发布包入口。`run.mjs` 自动构建并将插件路径改为本地构建产物的绝对路径，通过 DSH `runProfile` API 启动 Web，使用并注册 `build/workspace` 工作区，默认配置与数据位于其下的 `.dsh`（允许 `DSH_HOME` 覆盖）；`run.sh` 为 Node.js 入口包装。

## 数据与调用

`registry/registry.ts` 将物理工具 ID、语义路径/别名、启用、固定映射和统计分开保存。物理工具从实际 DSH runtime 读取，未配置工具只出现在 `unknown.<工具名>` 路径；非标识符字符（含 `$`）以 `$十六进制码点$` 转义，数字开头和保留名称添加 `$tool$` 前缀，避免名称碰撞。调用先验证映射启用状态和 JSON Schema，再交给 DSH execute；未配置工具同样可派发，执行授权完全交给原生 guard/策略判断，注册表不保存独立授权字段。配置事务串行化，持久化成功后提交内存状态，revision 防止旧页面覆盖更新。补全曝光与成功调用分别统计，使用频率和时间只在类型候选内排序。

`storage/store.ts` 定义 Store，生产使用 DSH JSON backend 的 `ts_intellisense` KV 单元、state 表；MemoryStore 和原子 FileStore 用于独立使用。保存注册表、会话数据检查点、续写日志、请求执行状态和物理工具派发日志。已完成请求返回缓存，未确定结果拒绝重试，不重放工具来恢复变量。

`dsh/adapter.ts` 通过受支持的 LlmAdapter 维护独立上游请求和续写历史，不修改 AgentLoop 冻结请求。`index.ts` 通过官方 `llm/stream` waterfall 和 `isAgentLoopRequest` 识别 TS 会话的主循环请求，即使 UI 模型选择将 provider 切至原生路由，也交给 REPL 控制器并保留选中的上游 provider/model；内部续写、标题/压缩请求和普通会话不经过该接管。每会话串行生成与执行。`physical()` 根据 agent 作用域读取实际 schema；每次执行前刷新 namespace 和声明。上游 tools 数组为空；最终向原生 loop 返回 VM 执行结果，不回显生成源码；完成请求缓存同样返回执行结果。工具 additionalContexts 仍经原生 agent.inject 注入。

## 编译与执行

`typescript/project.ts` 管理虚拟 TS 源文件、环境声明与标准库，使用官方 Language Service 做全段语法/语义检查，再用 transpileModule 编译，不使用 AST 解释器。普通段整体执行；含顶层 await 的段按语句生成执行单元。await 初始化值通过临时全局属性传递，随后以真实 const/let/var 声明建立 VM 顶层绑定；临时属性立即删除。记录各单元 source map。跨 await 单元的提升/TDZ 与完整模块存在差别；独立类型声明不跨段保留。

`typescript/completion.ts` 只分析不完整输入，不执行它。完整成员候选直接查询当前 VM 的 globalThis、词法绑定和对象属性，实际运行时成员决定可见名称；未执行源码内的局部符号仍通过 TS 分析。查询不调用 getter 或 Proxy trap。真实环境声明、会话推导类型和 TS language service 负责文档、签名和参数提示。全局补全优先当前 VM 绑定、工具根命名空间与 Promise，过滤关键字并注明截断，避免前 40 项标准库候选淹没实际环境。

`runtime/session.ts` 为每会话保留真实 vm.Context 与词法声明。没有变量代理或 del。JS const/let 重声明与 delete 规则保留；不暴露 `console` 或日志接口；声明结果不显示，最终有意义的表达式自动显示。执行 ID 与源码绑定，重复 ID 返回相同 Promise。检查点序列化可复制的值和类型元数据，不保存闭包或重放工具。

`runtime/isolated.ts` / `worker.ts` 把 VM 放入独立受权限限制的 Node 子进程，用 IPC 请求补全/执行/检查点，通过父进程桥调用原生工具。桥仅在执行期间工作，取消和超时终止进程并传播 abort。进程限制不等于完整系统安全沙箱，特别是未覆盖所有网络能力。

## 协议、维护与界面

`protocol/markers.ts` 在响应完全结束后识别末尾控制标记；`controller.ts` 要求模型自愿 stop 后发起下一次生成，保留前缀，追加 system 补全信息与 assistant 前缀，不伪造用户消息。单独的补全标记在空源码位置请求补全，续写仅追加 system 上下文，不构造空 assistant 前缀。完整无标记输入先经子进程纯编译校验，失败时携带已有补全上下文、拒绝源码和纯文本诊断，在续写上限内要求重写整段；校验阶段不记录执行状态、不产生副作用。运行时错误不自动重试。各轮补全信息累计保留，同一光标重复查询时携带已取得的 VM 上下文重置未执行缓冲并要求生成完整程序，避免无进展补全循环，只在通过校验后执行。原生工具调用或 DSML 包装响应会被拒绝并在续写次数上限内要求改用原始 TypeScript，保留此前未执行前缀，不展示或执行被拒绝的协议内容。`prompt.ts` 在每次请求展示当前 VM 会话绑定及其类型、可用根命名空间与原生 Promise；根据持久化成功调用统计补充常用/最近工具路径（含别名），按 agent 可见工具过滤。详细工具签名按需补全；提示明确补全用于构造待执行代码，补全后应完成真实调用并以最后一个表达式返回结果。

`dsh/organization.ts` 使用原生 spawn 子代理和结构化输出 schema。提前保留 childId 并安装执行 guard，仅允许结构化输出工具。提案先在内存快照验证，等待 UI 批准后以 revision 校验并事务提交；不能修改 DSH 原生执行策略。

`web/routes.ts` 使用原生 Connection fetch 注册认证路由。`ui.ts` 提供页面，`client.ts` 实现命名空间树、schema 检查、编辑、会话选择、组织提案与明确批准。使用 textContent 输出不可信元数据。状态修改同步更新注册表，下一次补全/执行刷新运行时声明和命名空间，提示词变更通过原生事件通知。
