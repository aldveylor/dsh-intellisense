# 组件显示元数据

`lang/en.json` 与 `lang/zh.json` 统一提供宿主读取的英文、中文 `meta.title` 与 `meta.description`，不再按组件类型拆分。主包、client、preset、namespace 与 presentation 共用显示名称 Intellisense 及插件整体功能描述；中文译本保留组件名称并翻译功能描述。

package.json 将这些源文件纳入发布清单，各入口的 `/locale/en.json` 与 `/locale/zh.json` 均导出同一语言文件。宿主通过完整组件路径解析这些导出，并在英文文件所在目录发现其它语言。组件 ID、模块 ID、加载路径及配置页注册键不由显示名称决定。
