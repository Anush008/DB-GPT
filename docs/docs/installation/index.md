---
sidebar_position: 0
title: Install
summary: "Choose the fastest way to install DB-GPT: quick install, CLI install, or source install"
read_when:
  - You want to decide which installation path fits your environment
  - You want the shortest route to a working DB-GPT setup
---

# Install

DB-GPT offers three recommended installation paths. Pick the one that matches how you want to run and manage the project.

## Choose an installation path

| Method | Best for | What you get |
|---|---|---|
| [Quick Install](/docs/installation/quick-install) | Fastest first run on macOS / Linux | One-line installer, generated profile config, ready-to-start webserver |
| [CLI Install](/docs/getting-started/cli-quickstart) | Users who prefer installing from PyPI | `dbgpt` CLI, interactive setup wizard, profile management |
| [Source Install](/docs/getting-started/deploy/source-code) | Developers and custom deployments | Full repo checkout, editable configs, maximum flexibility |

## Recommended path

For most users, start with **Quick Install**. It gives you the fastest path from zero to a running DB-GPT web UI.

```bash
curl -fsSL https://raw.githubusercontent.com/eosphoros-ai/DB-GPT/main/scripts/install/install.sh | bash
```

After installation, start the generated profile config:

```bash
cd ~/.dbgpt/DB-GPT && uv run dbgpt start webserver --config ~/.dbgpt/configs/<profile>.toml
```

Then open [http://localhost:5670](http://localhost:5670).

## When to choose each method

### Quick Install

Choose this if you want the simplest install flow and do not need to manage the repository manually.

### CLI Install

Choose this if you want to install DB-GPT directly from PyPI and use the `dbgpt` command to set up profiles interactively.

### Source Install

Choose this if you want full access to the repository for development, debugging, or custom integrations.

## Next steps

- [Quick Install](/docs/installation/quick-install)
- [CLI Install](/docs/getting-started/cli-quickstart)
- [Source Install](/docs/getting-started/deploy/source-code)
