---
sidebar_position: 0
title: 安装
summary: "选择最适合你的 DB-GPT 安装方式：快速安装、CLI 安装或源码安装"
read_when:
  - 你想判断哪种安装路径最适合当前环境
  - 你希望以最短路径完成可用的 DB-GPT 安装
---

# 安装

DB-GPT 提供三种推荐安装方式。你可以根据自己的使用方式和环境选择最合适的路径。

## 选择安装方式

| 方式 | 适合人群 | 你会得到什么 |
|---|---|---|
| [快速安装](/docs/installation/quick-install) | 希望在 macOS / Linux 上最快完成首次启动的用户 | 一行安装脚本、自动生成的 provider 配置、可直接启动的 webserver |
| [CLI 安装](/docs/getting-started/cli-quickstart) | 希望通过 PyPI 安装并使用命令行的用户 | `dbgpt` CLI、交互式向导、profile 管理能力 |
| [源码安装](/docs/getting-started/deploy/source-code) | 开发者或需要自定义部署的用户 | 完整仓库、可编辑配置、最大灵活性 |

## 推荐路径

对于大多数用户，建议先使用 **快速安装**。这是从零开始到跑通 DB-GPT Web UI 的最快路径。

```bash
curl -fsSL https://raw.githubusercontent.com/eosphoros-ai/DB-GPT/main/scripts/install/install.sh | bash
```

安装完成后，使用生成好的 profile 配置启动：

```bash
cd ~/.dbgpt/DB-GPT && uv run dbgpt start webserver --config ~/.dbgpt/configs/<profile>.toml
```

然后打开 [http://localhost:5670](http://localhost:5670)。

## 什么时候选择哪种方式

### 快速安装

如果你想以最少步骤完成安装，并且不打算手动管理仓库结构，选择这种方式。

### CLI 安装

如果你想直接通过 PyPI 安装 DB-GPT，并用 `dbgpt` 命令交互式配置 provider profile，选择这种方式。

### 源码安装

如果你需要完整仓库用于开发、调试或自定义集成，选择这种方式。

## 下一步

- [快速安装](/docs/installation/quick-install)
- [CLI 安装](/docs/getting-started/cli-quickstart)
- [源码安装](/docs/getting-started/deploy/source-code)
