import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { createAgent, BaseMessage, HumanMessage, AIMessage } from 'langchain';
import { ChatOpenAI } from '@langchain/openai';
import { loadMcpTools } from '@langchain/mcp-adapters';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '../../.env'), quiet: true });

const burgerAgentSystemPrompt = `
## Role
You an expert assistant that helps users with managing burger orders. Use the provided tools to get the information you need and perform actions on behalf of the user.
Only answer to requests that are related to burger orders and the menu. If the user asks for something else, politely inform them that you can only assist with burger orders.
You are invoked from a command line interface.

## Task
Help the user with their request, ask any clarifying questions if needed.

## Instructions
- Always use the tools provided to get the information requested or perform any actions
- If you get any errors when trying to use a tool that does not seem related to missing parameters, try again
- If you cannot get the information needed to answer the user's question or perform the specified action, inform the user that you are unable to do so. Never make up information.
- The get_burger tool can help you get informations about the burgers
- Creating or cancelling an order requires a \`userId\`: if not provided, ask the user to provide it or run the CLI with the \`--userId\` option (make sure you mention this). To get its user ID, the user must connect to ${process.env.AGENT_WEBAPP_URL ?? 'http://localhost:4280 (make sure that agent-webapp is running)'}.

## Output
Your response will be printed to a terminal. Do not use markdown formatting or any other special formatting. Just provide the plain text response.
`;

function buildAgileSystemPrompt(mode: 'refine' | 'plan' | 'standup', apply: boolean): string {
  const writeMode = apply
    ? 'You are allowed to perform Jira writes (updates and comments) using the provided tools.'
    : 'You must NOT perform any Jira writes. Only propose changes - do not call jira_update_issue or jira_add_comment.';

  const modeInstructions: Record<typeof mode, string> = {
    refine: `
## Task: Backlog Refinement
Analyze the provided Jira issues and propose refinements to improve quality and readiness.

For each issue:
1. Review the summary and description for clarity and completeness
2. Check if acceptance criteria are defined
3. Assess if the issue is ready for development (Definition of Ready)
4. Suggest improvements: clearer summary, better description, acceptance criteria, labels, priority adjustments, story point estimates

${
  apply
    ? `When applying refinements:
- Use jira_update_issue to apply field updates (summary, description, labels, priority, storyPoints)
- Use jira_add_comment to add notes about refinement decisions`
    : `Output a clear "Proposed Changes" section listing each issue key and what you would change.`
}`,

    plan: `
## Task: Sprint Planning
Based on the backlog issues, create a sprint plan.

1. Fetch candidate issues from the backlog
2. Consider story point estimates and capacity constraints
3. Propose a sprint goal that ties the selected stories together
4. Select stories that fit within the capacity/velocity constraints
5. Group stories by theme or epic if possible

${
  apply
    ? `When applying the plan:
- Use jira_update_issue to update story points or labels on selected stories`
    : `Output a clear sprint plan with: sprint goal, selected stories with story points, total points, rationale for selection.`
}`,

    standup: `
## Task: Daily Standup Summary
Generate a standup report based on recent Jira activity.

1. Search for recently updated, in-progress, and blocked issues
2. Organize findings into: Yesterday (completed/updated), Today (in progress), Blockers/Risks
3. Highlight any issues that need attention

${
  apply
    ? `When applying:
- Use jira_add_comment to add a brief status note on each in-progress or blocked issue`
    : `Output a standup summary in this format:
YESTERDAY: (issues updated/completed)
TODAY: (issues in progress)
BLOCKERS: (blocked issues or risks)`
}`,
  };

  return `
## Role
You are an expert Agile coach and Scrum Master assistant. Use the provided Jira tools to retrieve and analyze project data.

## Instructions
- Always use the jira_search and jira_get_issue tools to fetch real data before making recommendations
- Base all recommendations on actual issue data retrieved from Jira
- If you cannot retrieve data due to configuration issues, clearly explain what is missing
- ${writeMode}
- You are invoked from a command line interface

${modeInstructions[mode]}

## Output
Your response will be printed to a terminal. Do not use markdown formatting or any other special formatting. Use plain text with clear sections separated by dashes or blank lines.
`;
}

type LlmProvider = 'azure' | 'local';

interface CliArgs {
  question: string;
  userId?: string;
  isNew: boolean;
  verbose: boolean;
  local: boolean;
  mcpUrl?: string;
  llm?: LlmProvider;
  command?: AgileCommand;
}

type AgileCommand = {
  type: 'refine' | 'plan' | 'standup';
  project: string;
  apply: boolean;
  verbose: boolean;
  jql?: string;
  capacity?: number;
  velocity?: number;
  sprint?: string;
  since?: string;
};

