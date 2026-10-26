# 组件显示元数据

各子目录的 en.json 与 zh.json 分别提供宿主读取的英文、中文 meta.title 与 meta.description；中文译本保留组件名称并翻译功能描述。主包与 client 共用 plugin 元数据，显示名称为 Intellisense；preset 显示名称为 Intellisense/Preset。namespace、presentation 分别声明不带 npm scope 的组件显示名称。package.json 将这些源文件纳入发布清单，并通过各组件的 /locale/en.json 与 /locale/zh.json 导出。组件 ID、模块 ID、加载路径及配置页注册键不由显示名称决定。
