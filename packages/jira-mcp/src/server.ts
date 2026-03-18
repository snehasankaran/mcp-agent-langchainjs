import process from 'node:process';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Request, Response } from 'express';
import { jiraBaseUrl, jiraProjectKey, port } from './config.js';
import { getMcpServer } from './mcp.js';

const app = createMcpExpressApp();

app.get('/', (_request: Request, response: Response) => {
  response.send({
    status: 'up',
    message: `Jira MCP server running (project: ${jiraProjectKey}, Jira: ${jiraBaseUrl || 'not configured'})`,
  });
});

app.all('/mcp', async (request: Request, response: Response) => {
  console.log(`Received ${request.method} request to /mcp`);

  if (request.method === 'GET' || request.method === 'DELETE') {
    response.writeHead(405).end(
      JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32_000,
          message: 'Method not allowed.',
        },
        id: null,
      }),
    );
    return;
  }

  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    const server = getMcpServer();
    await server.connect(transport);

    await transport.handleRequest(request, response, request.body);

    response.on('close', async () => {
      await transport.close();
      await server.close();
    });
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!response.headersSent) {
      response.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32_603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});

app.listen(port, () => {
  console.log(`Jira MCP server listening on port ${port}`);
  console.log(`MCP endpoint: http://localhost:${port}/mcp`);
  console.log(`Jira base URL: ${jiraBaseUrl || '(not configured)'}`);
  console.log(`Default project: ${jiraProjectKey}`);
});

process.on('SIGINT', async () => {
  console.log('Shutting down Jira MCP server...');
  process.exit(0);
});
