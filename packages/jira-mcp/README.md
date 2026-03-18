<div align="center">

# Jira MCP Server

![Node version](https://img.shields.io/badge/Node.js->=22-3c873a?style=flat-square)
[![TypeScript](https://img.shields.io/badge/TypeScript-blue?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![MCP](https://img.shields.io/badge/MCP-Model_Context_Protocol-blue?style=flat-square)](https://modelcontextprotocol.io)

</div>

## Overview

A Model Context Protocol (MCP) server exposing Jira Cloud operations as LLM tools over HTTP. It enables AI agents to search, read, and update Jira issues for agile workflows such as backlog refinement, sprint planning, and daily standups.

## Configuration

Set the following environment variables in your `.env` file at the repository root:

| Variable | Required | Description |
|---|---|---|
| `JIRA_BASE_URL` | Yes | Your Jira Cloud base URL, e.g. `https://your-domain.atlassian.net` |
| `JIRA_EMAIL` | Yes | Email address for Jira API token authentication |
| `JIRA_API_TOKEN` | Yes | Jira API token (create at https://id.atlassian.com/manage-profile/security/api-tokens) |
| `JIRA_PROJECT_KEY` | No | Default Jira project key (default: `AP`) |
| `JIRA_STORY_POINTS_FIELD_ID` | No | Override story points field ID (auto-detected if not set) |
| `PORT` | No | Server port (default: `3001`) |

## Starting the Server

```bash
npm run start --workspace=jira-mcp
```

Or in development mode with auto-reload:

```bash
npm run dev --workspace=jira-mcp
```

The server starts at `http://localhost:3001/mcp`.

## Available MCP Tools

### `jira_search`
Search Jira issues using JQL.

```json
{
  "jql": "project=AP AND statusCategory != Done ORDER BY Rank ASC",
  "maxResults": 50,
  "fields": ["summary", "status", "assignee"]
}
```

### `jira_get_issue`
Get details of a specific issue.

```json
{
  "key": "AP-123",
  "fields": ["summary", "description", "status"]
}
```

### `jira_update_issue`
Update fields of a Jira issue. Use `storyPoints` for story points.

```json
{
  "key": "AP-123",
  "fields": {
    "summary": "Updated title",
    "storyPoints": 5,
    "labels": ["needs-refinement"],
    "priority": { "name": "High" }
  }
}
```

### `jira_add_comment`
Add a comment to a Jira issue.

```json
{
  "key": "AP-123",
  "body": "Status update: In progress, expected completion tomorrow."
}
```
