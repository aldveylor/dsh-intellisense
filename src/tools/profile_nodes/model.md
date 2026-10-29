# 内置 Profile 节点

RootNamespace 继承 EditableSnapshot，是默认 Profile 工厂直接生成的匿名根。根在构造阶段安装并保护 ImplToolsNamespace；tools 下的 profile 为 ImplToolsProfileNamespace，inspect 为 ImplToolsInspectCommand，其余权限一致的管理、搜索和值工具复用 ImplToolsCommand。ImplBuiltinNamespace 复用封闭成员及固定说明策略。

具体节点类同时提供 permissions 声明和操作实现。set/remove/setTool/setDescription/setFixedLevel 等由节点自身检查；根的 apply 将补丁沿真实子节点分派，失败不改变原快照。save 对完整目标树进行比较修正，再用同一 apply 执行差异；普通省略成员生成删除，必需的内置节点、物理身份、说明及固定等级由对应节点 normalize 修正。

RootNamespace 默认构造始终包含 tools，读取已存数据通过 clone 保持实际类型。tools.save 的缺省禁用规则在 ImplToolsNamespace.normalize 中实现；apply 不使用 save 的缺省规则。保存 effect 仅处理事件及返回信息，不承担构造、修复或权限检查。

保存建议由 RootNamespace.saveInformation 读取当前树生成，不再通过事件携带 Profile 或工具列表。保存事件在成功持久化后发出，仅有 name/time/type；effect 返回值可覆盖工具反馈，事件本身不含可编辑快照、基线、agent 或 result。
