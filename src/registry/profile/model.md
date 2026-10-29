# Profile 便携接口模型

Profile 是匿名命名空间 snapshot 的 interface，ProfileSnapshot 是同义类型；不包含目录名称、root getter 或 commit。ProfileCollection 是具名集合 interface，提供 get/create/getOrCreate/edit。create 原子创建空 Profile，get 返回独立 snapshot，直接编辑查询副本不影响目录；edit(name, modifier) 读取最新副本，校验并原子保存回调返回的 snapshot。回调失败、无效节点或存储失败不发布修改，同名编辑按顺序执行。目录名称由集合持有，会话目标使用独立工作配置。

ProfileNode 是共享 interface；ProfileNamespace 和 ProfileCommand 继承该接口。EditableNode 是实现基类，EditableNamespace、EditableCommand、EditableSnapshot 为实现 class，主入口只导出便携 interface/type。所有公开集合方法和子节点操作返回接口；调用方无需引用实现类或构造器。

命名空间持有直接子对象 Map，get/create/getOrCreate/remove 只接收直接成员名，不接受扁平路径。create/getOrCreate 默认创建命名空间，kind: command 创建命令；setTool 绑定物理工具。setPermissions 合并显式覆盖，未指定字段保留已有设置或类型默认值。setBrief 编辑 snapshot 的用途说明。

node_settings.ts 将权限与插件覆盖说明按直接 children 递归保存；providedRoot 只保存显式提交的插件节点树，空树不自动补入内置命令。configuration.ts 是受信编辑投影，允许固定工具挂载和显式权限设置；validate_edit.ts 为人工、agent 及管理 HTTP 写入校验原始服务端权限。运行时树在安装已有成员后应用权限，acceptsChildren=false 不阻止加载已有子节点。
