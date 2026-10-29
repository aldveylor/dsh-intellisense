# 统计模型

Statistics 是通用具名计数集合，increment(scope, names) 按出现次数更新目标作用域与全局聚合，scope(name) 提供绑定作用域的 Counter（increment/snapshot）。它不理解命令、调用、查询、工具或路径；这些含义由持有者及存储前缀决定。快照是独立副本，根路径、__proto__ 等名称均作为普通键处理；计数溢出时整批拒绝。

CommandStatistics 分别持有 calls、queries 两个 Statistics，按物理工具名计数，作用域为会话 ID。调用在派发前计入（含失败），inspect 精确命令查询计入工具查询，别名共享同一工具名计数。AgentSessionAddition.statistics 为 calls 的当前会话 Counter。

ProfileSessions 持有独立 inspectStatistics，inspect 工具按当前 Profile 名称和有效查询路径递增；同一 Profile 跨会话聚合，不同 Profile 的相同路径互不混合。该集合包含命名空间与精确命令路径，成员查询不展开子成员。管理 GET 只读取所选 Profile 的路径快照。

每个 Statistics 通过独立 JournalStore 前缀保存全局及作用域记录，30 秒合并脏记录，只保存触及的作用域；存储失败保留脏状态供重试，关闭时刷新。加载失败保留内存，显式恢复只保留有效计数；不兼容旧的混合 command_statistics 格式。namespace 只在插件入口组装统计依赖，不实现或转导出统计。
