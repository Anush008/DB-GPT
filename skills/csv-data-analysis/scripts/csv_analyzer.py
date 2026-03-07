import pandas as pd
import numpy as np
import os
import json
import warnings
import sys

warnings.filterwarnings("ignore")


def log(*args, **kwargs):
    """将日志输出到 stderr，避免污染 stdout 的 JSON 输出"""
    print(*args, file=sys.stderr, **kwargs)


def analyze_csv(file_path):
    """
    分析CSV文件，提取用于 ECharts 渲染的数据结构和用于 LLM 分析的统计摘要。
    输出包含: overview, distributions, correlations, categories, time_series,
    scatter (散点图), stats_table (统计表格)
    """
    try:
        log(f"正在读取文件: {file_path}")
        df = pd.read_csv(file_path)

        # ==========================================
        # 1. 基础概览数据
        # ==========================================
        total_cells = int(df.shape[0] * df.shape[1])
        missing_cells = int(df.isnull().sum().sum())
        missing_pct = (
            round((missing_cells / total_cells) * 100, 2) if total_cells > 0 else 0
        )

        overview = {
            "rows": int(df.shape[0]),
            "cols": int(df.shape[1]),
            "missing_cells": missing_cells,
            "missing_pct": missing_pct,
        }

        # ==========================================
        # 2. 数值列分析 (直方图分布 & 相关性)
        # ==========================================
        numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
        distributions = {}
        correlations = {"cols": numeric_cols, "data": []}
        numeric_summary = {}

        if numeric_cols:
            # 取最多前 8 个数值列画分布图
            for col in numeric_cols[:8]:
                s = df[col].dropna()
                if len(s) > 0:
                    # 使用 numpy 计算直方图 (10个 bin)
                    hist, bin_edges = np.histogram(s, bins=10)
                    bins = [
                        f"{bin_edges[i]:.1f}~{bin_edges[i + 1]:.1f}"
                        for i in range(len(hist))
                    ]
                    distributions[col] = {
                        "bins": bins,
                        "counts": [int(x) for x in hist],
                    }
                    numeric_summary[col] = {
                        "min": float(s.min()),
                        "max": float(s.max()),
                        "mean": float(s.mean()),
                        "median": float(s.median()),
                        "std": float(s.std()),
                        "q25": float(s.quantile(0.25)),
                        "q75": float(s.quantile(0.75)),
                    }

            # 相关性矩阵 (取全部数值列)
            if len(numeric_cols) > 1:
                corr_df = df[numeric_cols].corr(method="pearson").fillna(0).round(2)  # type: ignore[call-overload]
                for i, col1 in enumerate(numeric_cols):
                    for j, col2 in enumerate(numeric_cols):
                        correlations["data"].append([i, j, float(corr_df.iloc[i, j])])

        # ==========================================
        # 3. 分类列分析 (饼图/柱状图)
        # ==========================================
        categorical_cols = df.select_dtypes(
            include=["object", "category"]
        ).columns.tolist()
        categories = {}
        cat_summary = {}

        if categorical_cols:
            # 取最多前 6 个分类列
            for col in categorical_cols[:6]:
                if df[col].nunique() <= 50:
                    val_counts = df[col].value_counts().head(10)
                    if len(val_counts) > 0:
                        categories[col] = {
                            "labels": [str(x) for x in val_counts.index.tolist()],
                            "values": [int(x) for x in val_counts.values],
                        }
                        top1 = val_counts.index[0]
                        top1_count = val_counts.values[0]
                        cat_summary[col] = (
                            f"唯一值数量: {df[col].nunique()}，最常见: {top1} (出现 {top1_count} 次)"
                        )

        # ==========================================
        # 4. 时间序列分析
        # ==========================================
        time_series = {"name": "", "dates": [], "values": []}

        if numeric_cols:
            date_col = None
            for col in df.columns:
                if df[col].dtype == "object":
                    try:
                        pd.to_datetime(df[col].dropna().head(100))
                        date_col = col
                        break
                    except Exception:
                        pass

            if date_col:
                num_col = numeric_cols[0]
                df_ts = df.copy()
                df_ts[date_col] = pd.to_datetime(df_ts[date_col], errors="coerce")
                df_ts = df_ts.dropna(subset=[date_col, num_col])

                if not df_ts.empty:
                    df_ts = df_ts.set_index(date_col)
                    try:
                        monthly = df_ts[num_col].resample("M").mean().dropna()
                        if len(monthly) < 3:
                            monthly = df_ts[num_col].resample("D").mean().dropna()
                        monthly = monthly.tail(100)

                        time_series["name"] = num_col
                        time_series["dates"] = [
                            x.strftime("%Y-%m-%d") for x in monthly.index
                        ]
                        time_series["values"] = [
                            round(float(x), 2) for x in monthly.values
                        ]
                    except Exception as e:
                        log(f"时间序列处理失败: {e}")

        # ==========================================
        # 5. 散点图数据 (前两个数值列)
        # ==========================================
        scatter = {}
        if len(numeric_cols) >= 2:
            col_x, col_y = numeric_cols[0], numeric_cols[1]
            df_scatter = df[[col_x, col_y]].dropna()
            # 限制最多 500 个点，避免数据过大
            if len(df_scatter) > 500:
                df_scatter = df_scatter.sample(500, random_state=42)
            scatter = {
                "x_name": col_x,
                "y_name": col_y,
                "x": [round(float(v), 4) for v in df_scatter[col_x].tolist()],
                "y": [round(float(v), 4) for v in df_scatter[col_y].tolist()],
            }

        # ==========================================
        # 6. 统计汇总表格
        # ==========================================
        stats_table = {"headers": [], "rows": []}
        if numeric_summary:
            stats_table["headers"] = [
                "变量",
                "最小值",
                "Q25",
                "中位数",
                "均值",
                "Q75",
                "最大值",
                "标准差",
            ]
            for col, s in numeric_summary.items():
                stats_table["rows"].append(
                    [
                        col,
                        round(s["min"], 2),
                        round(s["q25"], 2),
                        round(s["median"], 2),
                        round(s["mean"], 2),
                        round(s["q75"], 2),
                        round(s["max"], 2),
                        round(s["std"], 2),
                    ]
                )

        # ==========================================
        # 构建给 ECharts 渲染的完整 JSON 数据结构
        # ==========================================
        chart_data = {
            "overview": overview,
            "numeric_cols": numeric_cols,
            "distributions": distributions,
            "correlations": correlations,
            "categories": categories,
            "time_series": time_series,
            "scatter": scatter,
            "stats_table": stats_table,
        }

        chart_data_json_str = json.dumps(chart_data, ensure_ascii=False)

        # ==========================================
        # 构建给 LLM 深度分析阅读的文本摘要
        # ==========================================
        summary_lines = [
            "==================================================",
            "【数据概览】",
            f"- 数据集尺寸: {overview['rows']} 行 × {overview['cols']} 列",
            f"- 缺失值情况: 共有 {overview['missing_cells']} 个单元格缺失，整体数据完整率 {100 - overview['missing_pct']}%",
            f"- 数值型列 ({len(numeric_cols)}): {', '.join(numeric_cols[:10])}",
            f"- 分类型列 ({len(categorical_cols)}): {', '.join(categorical_cols[:10])}",
            "",
            "【数值型特征统计 (Top 8)】",
        ]
        for col, s in numeric_summary.items():
            summary_lines.append(
                f"- {col}: min={s['min']:.2f}, Q25={s['q25']:.2f}, median={s['median']:.2f}, "
                f"mean={s['mean']:.2f}, Q75={s['q75']:.2f}, max={s['max']:.2f}, std={s['std']:.2f}"
            )

        summary_lines.append("")
        summary_lines.append("【分类型特征摘要 (Top 6)】")
        for col, stats in cat_summary.items():
            summary_lines.append(f"- {col}: {stats}")

        summary_lines.append("")
        summary_lines.append("【核心相关性】")
        if correlations["data"]:
            strong_corrs = []
            for item in correlations["data"]:
                i, j, val = item
                if i < j and abs(val) >= 0.5:
                    strong_corrs.append(
                        f"{numeric_cols[i]} 与 {numeric_cols[j]} (相关系数: {val})"
                    )
            if strong_corrs:
                summary_lines.extend([f"- {c}" for c in strong_corrs])
            else:
                summary_lines.append("- 没有发现强相关的数值变量组合（|r| >= 0.5）。")

        if scatter:
            summary_lines.append("")
            summary_lines.append(
                f"【散点图】已生成 {scatter['x_name']} vs {scatter['y_name']} 的散点图数据"
            )

        summary_lines.append("==================================================")
        summary_lines.append(
            "请作为数据分析专家，基于以上【统计摘要】为用户撰写深度的数据分析见解（Insights）。"
        )
        summary_lines.append(
            "并且，在使用 html_interpreter 时，请将下方 JSON_START 和 JSON_END 标记之间的纯 JSON 字符串完整传递给变量 CHART_DATA_JSON。"
        )
        summary_lines.append("###CHART_DATA_JSON_START###")
        summary_lines.append(chart_data_json_str)
        summary_lines.append("###CHART_DATA_JSON_END###")

        final_text = "\n".join(summary_lines)

        # 输出标准 chunks
        print(
            json.dumps(
                {"chunks": [{"output_type": "text", "content": final_text}]},
                ensure_ascii=False,
            )
        )

    except Exception as e:
        import traceback

        err_msg = f"分析过程中出现错误: {str(e)}\n{traceback.format_exc()}"
        print(
            json.dumps(
                {"chunks": [{"output_type": "text", "content": err_msg}]},
                ensure_ascii=False,
            )
        )


def main():
    if len(sys.argv) < 2:
        result = {
            "chunks": [
                {
                    "output_type": "text",
                    "content": '使用方法: python csv_analyzer.py \'{"input_file": "data.csv"}\'',
                }
            ]
        }
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(1)

    try:
        args = json.loads(sys.argv[1])
        csv_file = (
            args.get("input_file") or args.get("file_path") or args.get("csv_file", "")
        )
    except (ValueError, TypeError):
        csv_file = sys.argv[1]

    if not csv_file or not os.path.exists(csv_file):
        result = {
            "chunks": [{"output_type": "text", "content": f"文件不存在: {csv_file}"}]
        }
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(1)

    if not csv_file.lower().endswith(".csv"):
        result = {
            "chunks": [
                {"output_type": "text", "content": f"文件不是CSV格式: {csv_file}"}
            ]
        }
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(1)

    analyze_csv(csv_file)


if __name__ == "__main__":
    main()
