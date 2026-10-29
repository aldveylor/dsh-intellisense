# Profile 编辑模型

Profile 为插件侧接口，持有匿名 ProfileNamespace 根节点及显式 save 方法。句柄是独立编辑副本，serialize 输出递归 ProfileData；保存失败不发布修改。

ProfileNode 是共享接口；ProfileNamespace 和 ProfileCommand 继承该接口。EditableNode 是实现基类，EditableNamespace 和 EditableCommand 继承该类并实现对应接口。所有公开方法返回接口，调用方不依赖实现类或构造器。命名空间使用直接子对象 Map，通过 get/create/getOrCreate/remove 操作单个成员名，不接收扁平路径。命令通过 setTool 绑定物理工具。setPermissions 合并显式覆盖，未指定字段继续使用已有设置或类型默认值。插件侧编辑允许设置权限，人工与 agent 的 Profile 写入继续接受服务端权限校验。
