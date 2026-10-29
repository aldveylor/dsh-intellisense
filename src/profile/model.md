# Profile 节点与版本引用

`service.ts` 定义 ToolsNamespace、ProfileSaveEvent 与 ProfileSaveEffect，`component.ts` 实现具名 Profile 服务；`ctx.toolsNamespace` 与 `ctx.intellisense.profiles` 使用此处的同一接口。`namespace/` 管理命名空间消费投影、声明、提示和运行时装配；`catalog/` 管理全局目录与会话引用；`plane/` 保存扁平编辑状态 PlaneProfile/PlaneProfileState 及 toPlaneProfile 转换接口。原 src/registry 与 src/namespace 已迁入本模块。

Profile 与 ProfileSnapshot 是同义匿名节点树接口。EditableNode、EditableNamespace、EditableCommand、EditableSnapshot 提供普通实现；默认 RootNamespace 与内置子节点位于 tools/profile_nodes/。create/getOrCreate 接受无参数工厂并返回实际对象，get/set 使用 ProfileNode，按 type 区分 namespace/command。clone 按工厂声明的原型恢复节点，不退化自定义类。

resolve(path) 返回快照内原始启用节点，支持 global. 前缀；空路径返回根，禁用节点或祖先使路径无效。查询不访问物理目录、执行工具或统计调用，未绑定的无关成员不影响解析。

apply 校验部分对象及合并结果，在独立编辑值上递归分派，全部成功后发布局部值。save 对完整目标调用各节点 normalize，计算差异再调用 apply。删除与替换由被操作节点自行检查，父命名空间删除还检查后代。permissions 只描述方法执行的规则，不替代具体类策略。

ProfileCommand 可通过具体类的 discovery、presentation、readValue、refresh 提供发现身份、命令契约及预加载行为。这些职责不再放入 ToolAddition。普通工具 schema 与隐藏/PTC 描述元数据只在扁平输出契约中补充，不生成另一套节点树。

SnapshotStore 为全局修改分配递增数值指针，当前具名版本保存在全局表。ProfileReference 保存不可变匿名内容，snapshot getter 返回独立的编辑副本；会话不能发布该副本。进入会话前才将对应版本归档到指针 → Profile 表，未使用的中间全局版本不归档。

AgentSessionAddition.profile 为只读 ProfileReference，name 为独立选择信息。switch 复用全局当前指针，在共享锁内执行存在性检查、首次归档与会话引用持久化；相同指针只归档一次，失败保留原会话引用。save/apply 工具始终修改全局目标，当前会话内容与指针不变。