interface SessionData {
  history: Array<{ type: 'human' | 'ai'; content: string }>;
  userId?: string;
}

function printHelp() {
  console.log('Usage: agent-cli <question> [options]');
  console.log('       agent-cli agile <subcommand> [options]');
  console.log('');
  console.log('Options:');
  console.log('  --userId <id>        User ID for order operations');
  console.log('  --new                Start a new session');
  console.log('  --verbose            Show intermediate steps');
  console.log('  --local              Connect to localhost burger MCP server (port 3000)');
  console.log('  --mcp-url <url>      Override MCP server URL');
  console.log('  --llm <azure|local>  LLM provider (default: local if no Azure env, else azure)');
  console.log('');
  console.log('Agile subcommands:');
  console.log('  agent-cli agile refine  [--project AP] [--jql <jql>] [--apply] [--verbose]');
  console.log('  agent-cli agile plan    [--project AP] [--capacity <n>] [--velocity <n>] [--sprint <name>] [--apply]');
  console.log('  agent-cli agile standup [--project AP] [--since <duration>] [--apply] [--verbose]');
  console.log('');
  console.log('Agile options:');
  console.log('  --project <key>    Jira project key (default: AP or JIRA_PROJECT_KEY env)');
  console.log('  --jql <jql>        Custom JQL query for refine command');
  console.log('  --apply            Execute Jira writes (default: propose only)');
  console.log('  --capacity <n>     Sprint capacity in story points (for plan command)');
  console.log('  --velocity <n>     Team velocity in story points (for plan command)');
  console.log('  --sprint <name>    Target sprint name (for plan command)');
  console.log('  --since <duration> Time window for standup, e.g. 24h, 2d (default: 24h)');
  console.log('');
  console.log('Environment variables:');
  console.log('  AZURE_OPENAI_API_ENDPOINT  Azure OpenAI endpoint');
  console.log('  AZURE_OPENAI_MODEL         Azure OpenAI model name');
  console.log('  LOCAL_OPENAI_BASE_URL      Local OpenAI-compatible base URL');
  console.log('  LOCAL_OPENAI_MODEL         Local model name');
  console.log('  LOCAL_OPENAI_API_KEY       Local API key (if required)');
  console.log('  BURGER_MCP_URL             Burger MCP server URL');
  console.log('  JIRA_MCP_URL               Jira MCP server URL (default: http://localhost:3001/mcp)');
  console.log('  JIRA_PROJECT_KEY           Default Jira project key');
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  if (args[0] === 'agile') {
    return parseAgileArgs(args.slice(1));
  }

  const questionParts: string[] = [];
  let userId: string | undefined;
  let isNew = false;
  let verbose = false;
  let local = false;
  let mcpUrl: string | undefined;
  let llm: LlmProvider | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--userId') {
      userId = args[i + 1];
      i++;
    } else if (arg === '--new') {
      isNew = true;
    } else if (arg === '--verbose') {
      verbose = true;
    } else if (arg === '--local') {
      local = true;
    } else if (arg === '--mcp-url') {
      mcpUrl = args[i + 1];
      i++;
    } else if (arg === '--llm') {
      const llmArgument = args[i + 1];
      if (llmArgument === 'azure' || llmArgument === 'local') {
        llm = llmArgument;
      } else {
        console.error(`Error: --llm must be 'azure' or 'local', got '${llmArgument}'`);
        process.exit(1);
      }

      i++;
    } else {
      questionParts.push(arg);
    }
  }

  const question = questionParts.join(' ');

  if (!question) {
    console.error('Error: Question is required');
    process.exit(1);
  }

  return { question, userId, isNew, verbose, local, mcpUrl, llm };
}

