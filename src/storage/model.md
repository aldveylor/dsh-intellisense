# 存储

Store 定义 load/save/remove，可选 loadMany/loadEntries。MemoryStore、FileStore、DshStore 均提供独立数据读取；FileStore 原子重命名文件，DshStore 使用 DSH JSON KV 单元。需要恢复历史记录的 SnapshotStore/JournalStore 要求 loadEntries。

默认插件打开两个独立单元：ts_intellisense（当前 schema 4）保存全局当前 Profile 表、编辑偏好、会话引用和统计；intellisense_profile_snapshots（schema 2）保存 profile_snapshot_sequence 及 profile_snapshot_<pointer>。快照 schema 与节点格式同步升级，旧 command 节点存档不再被读取。旧快照值只含匿名 root/brief，不含目录名称。

每次全局 save/apply 分配递增指针，当前 Profile 数据保存在全局表。只有版本进入会话时才归档到旧快照表。会话记录 profile_session_<hash> 仅保存 name/pointer，恢复时读取对应历史版本，不覆盖全局当前表。切换时先归档再提交会话引用，同一共享锁绑定存在性检查、首次写入和引用发布。未被会话使用的中间全局版本不归档；已有旧快照不随会话释放、目录删除或默认值变化移除。

JournalStore 在受管前缀内保存 after-image 日志，串行执行、重试和恢复，幂等重放不会重复增加计数。SnapshotStore 用它持久化编号和首次归档；关闭单独快照单元前 flush。统计依旧独立延迟合并，并在普通单元关闭前刷新。

全局 Profile 旧格式不做隐式兼容转换。当前格式严格校验，显式恢复可以丢弃无效的当前目录项，不改写既有匿名历史版本。Saveable<T> 只定义模型的独立数据导出，不保存运行时对象、工具函数或实例原型。
