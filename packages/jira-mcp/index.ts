// jira-mcp server

import express from 'express';
import { searchIssues, getIssue, addComment, addLabels, createIssue } from './jiraTools';

const app = express();
const port = 3000;

app.use(express.json());

app.get('/mcp/searchIssues', (req, res) => searchIssues(req, res));
app.get('/mcp/getIssue', (req, res) => getIssue(req, res));
app.post('/mcp/addComment', (req, res) => addComment(req, res));
app.post('/mcp/addLabels', (req, res) => addLabels(req, res));
app.post('/mcp/createIssue', (req, res) => createIssue(req, res));

app.listen(port, () => {
    console.log(`JIRA MCP server running at http://localhost:${port}/mcp`);
});

// Additional code to set environment variables
// Reading from environment for JIRA_BASE_URL, etc.