---
name: walmart-sales-analyzer
description: 分析 Walmart 销售数据，探索门店销售额与失业率之间的趋势，并生成包含深度分析和解读的可视化图表及美观的 HTML 报告。适用于需要快速洞察销售数据与宏观经济因素关系的场景。
---

# Walmart 销售数据深度分析器

此技能旨在帮助用户对 Walmart 销售数据进行深度分析，特别是探索不同门店的销售额与失业率之间的关系，并通过生成包含详细解读的可视化图表和专业 HTML 报告来直观展示这些趋势。

## 功能

本技能提供以下分析和可视化功能：

1.  **数据相关性热力图**：展示数据集中所有数值变量之间的相关性，并提供详细解读。
2.  **销售额与失业率散点图**：直观展示周销售额与失业率之间的关系，附带回归线，并深入分析经济压力下的消费韧性。
3.  **特定门店销售额与失业率时间序列趋势图**：追踪选定门店的销售额和失业率随时间的变化趋势，研判季节性力量与宏观趋势。
4.  **各门店平均销售额与平均失业率对比图**：比较不同门店的平均销售表现与当地平均失业率，提供区域化运营策略建议。
5.  **HTML 深度分析报告生成**：自动将所有图表整合到一个美观、响应式且包含详细分析结论和业务建议的 HTML 报告中。

## 使用方法

要使用此技能，您需要提供一个包含 Walmart 销售数据的 CSV 文件。该文件应至少包含以下列：`Store` (门店ID), `Date` (日期), `Weekly_Sales` (周销售额), `Unemployment` (失业率)。

### 脚本列表

*   `scripts/generate_html_report.py`：**推荐使用**，一键生成包含所有图表和深度分析的 HTML 报告。
*   `scripts/generate_correlation_heatmap.py`：生成数据相关性热力图。
*   `scripts/generate_sales_unemployment_scatter.py`：生成销售额与失业率的散点图。
*   `scripts/generate_time_series_trend.py`：生成特定门店趋势图。
*   `scripts/generate_store_avg_comparison.py`：生成各门店平均值对比图。

### 运行示例

推荐使用 `generate_html_report.py` 脚本，它会自动调用其他脚本并生成完整的、包含深度分析的报告：

```bash
# 确保您的数据文件位于 /home/ubuntu/upload/Walmart_Sales.csv

# 生成完整的 HTML 深度分析报告及其配套图表
python3 /home/ubuntu/skills/walmart-sales-analyzer/scripts/generate_html_report.py
```

默认情况下，报告和图表将生成在 `/home/ubuntu/walmart_analysis_report/` 目录下。

### 模板

*   `templates/report_template.html`：用于生成深度分析报告的 HTML 样式模板。

## 注意事项

*   所有图表均支持中文显示。
*   报告模板采用响应式设计，适合在不同设备上查看，并提供了详细的分析解读和业务建议。
