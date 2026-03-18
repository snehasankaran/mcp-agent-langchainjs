import { Buffer } from 'node:buffer';
import { jiraBaseUrl, jiraEmail, jiraApiToken, jiraStoryPointsFieldId } from './config.js';

const authHeader = `Basic ${Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString('base64')}`;

let cachedStoryPointsFieldId: string | undefined;

async function jiraFetch(path: string, options?: RequestInit): Promise<unknown> {
  const url = `${jiraBaseUrl}/rest/api/3${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Jira API error ${response.status} for ${path}: ${text}`);
  }

  if (response.status === 204) {
    return undefined;
  }

  return response.json();
}

async function resolveStoryPointsFieldId(): Promise<string> {
  if (cachedStoryPointsFieldId) {
    return cachedStoryPointsFieldId;
  }

  if (jiraStoryPointsFieldId) {
    cachedStoryPointsFieldId = jiraStoryPointsFieldId;
    return cachedStoryPointsFieldId;
  }

  const fields = (await jiraFetch('/field')) as Array<{ id: string; name: string }>;
  const storyPointsField = fields.find((f) => f.name === 'Story Points');
  cachedStoryPointsFieldId = storyPointsField?.id ?? 'story_points';
  return cachedStoryPointsFieldId;
}

export type JiraIssue = {
  key: string;
  summary: string;
  status: string;
  assignee?: string;
  storyPoints?: number;
  updated: string;
  description?: string;
  labels?: string[];
  priority?: string;
  issuetype?: string;
};

function extractIssueFields(issue: Record<string, unknown>, storyPointsField?: string): JiraIssue {
  const fields = issue.fields as Record<string, unknown>;
  const {
    assignee: assigneeObject,
    status: statusObject,
    priority: priorityObject,
    issuetype: issuetypeObject,
  } = fields as Record<string, Record<string, unknown> | undefined>;
  const statusCategoryObject = statusObject?.statusCategory as Record<string, unknown> | undefined;

  let storyPoints: number | undefined;
  if (storyPointsField && fields?.[storyPointsField] !== undefined && fields?.[storyPointsField] !== null) {
    storyPoints = fields[storyPointsField] as number;
  }

  return {
    key: issue.key as string,
    summary: fields?.summary as string,
    status: (statusObject?.name as string) ?? (statusCategoryObject?.name as string) ?? 'Unknown',
    assignee: assigneeObject?.displayName as string | undefined,
    storyPoints,
    updated: fields?.updated as string,
    description:
      typeof fields?.description === 'string'
        ? fields.description
        : fields?.description
          ? JSON.stringify(fields.description)
          : undefined,
    labels: fields?.labels as string[] | undefined,
    priority: priorityObject?.name as string | undefined,
    issuetype: issuetypeObject?.name as string | undefined,
  };
}

export async function searchIssues(
  jql: string,
  maxResults = 50,
  fields: string[] = [],
): Promise<{ total: number; issues: JiraIssue[] }> {
  const storyPointsField = await resolveStoryPointsFieldId();
  const defaultFields = [
    'summary',
    'status',
    'assignee',
    'updated',
    'labels',
    'priority',
    'issuetype',
    storyPointsField,
  ];
  const requestedFields = fields.length > 0 ? fields : defaultFields;

  const body = { jql, maxResults, fields: requestedFields };
  const result = (await jiraFetch('/search', {
    method: 'POST',
    body: JSON.stringify(body),
  })) as { total: number; issues: Array<Record<string, unknown>> };

  return {
    total: result.total,
    issues: result.issues.map((issue) => extractIssueFields(issue, storyPointsField)),
  };
}

export async function getIssue(key: string, fields: string[] = []): Promise<JiraIssue> {
  const storyPointsField = await resolveStoryPointsFieldId();
  const defaultFields = [
    'summary',
    'status',
    'assignee',
    'updated',
    'description',
    'labels',
    'priority',
    'issuetype',
    storyPointsField,
  ];
  const requestedFields = fields.length > 0 ? fields : defaultFields;

  const query = `?fields=${requestedFields.join(',')}`;
  const issue = (await jiraFetch(`/issue/${key}${query}`)) as Record<string, unknown>;
  return extractIssueFields(issue, storyPointsField);
}

export async function updateIssue(key: string, fields: Record<string, unknown>): Promise<void> {
  const storyPointsField = await resolveStoryPointsFieldId();

  const resolvedFields: Record<string, unknown> = {};
  for (const [fieldKey, value] of Object.entries(fields)) {
    if (fieldKey === 'storyPoints' || fieldKey === 'story_points') {
      resolvedFields[storyPointsField] = value;
    } else {
      resolvedFields[fieldKey] = value;
    }
  }

  await jiraFetch(`/issue/${key}`, {
    method: 'PUT',
    body: JSON.stringify({ fields: resolvedFields }),
  });
}

export async function addComment(key: string, body: string): Promise<{ id: string }> {
  const result = (await jiraFetch(`/issue/${key}/comment`, {
    method: 'POST',
    body: JSON.stringify({
      body: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: body }],
          },
        ],
      },
    }),
  })) as { id: string };
  return result;
}
