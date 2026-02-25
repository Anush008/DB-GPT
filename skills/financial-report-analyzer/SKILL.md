---
name: financial-report-analyzer
description: 专门用于上市公司财报（如年度报告、季度报告）的深度分析。该技能能够自动提取关键财务指标，计算核心财务比率，生成可视化图表，并结合行业背景生成专业的财务分析报告。
---

# 财报分析技能 (Financial Report Analyzer)

本技能旨在帮助 Manus 系统化地分析上市公司财报，通过提取核心数据、计算财务比率、生成可视化图表并结合业务背景，产出高质量的财务分析报告。

## 核心工作流程

1. **数据提取与结构化**：
   - 使用 `execute_skill_script_file` 工具执行 `scripts/extract_financials.py` 脚本，传入财报文件路径（`file_path` 参数），自动提取营收、净利润、资产、负债等核心数值。
   - 脚本支持 PDF 文件（通过 pdfplumber 解析）和纯文本文件，返回 JSON 格式的结构化数据。

2. **财务比率计算**：
   - 将提取的 JSON 数据传递给 `scripts/calculate_ratios.py` 脚本。
   - 自动计算毛利率、净利率、ROE、资产负债率等关键指标，输出 30 个模板占位符键值。
   - 参考 `references/financial_metrics.md` 确保指标定义的准确性。

3. **图表生成**：
   - 将提取的 JSON 数据传递给 `scripts/generate_charts.py` 脚本。
   - 自动生成 3 张可视化图表：
     - `financial_overview.png`：核心财务指标对比柱状图
     - `profitability_radar.png`：盈利能力指标横向条形图
     - `asset_structure.png`：资产结构环形饼图
   - 脚本执行后，系统自动扫描生成的图片文件并返回 `/images/xxx.png` 格式的 URL，可直接用于 HTML 报告。

4. **深度分析**：
   - 遵循 `references/analysis_framework.md` 提供的框架，从盈利质量、偿债风险、营运效率和现金流四个维度进行深度剖析。
   - 结合"经营情况讨论与分析"章节，解释业绩变动的核心驱动因素。

5. **报告生成与展示**：
   - 调用 `html_interpreter`，传入 `template_path` 和 `data` 参数：
     - `template_path`: `"financial-report-analyzer/templates/report_template.html"`
     - `data`: 包含你需要填写的占位符键值的字典，包括：
       - LLM 自行撰写的分析文本键：`PROFITABILITY_ANALYSIS`, `SOLVENCY_ANALYSIS`, `EFFICIENCY_ANALYSIS`, `CASHFLOW_ANALYSIS`, `ADVANTAGES_LIST`, `RISKS_LIST`, `OVERALL_ASSESSMENT`
       - （注：来自 `calculate_ratios.py` 的 30 个数据键会被系统自动合并到模板中，你不需要在 `data` 里再次传入它们，只需传入你写的分析文本即可）
     - 后端自动读取模板文件并替换 `{{占位符}}`，无需手动拼接 HTML。
   - 调用 `terminate` 返回 1-2 句话的简短摘要。
   - **注意**：不需要使用 `code_interpreter`，不需要使用 `execute_skill_script_file` 生成报告，不需要先用 `get_skill_resource` 读取模板。
   - **严格保留**模板的完整结构：所有章节（第1-4章）不得删除，摘要表格必须保留4列。
   - 报告会以卡片形式展示在左侧面板，用户点击卡片即可在右侧面板查看完整报告。

## 完整流程示例

```
Step 1: execute_skill_script_file(skill_name="financial-report-analyzer", script_file_name="extract_financials.py", args={"file_path": "/path/to/report.pdf"})
  → 返回 JSON: {"revenue": 10500000000, "net_profit": 1200000000, ...}

Step 2: execute_skill_script_file(skill_name="financial-report-analyzer", script_file_name="calculate_ratios.py", args=<Step1的JSON结果>)
  → 返回 30 个模板键值: {"COMPANY_NAME": "XX公司", "REVENUE": "105.00亿元", "GROSS_MARGIN": "28.57%", ...}

Step 3: execute_skill_script_file(skill_name="financial-report-analyzer", script_file_name="generate_charts.py", args=<Step1的JSON结果>)
  → 生成图表，系统自动返回图片URL: /images/xxx_financial_overview.png, /images/xxx_profitability_radar.png, /images/xxx_asset_structure.png

Step 4: html_interpreter(template_path="financial-report-analyzer/templates/report_template.html", data={
  "PROFITABILITY_ANALYSIS": "LLM撰写的盈利能力分析...",
  "SOLVENCY_ANALYSIS": "LLM撰写的偿债分析...",
  ...其他LLM分析文本
})

Step 5: terminate(message="简短摘要")
```

## 资源使用说明

- **脚本**：
  - `scripts/extract_financials.py`：接收 `file_path` 参数，读取财报文件（支持 PDF 和文本格式），提取核心财务数据。
  - `scripts/calculate_ratios.py`：计算财务比率，输出 30 个模板占位符键值。
  - `scripts/generate_charts.py`：生成 3 张可视化图表（matplotlib），图表 URL 由系统自动扫描返回。
- **参考**：
  - `references/financial_metrics.md`：包含公式定义。
  - `references/analysis_framework.md`：包含分析逻辑。
- **模板**：
  - `templates/report_template.html`：最终交付报告的 HTML 模板（**必须严格遵循**，不得删减章节或修改表格结构）。通过 `html_interpreter` 的 `template_path` 参数直接引用，后端自动替换 `{{占位符}}`。模板包含 3 处图表占位符（`{{CHART_FINANCIAL_OVERVIEW}}`, `{{CHART_PROFITABILITY}}`, `{{CHART_ASSET_STRUCTURE}}`），需填入 Step 3 返回的图片 URL。
  - `templates/report_template.md`：Markdown 版本，仅供参考结构说明。

## 注意事项

- 脚本提取可能受排版影响，建议在计算前人工核对提取的关键数值。
- 始终关注"非经常性损益"，以评估公司核心业务的真实盈利能力。
- 对比至少三年的历史数据，以识别趋势。
- `generate_charts.py` 依赖 matplotlib，请确保环境中已安装该库。
