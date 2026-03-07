---
name: csv-data-analysis
description: This skill should be used when users need to analyze CSV files, understand data patterns, generate statistical summaries, or create data visualizations. Trigger keywords include "分析CSV", "数据分析", "CSV分析", "数据统计", "生成图表", "数据可视化".
---

# 智能 CSV 数据深度分析工具

CSV数据分析工具是一个基于 AI 与前端可视化技术（ECharts + Tailwind CSS）的深度自动化数据探索工具。它能够快速提取统计特征、分类信息、相关性以及时序趋势，并由大模型注入深度业务洞察，生成高度美观和可交互的网页分析报告。

## 核心工作流（LLM 必读）

作为 AI 助手，在用户上传 CSV 并要求分析时，你需要严格按照以下两步执行：

### 第一步：提取数据特征 (执行脚本)

使用 `execute_skill_script_file` 工具运行 `csv_analyzer.py`，将 CSV 文件路径传入。

**工具调用参数示例：**
```json
{
  "skill_name": "csv-data-analysis",
  "script_file_name": "csv_analyzer.py",
  "args": {"input_file": "/path/to/data.csv"}
}
```

**脚本返回说明：**
脚本会返回一大段 `text` 内容，其中包含两个部分：
1. **【统计摘要】**：供你阅读并理解数据集的基本情况、分布、相关性和分类构成。
2. **【CHART_DATA_JSON】**：位于 `###CHART_DATA_JSON_START###` 和 `###CHART_DATA_JSON_END###` 之间的纯 JSON 字符串。这是用于渲染交互式图表的原生数据。

### 第二步：生成洞察与展示报告 (注入模板)

阅读第一步获得的"统计摘要"，思考数据背后的业务意义或规律。然后使用 `html_interpreter` 工具，加载模板并注入数据。

**关键规则（必须遵守）：**

1. **必须设置 `template_path`** 为 `csv-data-analysis/templates/report_template.html`。模板中已内置完整的 ECharts 渲染 JavaScript 代码和所有章节标题、页脚文本，你只需要通过 `data` 参数填充 9 个内容占位符即可。**绝对不要自己编写或修改任何 JavaScript 图表渲染代码。**

2. **`CHART_DATA_JSON`** 必须**完整且原封不动**地复制自脚本输出中 `###CHART_DATA_JSON_START###` 和 `###CHART_DATA_JSON_END###` 之间的纯 JSON 字符串。不要自行编造，不需要做任何转义处理。

3. **`*_INSIGHTS`、`EXEC_SUMMARY` 和 `CONCLUSIONS`** 必须使用 HTML 格式（如 `<p>`, `<ul>`, `<li>`, `<strong>`, `<ol>`）来确保排版美观。这些内容由你基于统计摘要撰写深度业务洞察。

4. **输出语言必须与用户输入语言一致。**

5. **只传 9 个占位符，不要多也不要少。** 模板已将所有章节标题（Distribution Analysis、Correlation Analysis 等）、洞察框标题（Insights）和页脚文本硬编码在 HTML 中，你无需传递这些。

**`html_interpreter` 调用示例：**
```json
{
  "template_path": "csv-data-analysis/templates/report_template.html",
  "data": {
    "REPORT_TITLE": "销售数据集深度分析报告",
    "REPORT_SUBTITLE": "多维度数据特征与业务洞见挖掘",
    "EXEC_SUMMARY": "<p>本数据集共包含 1000 行 5 列，数据完整性良好。核心洞察如下：</p><ul><li><strong>受众分布：</strong>主要集中在 25-35 岁群体...</li></ul>",
    "DISTRIBUTION_INSIGHTS": "<p>从数值分布图可以看出，指标 A 呈现出明显的右偏态分布，建议...</p>",
    "CORRELATION_INSIGHTS": "<p>变量间的热力图揭示了强烈的正相关关系，特别是...，这意味着...</p>",
    "CATEGORICAL_INSIGHTS": "<p>分类占比显示，'城市'字段中北京与上海占据了 50% 以上的份额。</p>",
    "TIME_SERIES_INSIGHTS": "<p>从时序趋势中可以看出，数据在年末存在显著的季节性拉升现象。</p>",
    "CONCLUSIONS": "<p>综合以上多维度分析，数据呈现出明确的结构性特征与规律。</p><h3>建议</h3><ul><li>建议定期检查缺失值比例...</li><li>重点关注高增长细分市场...</li></ul>",
    "CHART_DATA_JSON": "此处粘贴脚本输出中 ###CHART_DATA_JSON_START### 到 ###CHART_DATA_JSON_END### 之间的完整 JSON 字符串"
  }
}
```

> **严禁事项：**
> - 禁止在 `data` 中添加任何 JavaScript 代码
> - 禁止省略 `template_path` 参数（不设置 template_path 会导致图表无法渲染！）
> - 禁止对 `CHART_DATA_JSON` 做任何修改、截断或二次编码
> - 禁止返回静态 PNG 图片，本工具已全面升级为 ECharts 动态前端渲染
> - 禁止传递不存在的占位符（模板只有以下 9 个占位符，传递其他名称会被忽略）

## 占位符清单（共 9 个）

模板中的全部占位符如下（通过 `data` 参数传递）：

| 占位符 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `REPORT_TITLE` | 文本 | 是 | 报告标题，如"销售数据集深度分析报告" |
| `REPORT_SUBTITLE` | 文本 | 是 | 报告副标题，如"多维度数据特征与业务洞见挖掘" |
| `EXEC_SUMMARY` | HTML | 是 | 执行摘要（你撰写的深度总结），使用 `<p>`, `<ul>`, `<li>` 等标签 |
| `DISTRIBUTION_INSIGHTS` | HTML | 是 | 数值分布洞察正文 |
| `CORRELATION_INSIGHTS` | HTML | 是 | 相关性分析洞察正文 |
| `CATEGORICAL_INSIGHTS` | HTML | 是 | 分类变量洞察正文 |
| `TIME_SERIES_INSIGHTS` | HTML | 是 | 时间序列洞察正文 |
| `CONCLUSIONS` | HTML | 是 | 结论与建议正文（包含建议内容，直接写在此字段中） |
| `CHART_DATA_JSON` | JSON字符串 | 是 | 脚本输出的原始 JSON（驱动图表渲染），必须从脚本输出原封不动复制 |

> **注意：** 模板中的所有章节标题（如 "Distribution Analysis"、"Correlation Analysis"、"Conclusions & Recommendations" 等）、洞察框标题（"Insights"）和页脚文本已硬编码在 HTML 中，无需通过占位符传递。

## 为什么选择本工具？

1. **极速与轻量**：告别缓慢的 Python 绘图和大量 PNG 生成，只传输核心 JSON 数据。
2. **现代交互式排版**：全面接入 Tailwind CSS 响应式布局和 Apache ECharts 丝滑动画交互。
3. **深度业务洞见**：通过将机器的数据提炼和 LLM 的逻辑推理分离，能产出极具含金量的数据分析报告。

## 文件结构

```
csv-data-analysis/
├── SKILL.md                        # 你当前正在阅读的技能指南
├── scripts/
│   └── csv_analyzer.py             # Python 分析引擎（轻量级、无图形依赖）
└── templates/
    └── report_template.html        # 响应式 ECharts 报表模板（内含完整渲染逻辑与硬编码标题）
```
