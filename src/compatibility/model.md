# DSH 兼容层

compatibility.ts 提供统一的 DshCompatibility 接口。version.ts 读取本插件实际解析到的 @deepseek-ai/dsh-tools/package.json 版本，封装字符串创建的 `Version` 类并导出 `version` 实例，不导出原始版本字符串或接口代际。`gte/gt/lte/lt/eq/neq(version, callback)` 直接按 SemVer 比较，匹配时执行回调并返回其结果，否则返回 undefined；回调异常直接传播，异步返回值保留。通用 Version 类只校验版本格式，最低宿主版本限制在宿主实例初始化时检查。不依赖全局 CLI、环境变量或接口是否存在。

0.2.1-rc.2 是最低支持版本；0.2.2-alpha.2 是执行器接口分界。分界之前动态加载 legacy.ts，分界起动态加载 executor.ts。无效版本或低于最低版本时显式失败；被选择适配器的加载错误直接暴露，不回退到另一套接口。业务层不直接导入版本专有模块。

legacy.ts 从 dsh-tools 获取 jsonSchemaToTs 和 CodeRunFailedError，在 presentation 作用域调用 presentAs('native')，通过提示词 assembly.tools 选择工具，单次调用交给旧版 tools.execute。configureTools 返回空撤销函数，不安装新版执行器。

executor.ts 从 dsh-tool-executor-ptc 获取声明生成及程序错误类型，在会话作用域安装 NativeToolExecutor，通过 describe 选择工具；单次子调用经 ToolExecutionPipeline 的 prepare/dispatch/complete，模型调用则适配 tools.execute 的批次输入与结果。新版提示词 waterfall 不修改工具声明。

兼容层只转换宿主 API。命名空间业务继续负责名称选择、子调用身份、审计事件、统计、附加上下文和结束回合标志，执行器撤销由会话 release 持有。

peerDependencies 使用单个 >= 最低版本声明：共享 DSH 包最低为 0.2.1-rc.2，两个执行器包最低为 0.2.2-alpha.2 且为可选 peer；开发依赖使用 >=0.2.2-alpha.2，显式提供相同版本的核心包，避免 pnpm 自动安装 peer 时混合两代接口。npm 对不同版本元组的预发布版本有独立的范围匹配规则，运行时版本比较直接使用 SemVer gte。

node scripts/compatibility/verify.mjs 构建同一份源码，在当前开发依赖环境和 build/compatibility/legacy 下独立安装的 0.2.1-rc.2 环境运行核心回归。旧版检查禁止加载新版专有执行器与 pipeline，并检查编译后的主入口可以直接导入。依赖副本、构建副本和日志均位于 build/，不记录到 git。
