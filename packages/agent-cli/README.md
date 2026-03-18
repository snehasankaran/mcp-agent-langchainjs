<div align="center">

# Agent CLI (LangChain.js)

![Node version](https://img.shields.io/badge/Node.js->=22-3c873a?style=flat-square)
[![TypeScript](https://img.shields.io/badge/TypeScript-blue?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![LangChain.js](https://img.shields.io/badge/LangChain.js-1C3C3C?style=flat-square&logo=langchain&logoColor=white)](https://js.langchain.com)

[Overview](#overview) • [Usage](#usage) • [Agile Commands](#agile-commands) • [LLM Provider](#llm-provider) • [Development](#development) • [Troubleshooting](#troubleshooting)

</div>

## Overview

The Agent CLI is a command line interface to the LangChain.js agent. It supports:

- **Burger ordering** – connects to the Burger MCP server for managing orders
- **Agile lifecycle** – connects to the Jira MCP server for backlog refinement, sprint planning, and daily standups

Conversation state is persisted locally so you can build context across multiple invocations.

<div align="center">
<img src="../../docs/images/cli-architecture.drawio.png" alt="Architecture" />
</div>

## Installation

Follow the instructions [here](../../README.md#getting-started) to set up the development environment.

```bash
cd packages/agent-cli
npm start "show me a spicy burger"
```

### Global CLI install (optional)

```bash
npm run build
npm install -g .
agent-cli "show me a spicy burger"
```

## Usage

### Burger commands

```bash
# Basic menu query
npm start "show me the burger menu"

# Place an order (will ask for userId if missing)
npm start "place an order for 2 classic burgers"

# Provide user id explicitly
npm start "place an order for 1 veggie burger" -- --userId user123

# Force local MCP endpoint
npm start "what toppings are available" -- --local

# Use a custom MCP URL
npm start "show me the menu" -- --mcp-url http://myserver:3000/mcp

# Verbose mode shows intermediate tool steps
npm start "status of my recent orders" -- --userId user123 --verbose
```

### Options

| Flag               | Description                                                           |
| ------------------ | --------------------------------------------------------------------- |
| `--userId <id>`    | Specify the user identity (required for placing or cancelling orders) |
| `--new`            | Start a fresh session (ignores prior conversation)                    |
| `--verbose`        | Print intermediate LLM + tool invocation steps                        |
| `--local`          | Force `http://localhost:3000/mcp` instead of `BURGER_MCP_URL`         |
| `--mcp-url <url>`  | Override MCP server URL                                               |
| `--llm <provider>` | LLM provider: `azure` or `local` (see [LLM Provider](#llm-provider)) |
| `--help`           | Display usage information                                             |

## Agile Commands

The CLI includes an `agile` command group for Jira-based agile workflows. These commands connect to the Jira MCP server (default: `http://localhost:3001/mcp`).

**All agile commands default to propose-only mode.** Use `--apply` to execute Jira writes.

### Start the Jira MCP server

```bash
npm run start:jira-mcp
# or
npm run start --workspace=jira-mcp
```

### Backlog Refinement

```bash
# Propose refinements for project AP (default JQL: not Done, sorted by Rank)
npm start agile refine

# Custom project and JQL
npm start agile refine -- --project AP --jql "project=AP AND status='Backlog'"

# Apply refinements to Jira
npm start agile refine -- --apply

# Show intermediate steps
npm start agile refine -- --verbose
```

### Sprint Planning

```bash
# Propose a sprint plan with capacity constraints
npm start agile plan -- --capacity 40

# With velocity and sprint name
npm start agile plan -- --capacity 40 --velocity 35 --sprint "Sprint 12"

# Apply story point updates to Jira
npm start agile plan -- --capacity 40 --apply
```

### Daily Standup

```bash
# Generate standup summary for last 24 hours (default)
npm start agile standup

# Custom time window
npm start agile standup -- --since 48h

# Apply status comments to Jira issues
npm start agile standup -- --apply
```

### Agile command options

| Flag               | Description                                              | Default                                            |
| ------------------ | -------------------------------------------------------- | -------------------------------------------------- |
| `--project <key>`  | Jira project key                                         | `AP` or `JIRA_PROJECT_KEY` env                     |
| `--jql <query>`    | Custom JQL for `refine`                                  | `project=AP AND statusCategory != Done ORDER BY Rank ASC` |
| `--apply`          | Execute Jira writes (default: propose only)              | off                                                |
| `--capacity <n>`   | Sprint capacity in story points (for `plan`)             | –                                                  |
| `--velocity <n>`   | Team velocity in story points (for `plan`)               | –                                                  |
| `--sprint <name>`  | Target sprint name (for `plan`)                          | –                                                  |
| `--since <window>` | Time window for `standup` (e.g. `24h`, `2d`, `48h`)     | `24h`                                              |
| `--verbose`        | Show intermediate tool steps                             | off                                                |
| `--mcp-url <url>`  | Override Jira MCP server URL                             | `JIRA_MCP_URL` or `http://localhost:3001/mcp`      |
| `--llm <provider>` | LLM provider: `azure` or `local`                         | auto-detected                                      |

## LLM Provider

The CLI supports two LLM providers selectable via `--llm`:

### Local (Foundry / OpenAI-compatible)

Use any OpenAI-compatible local endpoint (Foundry local, Ollama with OpenAI adapter, LM Studio, etc.):

```bash
# In .env:
LOCAL_OPENAI_BASE_URL=http://localhost:5273/v1
LOCAL_OPENAI_MODEL=phi-3.5-mini

# Run with local LLM
npm start agile refine -- --llm local
```

If `LOCAL_OPENAI_BASE_URL` is set and `AZURE_OPENAI_API_ENDPOINT` is not, the CLI defaults to `local`.

### Azure OpenAI

```bash
# In .env:
AZURE_OPENAI_API_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_MODEL=gpt-4o

# Run with Azure (requires az login or azd auth login)
npm start agile refine -- --llm azure
```

Authentication uses `DefaultAzureCredential`. Run `az login` or `azd auth login` first.

## Session History

Session data is stored under `~/.agent-cli/`:

- Burger sessions: `~/.agent-cli/burger-agent-cli.json`
- Agile refine: `~/.agent-cli/agile-refine-agent-cli.json`
- Agile plan: `~/.agent-cli/agile-plan-agent-cli.json`
- Agile standup: `~/.agent-cli/agile-standup-agent-cli.json`

Use `--new` to start a fresh session.

## Environment Variables

| Variable                    | Required     | Purpose                                          | Default                     |
| --------------------------- | ------------ | ------------------------------------------------ | --------------------------- |
| `AZURE_OPENAI_API_ENDPOINT` | For `azure`  | Azure OpenAI endpoint                            | –                           |
| `AZURE_OPENAI_MODEL`        | No           | Azure model name                                 | `gpt-5-mini`                |
| `LOCAL_OPENAI_BASE_URL`     | For `local`  | Local OpenAI-compatible base URL                 | –                           |
| `LOCAL_OPENAI_MODEL`        | No           | Local model name                                 | `phi-3.5-mini`              |
| `LOCAL_OPENAI_API_KEY`      | No           | Local API key (often not needed)                 | `local`                     |
| `BURGER_MCP_URL`            | No           | Burger MCP endpoint                              | `http://localhost:3000/mcp` |
| `JIRA_MCP_URL`              | No           | Jira MCP endpoint                                | `http://localhost:3001/mcp` |
| `JIRA_PROJECT_KEY`          | No           | Default Jira project key for agile commands      | `AP`                        |
| `AGENT_WEBAPP_URL`          | No           | URL shown in prompt for userId retrieval         | `http://localhost:4280`     |

## Development

| Script          | Description                               |
| --------------- | ----------------------------------------- |
| `npm start`     | Build then run a single agent interaction |
| `npm run build` | Compile TypeScript to `dist`              |
| `npm run watch` | Incremental compile in watch mode         |
| `npm run clean` | Remove build artifacts                    |

## Troubleshooting

- **Missing LLM config**: set `LOCAL_OPENAI_BASE_URL` for local mode or `AZURE_OPENAI_API_ENDPOINT` for Azure mode
- **Azure auth failures**: re-run `az login` or `azd auth login`
- **Jira MCP not running**: start it with `npm run start:jira-mcp` from the repo root
- **MCP connection issues**: ensure the MCP server is running and the URL is correct
