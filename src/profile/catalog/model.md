# 全局 Profile 目录与引用

SemanticRegistry 管理全局当前目录、默认名称、编辑事务和物理工具目录。持久化 ProfileCatalogData 包含 version/revision/profile，profiles 为名称 → {pointer, root, brief?}；记录中的 Profile 无名。editor 独立保存不能从 Profile 树派生的顺序、未挂载工具固定偏好、工具简述与固定映射标记，不进入会话快照。

RegistryConfiguration/RegistryState 是管理界面使用的全局编辑适配器。profile_tree.ts 与 ../configuration.ts 在平铺编辑字段和原始 ProfileNode 数据间转换；没有会话 registry，也不通过可执行语义树中转。保存验证委托真实节点类，提交失败不发布状态。

每次 saveProfile/configure/replaceConfiguration 成功修改目标时分配新的全局递增指针，内容相同也更新。创建、选择默认值、重命名与删除在同一全局写锁中完成；重命名复用原版本，删除不删除旧快照。全局表只保存各名称当前版本，不归档未被会话引用的中间版本。

../snapshot_store.ts 的 SnapshotStore 负责 durable 递增编号与进入过会话的历史版本。ProfileReference 只有只读 pointer 与匿名数据，snapshot 返回独立值；修改该值不会影响版本内容。create 只分配版本号，use 在同一共享锁内检查旧快照、必要时写入、再执行会话引用持久化回调。

profiles.ts 的 ProfileSessions 只恢复或选择引用。会话存储仅包含 name/pointer；初始化或 load/switch 从全局当前指针选择版本，存在即复用、不存在才归档，最后发布该会话的只读引用。save() 不发布版本、不编辑内容。父子会话可共享同一个 ProfileReference，后续切换互不影响。

全局当前表与旧快照可使用不同 Store。默认插件单独打开 intellisense_profile_snapshots 单元，计数器与匿名旧快照通过 JournalStore 恢复。旧模型不做隐式兼容迁移；当前格式严格校验，显式恢复仅保留有效当前条目，归档内容不随全局恢复或目录删除改写。

ToolAdditions 是 ctx.intellisense 的独立工具元数据服务。全局目录消费同一对象以过滤 hidden、输出工具元数据；ToolsNamespace 接口不包含附加信息注册能力，固定工具身份来自默认 Profile 的实际保护节点。
