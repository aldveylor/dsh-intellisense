# 存储

Store 定义 load/save/remove，可选 loadMany/loadEntries。MemoryStore、FileStore、DshStore 均提供独立数据读取；FileStore 原子重命名文件，DshStore 使用 DSH JSON KV 单元。需要恢复历史记录的 SnapshotStore/JournalStore 要求 loadEntries。

默认插件打开两个独立单元：ts_intellisense（当前 schema 4）保存全局当前 Profile 表、编辑偏好、会话引用和统计；intellisense_profile_snapshots（schema 2）保存 profile_snapshot_sequence 及 profile_snapshot_<pointer>。主单元兼容 schema 3，快照单元兼容 schema 1；旧 command 节点递归转换为 function 节点，保留工具、文档、权限及原始指针。快照转换经 JournalStore 持久化，保留既有会话引用。旧快照值只含匿名 root/brief，不含目录名称。

每次全局 save/apply 分配递增指针，当前 Profile 数据保存在全局表。只有版本进入会话时才归档到旧快照表。会话记录 profile_session_<hash> 仅保存 name/pointer，恢复时读取对应历史版本，不覆盖全局当前表。切换时先归档再提交会话引用，同一共享锁绑定存在性检查、首次写入和引用发布。未被会话使用的中间全局版本不归档；已有旧快照不随会话释放、目录删除或默认值变化移除。

JournalStore 在受管前缀内保存 after-image 日志，串行执行、重试和恢复，幂等重放不会重复增加计数。SnapshotStore 用它持久化编号和首次归档；关闭单独快照单元前 flush。统计依旧独立延迟合并，并在普通单元关闭前刷新。

全局 Profile 按 configuration_upgrade.ts 的相邻版本升级表读取：1→2 将 boolean 可见性、列表固定偏好及 enabled 转为当前字段；2→3 将当前及非当前平铺 Profile 转为带数值指针的匿名目录并分离 editor；3→4 递归转换旧 command 节点。仅在完整转换和校验成功后保存最终 schema 4，保留 revision、默认名称、所有 Profile 及编辑偏好；转换或写入失败不发布新目录状态。未知或未来版本拒绝自动升级。当前格式严格校验，显式恢复可以丢弃无效的当前目录项，不改写既有匿名历史版本。Saveable<T> 只定义模型的独立数据导出，不保存运行时对象、工具函数或实例原型。
