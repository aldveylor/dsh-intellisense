# 存档兼容

本目录集中定义存档读取时的兼容转换，不由节点构造、克隆、ProfileReference 或工具运行路径调用。调用方负责用当前 schema 与实际节点实现完成校验，保存转换后的数据成功后再发布状态。

configuration_upgrade.ts 管理全局目录 1→2→3→4 相邻版本升级，并对当前版本的 Profile 执行旧字段识别。旧平铺配置通过目录提供的验证及版本分配回调转为匿名目录；未知或未来版本拒绝自动升级。

profile_compatibility.ts 递归将 command 节点转为 function，并仅在 tools.profile 中将 delete 成员及 tools_profile_delete 绑定转为 remove/tools_profile_remove。保留其它字段；remove 已存在时优先使用其设置。目录与 SnapshotStore 的读取入口共用转换，分别保存完整目录或通过 JournalStore 写回历史记录，保留既有指针。

statistics.ts 规范化旧版本统计检查点，并在显式恢复时保留有效非负安全整数计数。Statistics 读取时执行当前 schema 和作用域身份校验，随后写回迁移结果。
