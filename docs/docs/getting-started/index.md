---
sidebar_position: 0
title: DB-GPT
summary: "Getting-started hub: what DB-GPT is, the fastest setup path, and where to go next"
read_when:
  - You want the shortest path from repo clone to a working DB-GPT chat
  - You want a map of the core docs before going deeper
---

# DB-GPT

DB-GPT is an open-source framework for building AI-native data applications with **LLMs, RAG, agents, AWEL workflows, and database integrations**.

If you want the fastest path: use an API model provider, start the webserver, then open the Web UI.

## Fast path

1. Check the requirements: [Prerequisites](/docs/getting-started/prerequisites)
2. Follow the 5-minute setup: [Getting Started](/docs/getting-started/quick-start)
3. Pick a model provider: [Model Providers](/docs/getting-started/providers/)
4. Verify the UI opens at `http://localhost:5670`

## Quick start

```bash
# 1. Clone the repository
git clone https://github.com/eosphoros-ai/DB-GPT.git
cd DB-GPT

# 2. Install dependencies (OpenAI proxy example)
uv sync --all-packages \
  --extra "base" \
  --extra "proxy_openai" \
  --extra "rag" \
  --extra "storage_chromadb" \
  --extra "dbgpts"

# 3. Configure your API key
# Edit configs/dbgpt-proxy-openai.toml and set api_key

# 4. Start the server
uv run dbgpt start webserver --config configs/dbgpt-proxy-openai.toml
```

Open your browser and visit [http://localhost:5670](http://localhost:5670).

If the UI loads and you can start a chat, the base setup is working.

## What DB-GPT includes

- **SMMF** for model management and provider switching
- **RAG** for document and knowledge retrieval
- **Agents** for tool use, planning, and multi-agent workflows
- **AWEL** for DAG-based workflow orchestration
- **Data sources** for SQL, analytics, and Text2SQL use cases

## Where to go next

- **Core concepts**
  - [Architecture](/docs/getting-started/concepts/architecture)
  - [AWEL](/docs/getting-started/concepts/awel)
  - [Agents](/docs/getting-started/concepts/agents)
  - [RAG](/docs/getting-started/concepts/rag)
- **Setup and deployment**
  - [Model Providers](/docs/getting-started/providers/)
  - [Source Code Deployment](/docs/getting-started/deploy/source-code)
  - [Docker Deployment](/docs/getting-started/deploy/docker)
- **Using the product**
  - [Web UI Overview](/docs/getting-started/web-ui/)
  - [Tools & Plugins](/docs/getting-started/tools/)
  - [Troubleshooting](/docs/getting-started/troubleshooting/)
- **Reference**
  - [Development Guide](/docs/agents/introduction/)
  - [API Reference](/docs/api/introduction)
  - [Configuration Reference](/docs/config/config-reference)
  - [FAQ](/docs/faq/install)
