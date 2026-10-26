# 存储

`store.ts` 定义异步 Store 接口，并提供内存、文件及 DSH JSON KV backend 实现。保存工具目录、具名 Profile 和会话工作快照，不保存可执行运行时或重放工具调用。

Store 提供 load/save/remove。DshStore 每次读取当前 KV 快照，不缓存首次加载结果；注册表仍由单实例持有内存状态，不支持多个写入者并发修改同一注册表。会话草稿按 profile_session_<hash> 覆盖保存，正常释放会话时删除，具名 Profile 保存在 registry 中。异常退出留下的草稿可在同 ID 会话重开时恢复；不再生成永久版本或引用记录，不兼容旧版存储键。

Store 可选 loadMany 批量读取；DshStore 从同一次 KV 快照提取多个键，供统计初始化使用，避免逐会话读取整个单元。

全局 registry 记录独立配置版本（当前 1，无字段为 0）；版本变化时由 SemanticRegistry 保留可加载部分并重新保存，存储层不迁移会话记录。
