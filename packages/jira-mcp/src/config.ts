import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(currentDirectory, '../../../.env'), quiet: true });

export const jiraBaseUrl = process.env.JIRA_BASE_URL ?? '';
export const jiraEmail = process.env.JIRA_EMAIL ?? '';
export const jiraApiToken = process.env.JIRA_API_TOKEN ?? '';
export const jiraProjectKey = process.env.JIRA_PROJECT_KEY ?? 'AP';
export const jiraStoryPointsFieldId = process.env.JIRA_STORY_POINTS_FIELD_ID ?? '';
export const port = process.env.PORT ?? '3001';
