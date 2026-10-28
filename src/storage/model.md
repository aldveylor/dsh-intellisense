# 存储

`store.ts` 定义异步 Store 接口，并提供内存、文件及 DSH JSON KV backend 实现。保存工具目录、具名 Profile 和会话工作快照，不保存可执行运行时或重放工具调用。

Store 提供 load/save/remove。DshStore 每次读取当前 KV 快照，不缓存首次加载结果；注册表仍由单实例持有内存状态，不支持多个写入者并发修改同一注册表。会话草稿按 profile_session_<hash> 覆盖保存，正常释放会话时删除，具名 Profile 保存在 registry 中。异常退出留下的草稿可在同 ID 会话重开时恢复；不再生成永久版本或引用记录，不兼容旧版存储键。

Store 可选 loadMany 批量读取；DshStore 从同一次 KV 快照提取多个键，避免逐键读取整个单元。统计在 command_statistics 单条记录中保存会话计数和物理工具查询计数，通过单次 save 保持一致。

全局 registry 记录独立配置版本（当前 1，无字段为 0）；版本变化时由 SemanticRegistry 保留可加载部分并重新保存，存储层不迁移会话记录。

`saveable.ts` 定义通用 Saveable<T> 接口，仅包含 save(): T，用于模型导出独立纯数据。模型加载由各类 constructor(data?) 完成；Store 保留异步键值读写职责，仅保存模型 save() 的结果，不持久化实例原型或方法。Profile 配置、注册表/session snapshot 和编辑树均采用此约定。