function parseAgileArgs(args: string[]): CliArgs {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    process.exit(0);
  }

  const subcommand = args[0];
  if (subcommand !== 'refine' && subcommand !== 'plan' && subcommand !== 'standup') {
    console.error(`Error: Unknown agile subcommand '${subcommand}'. Must be one of: refine, plan, standup`);
    process.exit(1);
  }

  const remaining = args.slice(1);
  const defaultProject = process.env.JIRA_PROJECT_KEY ?? 'AP';
  let project = defaultProject;
  let apply = false;
  let verbose = false;
  let jql: string | undefined;
  let capacity: number | undefined;
  let velocity: number | undefined;
  let sprint: string | undefined;
  let since = '24h';
  let mcpUrl: string | undefined;
  let llm: LlmProvider | undefined;

  for (let i = 0; i < remaining.length; i++) {
    const arg = remaining[i];
    if (arg === '--project') {
      project = remaining[i + 1];
      i++;
    } else if (arg === '--apply') {
      apply = true;
    } else if (arg === '--verbose') {
      verbose = true;
    } else if (arg === '--jql') {
      jql = remaining[i + 1];
      i++;
    } else if (arg === '--capacity') {
      capacity = Number(remaining[i + 1]);
      i++;
    } else if (arg === '--velocity') {
      velocity = Number(remaining[i + 1]);
      i++;
    } else if (arg === '--sprint') {
      sprint = remaining[i + 1];
      i++;
    } else if (arg === '--since') {
      since = remaining[i + 1];
      i++;
    } else if (arg === '--mcp-url') {
      mcpUrl = remaining[i + 1];
      i++;
    } else if (arg === '--llm') {
      const llmArgument = remaining[i + 1];
      if (llmArgument === 'azure' || llmArgument === 'local') {
        llm = llmArgument;
      } else {
        console.error(`Error: --llm must be 'azure' or 'local', got '${llmArgument}'`);
        process.exit(1);
      }

      i++;
    }
  }

  const command: AgileCommand = { type: subcommand, project, apply, verbose, jql, capacity, velocity, sprint, since };

  let question = '';
  if (subcommand === 'refine') {
    const effectiveJql = jql ?? `project=${project} AND statusCategory != Done ORDER BY Rank ASC`;
    question = `Perform backlog refinement for project ${project}. Use JQL: "${effectiveJql}". ${apply ? 'Apply the changes to Jira.' : 'Propose changes only - do not update Jira.'}`;
  } else if (subcommand === 'plan') {
    const capacityText = capacity ? ` with capacity of ${capacity} story points` : '';
    const velocityText = velocity ? ` and team velocity of ${velocity} story points` : '';
    const sprintText = sprint ? ` for sprint "${sprint}"` : '';
    question = `Create a sprint plan for project ${project}${sprintText}${capacityText}${velocityText}. ${apply ? 'Apply story point updates to Jira.' : 'Propose the sprint plan only - do not update Jira.'}`;
  } else {
    question = `Generate a daily standup summary for project ${project} covering the last ${since}. ${apply ? 'Add status comments to Jira issues.' : 'Propose the standup report only - do not update Jira.'}`;
  }

  return {
    question,
    isNew: true,
    verbose,
    local: false,
    mcpUrl: mcpUrl ?? process.env.JIRA_MCP_URL ?? 'http://localhost:3001/mcp',
    llm,
    command,
  };
}

async function getSessionPath(prefix = 'burger'): Promise<string> {
  const userDataDirectory = path.join(os.homedir(), '.agent-cli');
  await fs.mkdir(userDataDirectory, { recursive: true });
  return path.join(userDataDirectory, `${prefix}-agent-cli.json`);
}

