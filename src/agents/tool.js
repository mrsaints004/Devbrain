import * as qvac from '@qvac/sdk';
import { z } from 'zod';
import { getModelId } from '../models.js';
import { logAgent, logInference } from '../logger.js';
import { hardenSystemPrompt, validatePath, filterOutput } from '../security/guard.js';
import * as fileReader from '../tools/file-reader.js';
import * as fileSearch from '../tools/file-search.js';
import * as gitInfo from '../tools/git-info.js';
import * as tree from '../tools/tree.js';

// QVAC tools use Zod schemas + handler functions
function buildTools(codebasePath) {
  return [
    {
      name: 'read_file',
      description: 'Read the contents of a file. Can optionally read a specific line range.',
      parameters: z.object({
        path: z.string().describe('Path to the file to read'),
        startLine: z.number().optional().describe('Start line (1-based, optional)'),
        endLine: z.number().optional().describe('End line (1-based, inclusive, optional)'),
      }),
      handler: async (args) => {
        const pathCheck = validatePath(args.path, codebasePath);
        if (!pathCheck.safe) return { error: `Blocked: ${pathCheck.reason}` };
        return fileReader.execute(args, codebasePath);
      },
    },
    {
      name: 'search_files',
      description: 'Search for files by name pattern and optionally grep their content.',
      parameters: z.object({
        pattern: z.string().describe('Filename pattern to match (e.g. "*.js", "router")'),
        contentPattern: z.string().optional().describe('Text to search for inside files (optional)'),
        maxResults: z.number().optional().describe('Max results to return (default 20)'),
      }),
      handler: async (args) => fileSearch.execute(args, codebasePath),
    },
    {
      name: 'git_info',
      description: 'Get git information: log, blame, diff, status, or current branch.',
      parameters: z.object({
        command: z.enum(['log', 'blame', 'diff', 'status', 'branch']).describe('Git command'),
        file: z.string().optional().describe('File path (for blame/diff)'),
        count: z.number().optional().describe('Number of log entries (default 10)'),
      }),
      handler: async (args) => gitInfo.execute(args, codebasePath),
    },
    {
      name: 'directory_tree',
      description: 'Generate a directory tree structure showing files and folders.',
      parameters: z.object({
        path: z.string().optional().describe('Directory path (default: root)'),
        depth: z.number().optional().describe('Max depth (default 3)'),
      }),
      handler: async (args) => tree.execute(args, codebasePath),
    },
  ];
}

const SYSTEM_PROMPT = hardenSystemPrompt(`You are a tool-calling agent for a code intelligence system.
You have access to these tools to interact with the user's codebase:
- read_file: Read file contents (supports line ranges)
- search_files: Search for files by name or content pattern
- git_info: Get git information (log, blame, diff, status, branch)
- directory_tree: Generate directory tree visualization

Use tools when you need to access the filesystem or git to answer the user's question.
After getting tool results, provide a clear, well-formatted markdown answer.
Always cite file paths and line numbers in your responses.`);

export async function handleWithTools(query, codebasePath, options = {}) {
  const modelId = getModelId('llm');
  if (!modelId) throw new Error('LLM not loaded');

  const { stream = false, onToken } = options;

  logAgent('tool', 'start', { query: query.slice(0, 100) });

  const tools = buildTools(codebasePath);

  const start = Date.now();
  const run = qvac.completion({
    modelId,
    history: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: query },
    ],
    stream: false,
    tools,
    generationParams: {
      temp: 0.2,
      predict: 2048,
    },
  });

  const result = await run.final;
  const durationMs = Date.now() - start;
  let answer = result.contentText || 'No response generated.';

  logInference({
    modelId,
    prompt: `[tool] ${query.slice(0, 80)}`,
    tokensIn: result.stats?.cacheTokens,
    tokensOut: result.stats?.generatedTokens,
    ttft: result.stats?.timeToFirstToken,
    tps: result.stats?.tokensPerSecond,
    durationMs,
    agent: 'tool',
  });

  if (result.toolCalls?.length) {
    logAgent('tool', 'calls_made', {
      count: result.toolCalls.length,
      tools: result.toolCalls.map((tc) => tc.name || tc.function?.name),
    });
  }

  // Filter output BEFORE streaming
  answer = filterOutput(answer);

  // Simulate streaming to callback
  if (stream && onToken && answer) {
    const words = answer.split(' ');
    for (const word of words) {
      onToken(word + ' ');
    }
  }

  logAgent('tool', 'done', { answerLength: answer.length });
  return answer;
}
