# Profile 便携接口模型

Profile 是匿名命名空间快照接口，ProfileSnapshot 为同义类型。ProfileCollection 提供 list/get/create/getOrCreate/remove/edit，并持有无参数函数指针 createInitialProfile；默认函数直接返回 RootNamespace 及其内置子节点，替换函数可提供其它根实现。clone(data?) 按初始工厂声明的实际根及子节点原型复制或恢复数据，不会将自定义子节点退化为通用对象。

EditableNode、EditableNamespace、EditableCommand、EditableSnapshot 是普通节点实现。ProfileNode.type 为 string，具体类分别声明 namespace/command 等类型值。get(name) 返回 ProfileNode，set(name, node) 接收 ProfileNode；调用方检查 type 后再 as。create/getOrCreate 的参数为 (name, factory: () => T)，T extends ProfileNode，返回 T；create 先调用无参数工厂取得实例再通过 set 安装，getOrCreate 命中时不执行工厂。内置类位于 tools/profile_nodes/。permissions 继续提供给 agent 与前端；操作方法通过虚方法分派，由当前节点实际阻止非法变化。命名空间删除还须经过后代自身的删除检查。

apply 是根级基础操作：先检查补丁字段与合并后形状，再对独立快照递归分派操作，全部成功后才发布快照内容。save 对目标树调用节点 normalize，比较当前值与完整目标，生成递归 patch，再复用 apply；省略普通成员会删除，必需内置成员由其节点策略保留或修正。compare.ts 仅生成差异，不处理内置名称或权限。

profileConfiguration 和 validate_edit.ts 是转换兼容入口，均委托实际根和子节点 apply，不再自行遍历判断内置权限。configuration.ts 仅将节点树投影为持久化数据；providedRoot、nodeSettings 分别保存拥有的定义与权限/说明声明。默认 Profile 包含 tools，不再显式安装内置树。

NamespaceComponent 的 saveProfile/applyProfile 使用同一串行写事务。apply 读取基线、应用及持久化在锁内完成，避免增量更新丢失。事件只在持久化成功后发出，基础字段仅为 name、ISO 时间 time 和 string 类型 type，可用接口继承扩展描述。处理器只通知事件，不处理返回值；校验提示由 save/apply 工具处理；观察器异常发生在提交后，不回滚已保存配置。构造、修复、检查属于节点实现。目录保存不更新已有会话，显式 switch 后才应用。

ProfileSnapshot.resolve(path) 在当前快照中解析启用命令的物理名称，不执行工具或访问目录；祖先禁用时返回 undefined。Session.intellisense 中的 AgentSessionAddition 持有当前快照、会话调用次数提交接口及显式持久化快照的异步 save()，inspect 查询统计独立。