async function loadSession(prefix = 'burger'): Promise<SessionData> {
  try {
    const sessionPath = await getSessionPath(prefix);
    const content = await fs.readFile(sessionPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return { history: [] };
  }
}

async function saveSession(session: SessionData, prefix = 'burger'): Promise<void> {
  try {
    const sessionPath = await getSessionPath(prefix);
    await fs.writeFile(sessionPath, JSON.stringify(session, null, 2));
  } catch (error) {
    console.error('Failed to save session:', error);
  }
}

function convertHistoryToMessages(history: SessionData['history']): BaseMessage[] {
  return history.map((message) =>
    message.type === 'human' ? new HumanMessage(message.content) : new AIMessage(message.content),
  );
}

function resolveLlmProvider(explicitLlm?: LlmProvider): LlmProvider {
  if (explicitLlm) return explicitLlm;
  const hasAzureEnvironment = Boolean(process.env.AZURE_OPENAI_API_ENDPOINT);
  const hasLocalEnvironment = Boolean(process.env.LOCAL_OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL);
  if (hasLocalEnvironment && !hasAzureEnvironment) return 'local';
  if (hasAzureEnvironment) return 'azure';
  return 'local';
}

function createLlmModel(provider: LlmProvider) {
  if (provider === 'local') {
    const baseURL = process.env.LOCAL_OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL;
    const modelName = process.env.LOCAL_OPENAI_MODEL ?? 'phi-3.5-mini';
    const apiKey = process.env.LOCAL_OPENAI_API_KEY ?? 'local';

    if (!baseURL) {
      console.error('Error: LOCAL_OPENAI_BASE_URL (or OPENAI_BASE_URL) is required for --llm local');
      console.error('Set it to your local OpenAI-compatible endpoint, e.g.:');
      console.error('  LOCAL_OPENAI_BASE_URL=http://localhost:5273/v1');
      process.exit(1);
    }

    console.log(`Using local LLM: ${modelName} at ${baseURL}`);
    return new ChatOpenAI({
      configuration: { baseURL },
      modelName,
      apiKey,
      streaming: true,
    });
  }

  const azureEndpoint = process.env.AZURE_OPENAI_API_ENDPOINT;
  if (!azureEndpoint) {
    console.error('Error: AZURE_OPENAI_API_ENDPOINT is required for --llm azure');
    console.error('Set up Azure credentials by running: az login');
    console.error('Or use --llm local with LOCAL_OPENAI_BASE_URL for a local LLM endpoint.');
    process.exit(1);
  }

  console.log(`Using Azure OpenAI: ${process.env.AZURE_OPENAI_MODEL ?? 'gpt-5-mini'} at ${azureEndpoint}`);
  const getToken = getBearerTokenProvider(new DefaultAzureCredential(), 'https://cognitiveservices.azure.com/.default');
  return new ChatOpenAI({
    configuration: { baseURL: azureEndpoint },
    modelName: process.env.AZURE_OPENAI_MODEL ?? 'gpt-5-mini',
    streaming: true,
    useResponsesApi: true,
    apiKey: getToken,
  });
}

export async function run() {
  const { question, userId, isNew, verbose, local, mcpUrl, llm, command } = parseArgs();

  const isAgile = command !== undefined;
  const sessionPrefix = isAgile ? `agile-${command?.type}` : 'burger';

  const localBurgerEndpoint = 'http://localhost:3000/mcp';
  const resolvedMcpUrl = mcpUrl ?? (local ? localBurgerEndpoint : (process.env.BURGER_MCP_URL ?? localBurgerEndpoint));

  let client: Client | undefined;

  try {
    let session: SessionData;
    if (isNew) {
      session = { history: [], userId };
    } else {
      session = await loadSession(sessionPrefix);
      if (userId && session.userId !== userId) {
        session.userId = userId;
      }
    }

    const provider = resolveLlmProvider(llm);
    const model = createLlmModel(provider);

    const clientName = isAgile ? 'jira-mcp' : 'burger-mcp';
    client = new Client({ name: clientName, version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(resolvedMcpUrl));
    await client.connect(transport);
    console.log(`Connected to MCP server at ${resolvedMcpUrl}`);

    const tools = await loadMcpTools(clientName, client);
    console.log(`Loaded ${tools.length} tools from MCP server`);

    const systemPrompt = isAgile
      ? buildAgileSystemPrompt(command.type, command.apply)
      : burgerAgentSystemPrompt + (session.userId ? `\n\nUser ID: ${session.userId}` : '');

    const agent = createAgent({
      model,
      tools,
      systemPrompt,
    });

    const chatHistory = convertHistoryToMessages(session.history);

    if (isAgile && !command.apply) {
      console.log('\n[PROPOSE MODE] No Jira writes will be performed. Use --apply to execute changes.\n');
    }

    console.log('Thinking...\n');

    const eventStream = agent.streamEvents(
      { messages: [...chatHistory, new HumanMessage(question)] },
      { version: 'v2' },
    );

    let step = 0;
    for await (const event of eventStream) {
      const { data } = event;
      if (event.event === 'on_chat_model_stream' && data?.chunk?.content?.length > 0) {
        const { text } = data.chunk.content[0];
        process.stdout.write(text);
      } else if (event.event === 'on_tool_end') {
        if (verbose) {
          if (step === 0) {
            console.log('--------------------');
            console.log('Intermediate steps');
            console.log('--------------------');
          }

          step++;
          console.log(`*** Step ${step} ***`);
          console.log(`Tool: ${event.name}`);
          if (data?.input?.input) {
            console.log(`Input:`, data.input.input);
          }

          if (data?.output?.content) {
            console.log(`Output:`, data.output.content);
          }

          console.log('--------------------\n');
        }
      } else if (
        event.event === 'on_chain_end' &&
        event.name === 'RunnableSequence' &&
        data.output?.content.length > 0
      ) {
        const finalContent = data.output.content[0].text;
        if (finalContent) {
          session.history.push({ type: 'human', content: question }, { type: 'ai', content: finalContent });
          await saveSession(session, sessionPrefix);
        }
      }
    }
  } catch (_error: unknown) {
    const error = _error as Error;
    console.error(`Error when processing request: ${error.message}`);
    process.exitCode = 1;
  }

  if (client) {
    try {
      await client.close();
    } catch (error) {
      console.error('Error closing MCP client:', error);
    }
  }

  process.exitCode = 0;
}
