# 存储

`store.ts` 定义异步 Store 接口，并提供内存、文件及 DSH JSON KV backend 实现。保存工具目录、具名 Profile 和会话工作快照，不保存可执行运行时或重放工具调用。

Store 提供 load/save/remove。DshStore 每次读取当前 KV 快照，不缓存首次加载结果；注册表仍由单实例持有内存状态，不支持多个写入者并发修改同一注册表。会话草稿按 profile_session_<hash> 覆盖保存，正常释放会话时删除，具名 Profile 保存在 registry 中。异常退出留下的草稿可在同 ID 会话重开时恢复；不再生成永久版本或引用记录，不兼容旧版存储键。

Store 可选 loadEntries(prefix) 枚举指定前缀的独立记录，供日志及检查点恢复使用；DshStore 从一次 KV 快照筛选，FileStore 仅读取已提交的 .json 文件，MemoryStore 返回深复制。统计存储要求该能力。Store 可选 loadMany 批量读取；DshStore 从同一次 KV 快照提取多个键，避免逐键读取整个单元。统计按会话拆分记录，日志由绑定对应前缀的 JournalStore 管理。

`version.ts` 统一定义存储模型版本（当前 2），用于 KV 单元、registry、会话草稿和 command_statistics；缺失记录版本按旧版本处理。KV 单元接受旧版本 1 的记录以保留有效内容；领域加载器在版本不同时逐项验证，丢弃失败部分，保存新版本后才发布内存状态。同版本保持严格校验，显式 load(true) 执行相同的局部恢复。统计恢复按会话、计数字段及计数项保留有效值；旧 sessions 快照仅在首次转换时聚合全局计数。加载和恢复与普通写入串行。

`saveable.ts` 定义通用 Saveable<T> 接口，仅包含 save(): T，用于模型导出独立纯数据。模型加载由各类 constructor(data?) 完成；Store 保留异步键值读写职责，仅保存模型 save() 的结果，不持久化实例原型或方法。Profile 配置、注册表/session snapshot 和编辑树均采用此约定。

`journal_store.ts` 的 JournalStore 为一段存储前缀绑定可恢复写日志，要求底层 Store 支持 loadEntries。commit 只接受该前缀内的互异目标记录；先深复制本批提交值并将其作为一条 `<prefix>_journal` 原子保存，再依次覆盖目标记录，全部成功后删除日志。日志保存的是变更记录的提交值，而非可重复执行的自增指令，因此恢复和失败重试均以幂等覆盖完成，不会重复增加计数。日志写入失败时不写目标记录；日志已落盘后的中断可通过 loadEntries 自动恢复。flush 重试当前实例保留的失败事务；后续 commit 先完成前批事务。正常完成后删除日志，不生成无限增长的日志历史。

JournalStore 负责日志格式、作用域校验、写入串行化及恢复，不依赖统计模型，也不负责统计的延时调度。每个存储前缀只能由一个 JournalStore 写入者持有；调用方应经该实例读取或先恢复，不得并发绕过它读取或写入所辖记录。逻辑事务的提交点为日志持久化成功，跨记录覆盖由恢复协议保证完成；底层仍只要求单记录原子覆盖。
