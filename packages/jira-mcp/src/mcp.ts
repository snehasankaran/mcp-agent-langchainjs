import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { searchIssues, getIssue, updateIssue, addComment } from './jira-client.js';
import { jiraBaseUrl } from './config.js';

async function createToolResponse(action: () => Promise<unknown>) {
  try {
    const result = await action();
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text' as const, text: `Error: ${message}` }],
      isError: true,
    };
  }
}

export function getMcpServer(): McpServer {
  const server = new McpServer({
    name: 'jira-mcp',
    version: '1.0.0',
  });

  server.registerTool(
    'jira_search',
    {
      description: 'Search Jira issues using JQL (Jira Query Language)',
      inputSchema: z.object({
        jql: z.string().describe('JQL query string, e.g. "project=AP AND status=\'In Progress\'"'),
        maxResults: z.number().optional().describe('Maximum number of results to return (default 50)'),
        fields: z.array(z.string()).optional().describe('Specific fields to include in the response'),
      }),
    },
    async (args) =>
      createToolResponse(async () => {
        if (!jiraBaseUrl) {
          throw new Error('JIRA_BASE_URL is not configured');
        }

        return searchIssues(args.jql, args.maxResults, args.fields);
      }),
  );

  server.registerTool(
    'jira_get_issue',
    {
      description: 'Get details of a specific Jira issue by its key',
      inputSchema: z.object({
        key: z.string().describe('Jira issue key, e.g. "AP-123"'),
        fields: z.array(z.string()).optional().describe('Specific fields to include in the response'),
      }),
    },
    async (args) =>
      createToolResponse(async () => {
        if (!jiraBaseUrl) {
          throw new Error('JIRA_BASE_URL is not configured');
        }

        return getIssue(args.key, args.fields);
      }),
  );

  server.registerTool(
    'jira_update_issue',
    {
      description:
        'Update fields of a Jira issue. Supports summary, description, labels, priority, storyPoints, and other standard fields.',
      inputSchema: z.object({
        key: z.string().describe('Jira issue key, e.g. "AP-123"'),
        fields: z
          .record(z.string(), z.unknown())
          .describe(
            'Fields to update as key-value pairs. Use "storyPoints" for story points, "summary" for title, "labels" for labels array, "priority" for priority name.',
          ),
      }),
    },
    async (args) =>
      createToolResponse(async () => {
        if (!jiraBaseUrl) {
          throw new Error('JIRA_BASE_URL is not configured');
        }

        await updateIssue(args.key, args.fields);
        return { success: true, key: args.key, updated: args.fields };
      }),
  );

  server.registerTool(
    'jira_add_comment',
    {
      description: 'Add a comment to a Jira issue',
      inputSchema: z.object({
        key: z.string().describe('Jira issue key, e.g. "AP-123"'),
        body: z.string().describe('Comment text to add'),
      }),
    },
    async (args) =>
      createToolResponse(async () => {
        if (!jiraBaseUrl) {
          throw new Error('JIRA_BASE_URL is not configured');
        }

        return addComment(args.key, args.body);
      }),
  );

  return server;
}
