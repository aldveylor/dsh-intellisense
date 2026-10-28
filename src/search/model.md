# 命令搜索

`engine_registry.ts` 定义 SearchEngine、SearchSelection、SearchDocument 与 SearchEngineRegistry。引擎接收已选定范围的命令文档、关键词、目标字段及结果上限，返回按相关性排序的完整命令路径，允许异步实现。注册器拒绝重名，register 返回注销函数，setDefault 选择默认方法，selector 提供可用引擎与实际默认方法，subscribe 通知作用域刷新命令契约。配置的默认方法尚未注册或已卸载时暂用首个可用引擎，重新注册后恢复所选默认方法。

`search.ts` 提供准确包含匹配与可选 MiniSearch BM25 引擎。默认顺序为 bm25、accurate；缺少可选依赖时仅保留 accurate。BM25 使用 OR、模糊和前缀匹配，标识符按驼峰及分隔符切词，中文使用 Intl.Segmenter 分词。accurate 为不区分大小写的字符串包含匹配。所有引擎统一接收规范化小写关键词。

方法及目标字段的参数声明直接从选择器生成。多个引擎时 method 为注册方法枚举，default 使用当前注册器的默认值；仅一个引擎时无 method 参数。keywords 必填，max_results 默认 10，target 默认 all，namespace_path 默认空字符串。返回值始终是有效树中的唯一命令路径数组，按引擎结果顺序限制条数；未知路径会被过滤。空关键词或零结果上限返回空数组。

搜索索引来自调用者当前 Profile、当前作用域有效 manifest，排除失效和禁用路径，不影响原生执行权限。仅索引 name、description 和 parameters；parameters 使用配置后的命名参数 schema，description 使用当前简化描述（若配置）。target 仅接受 name、description、parameters 和 all，all 不搜索返回值。命名空间范围按点号边界限定，包含所有后代；支持 global. 前缀及尾点。

自定义插件通过现有 commandNamespaces 服务注册引擎，例如：

```ts
ctx.effect(() => ctx.commandNamespaces.searchEngines.register({
    name: 'custom',
    description: 'Custom command search',
    search: async ({ documents, keywords, fields, maxResults }) => {
        return documents.filter(document => fields.some(field =>
            keywords.some(keyword => document[field].toLowerCase().includes(keyword))))
            .slice(0, maxResults).map(document => document.id);
    },
}));
ctx.commandNamespaces.searchEngines.setDefault('custom');
```

主插件与独立 namespace 配置均允许 defaultSearchMethod，未指定时优先 bm25。SearchEngineRegistry 及公共类型从根入口和 namespace 入口导出。

空关键词和零上限在生成文档前返回；文档只投影选中的字段，未选择的字段为空字符串。分词器在模块内复用，每个注册器的 BM25 引擎按字段和文档内容比较复用索引，避免完整 JSON 序列化缓存键；最多缓存 8 个最近使用的索引，缓存文档的路径及选中字段合计最多 2,000,000 个 UTF-16 码元，超大集合只执行查询而不缓存。此预算限制输入文本，不是索引实际堆内存上限。缓存保存独立文档快照，作用域、路径、字段或文档变化时不能误用已有索引，不缓存查询结果。
