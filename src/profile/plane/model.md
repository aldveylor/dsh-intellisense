# Profile 扁平编辑状态

`profile.ts` 定义 PlaneProfile、PlaneProfileData、PlaneProfileState 和 PlaneProfileStateData，以及扁平路径使用的 Mapping、Namespace、PinLevel、CommandVisibility。PlaneProfile 保存 mappings、namespaces、order、固定等级、禁用项及编辑偏好；构造和 save 均分离嵌套数据。PlaneProfileState 补充全局版本、默认名称和非当前配置。

`to_plane_profile.ts` 提供 `toPlaneProfile(profile, current?, definitions?)`，接收匿名 ProfileSnapshot 或具名 ProfileData，输出独立 PlaneProfile。省略 current 时使用空编辑偏好，省略 definitions 时使用默认定义。转换保留当前 pinned、未挂载固定偏好及工具注释，递归节点投影为挂载路径、命名空间、顺序及节点设置，内置成员依据传入定义区分。匿名快照的目录名称由调用方发布时指定。

目录层与具名 Profile 服务统一调用此接口。反向树投影仍由 `../catalog/profile_tree.ts` 的 profileTree 处理，节点权限与行为继续属于原始 Profile 节点。根入口导出扁平类型和 toPlaneProfile。

editor.ts 定义 PlaneProfileEditor、PlaneProfileEdit 及内部 RegistryPlaneEditor 适配器。该接口统一挂在 toolsNamespace.editor，提供状态、配置、说明、提供方快照和修订检查后的编辑操作。物理工具由调用方提供，编辑器不拥有 IntelliSense 的工具目录、属性或统计；effective 投影不修改物理目录或缓存代际。
