import { execSync } from 'node:child_process';
import { z } from 'zod';

export const schema = z.object({
  command: z.enum(['log', 'blame', 'diff', 'status', 'branch']).describe('Git command to run'),
  file: z.string().optional().describe('File path for blame/diff'),
  count: z.number().optional().default(10).describe('Number of log entries'),
});

export const definition = {
  name: 'git_info',
  description: 'Get git information: log, blame, diff, status, or current branch.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', enum: ['log', 'blame', 'diff', 'status', 'branch'], description: 'Git command' },
      file: { type: 'string', description: 'File path (for blame/diff)' },
      count: { type: 'number', description: 'Number of log entries (default 10)' },
    },
    required: ['command'],
  },
};

function run(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: 'utf-8', timeout: 10_000, maxBuffer: 512 * 1024 }).trim();
  } catch (err) {
    return `Error: ${err.message}`;
  }
}

export function execute({ command, file, count = 10 }, codebasePath) {
  switch (command) {
    case 'log':
      return { output: run(`git log --oneline -n ${count}`, codebasePath) };

    case 'blame':
      if (!file) return { error: 'File path required for git blame' };
      return { output: run(`git blame --line-porcelain ${file} | head -100`, codebasePath) };

    case 'diff':
      if (file) {
        return { output: run(`git diff -- ${file}`, codebasePath) };
      }
      return { output: run('git diff', codebasePath) };

    case 'status':
      return { output: run('git status --short', codebasePath) };

    case 'branch':
      return { output: run('git branch --show-current', codebasePath) };

    default:
      return { error: `Unknown git command: ${command}` };
  }
}
