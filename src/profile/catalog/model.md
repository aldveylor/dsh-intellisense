# 全局 Profile 目录与引用

SemanticRegistry 管理全局当前目录、默认名称、编辑事务和物理工具目录。持久化 ProfileCatalogData 包含 version/revision/profile，profiles 为名称 → {pointer, root, brief?}；记录中的 Profile 无名。editor 独立保存不能从 Profile 树派生的顺序、未挂载工具固定偏好、工具简述与固定映射标记，不进入会话快照。

../plane/profile.ts 的 PlaneProfile/PlaneProfileState 是管理界面使用的全局编辑适配器。profile_tree.ts 与 ../plane/to_plane_profile.ts 在平铺编辑字段和原始 ProfileNode 数据间转换；没有会话 registry，也不通过可执行语义树中转。保存验证委托真实节点类，提交失败不发布状态。

每次 saveProfile/configure/replaceConfiguration 成功修改目标时分配新的全局递增指针，内容相同也更新。创建、选择默认值、重命名与删除在同一全局写锁中完成；重命名复用原版本，删除不删除旧快照。全局表只保存各名称当前版本，不归档未被会话引用的中间版本。

../snapshot_store.ts 的 SnapshotStore 负责 durable 递增编号与进入过会话的历史版本。ProfileReference 只有只读 pointer 与匿名数据，snapshot 返回独立值；修改该值不会影响版本内容。create 只分配版本号，use 在同一共享锁内检查旧快照、必要时写入、再执行会话引用持久化回调。

profiles.ts 的 ProfileSessions 仅依赖 ToolsNamespace 的 selection/reference/restore/retain 恢复或选择引用，不读取具体目录实现。会话存储仅包含 name/pointer；初始化或 load/switch 从全局当前指针选择版本，存在即复用、不存在才归档，最后发布该会话的只读引用。save() 不发布版本、不编辑内容。父子会话可共享同一个 ProfileReference，后续切换互不影响。

全局当前表与旧快照可使用不同 Store。默认插件单独打开 intellisense_profile_snapshots 单元，计数器与匿名旧快照通过 JournalStore 恢复。storage/compatibility/profile_compatibility.ts 转换旧 command/command 节点及 tools.profile.delete 成员名称与物理绑定，保留其他字段供当前 schema 严格校验。storage/compatibility/configuration_upgrade.ts 定义 1→2→3→4 相邻版本升级表：先规范化旧平铺字段，再通过目录的验证和版本分配回调生成匿名目录，最后转换节点格式；完整升级成功后才持久化最终版本；当前 schema 也在读取时识别旧成员并写回。历史快照在读取时经 JournalStore 保存转换结果，不改变版本指针。节点构造、克隆及 ProfileReference 不处理旧格式。未知及未来版本拒绝升级；当前格式严格校验，显式恢复仅保留有效当前条目，归档内容不随全局恢复或目录删除改写。

ToolAdditions 是 ctx.intellisense 的独立工具元数据服务。全局目录消费同一对象以过滤 hidden、输出工具元数据；ToolsNamespace 接口不包含附加信息注册能力，固定工具身份来自默认 Profile 的实际保护节点。

具名集合编辑和 Agent save/apply 共用目录的 profileTransaction 串行事务，事务状态不属于 NamespaceComponent；集成层显式注入目录，ToolsNamespace 无需暴露 registry 或事务方法。保存事件在事务完成后通知，观察者可再次发起集合编辑。

管理路由仅消费 toolsNamespace.editor，RegistryPlaneEditor 在此实现后端适配，保持修订检查和共享写事务。SemanticRegistry 不再由工具执行或管理路由直接消费；真实物理目录归独立 PhysicalToolCatalog，平面校验只消费传入的物理元数据。

node_settings_schema.ts 定义目录写入时的递归权限配置校验；../node_settings.ts 仅提供共享数据类型及查询函数，不初始化 Zod schema，避免浏览器权限查询连带加载服务端校验。

显式修复通过 `recover_profile.ts` 按当前具体节点权限递归恢复，丢弃未知内置成员与非法键，保留可加载的同级节点。损坏的编辑偏好不阻塞有效 Profile；修复后与原值不同的当前 Profile 分配新指针，避免覆盖既有版本身份。完全重置清空主单元及快照单元的全部记录后创建默认目录。

配置保存的 order 保留服务端内置命名空间及命令的有效路径，支持受限节点同级排序并在重新加载后恢复；未知路径仍被过滤。
