# 内置 Profile 节点

RootNamespace 继承 EditableSnapshot，是默认 Profile 工厂直接生成的匿名根。根在构造阶段安装并保护 ImplToolsNamespace；tools 下的 profile 为 ImplToolsProfileNamespace，inspect 为 ImplToolsInspectCommand，其余权限一致的管理、搜索和值工具复用 ImplToolsCommand。ImplBuiltinNamespace 复用封闭成员及固定说明策略。

具体节点类同时提供 permissions 声明和操作实现。set/remove/setTool/setDescription/setFixedLevel 等由节点自身检查；根的 apply 将补丁沿真实子节点分派，失败不改变原快照。save 对完整目标树进行比较修正，再用同一 apply 执行差异；普通省略成员生成删除，必需的内置节点、物理身份、说明及固定等级由对应节点 normalize 修正。

RootNamespace 默认构造始终包含 tools，读取已存数据通过 clone 保持实际类型。tools.save 的缺省禁用规则在 ImplToolsNamespace.normalize 中实现；apply 不使用 save 的缺省规则。保存 effect 仅通知保存事件，不处理返回值，不承担构造、修复或权限检查。

保存校验与建议由 tools/profile_save.ts 处理，不属于 Profile 节点或保存事件的返回协议。保存事件在成功持久化后发出，仅有 name/time/type；effect 返回值被忽略，校验消息由 tools_profile_save/tools_profile_apply 处理，事件本身不含可编辑快照、基线、agent 或 result。

ImplToolsCommand 同时提供 discovery/presentation/readValue/refresh，分别处理发现标记、模式契约、预加载与刷新策略；这些行为不再通过 ToolAddition 注册。会话引用不可修改，apply/save 操作发生在全局编辑副本上，成功后只推进目标全局名称的版本号。
