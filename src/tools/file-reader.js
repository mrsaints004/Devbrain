import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

export const schema = z.object({
  path: z.string().describe('Absolute or relative path to the file to read'),
  startLine: z.number().optional().describe('Start reading from this line (1-based)'),
  endLine: z.number().optional().describe('Stop reading at this line (1-based, inclusive)'),
});

export const definition = {
  name: 'read_file',
  description: 'Read the contents of a file. Can optionally read a specific line range.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to read' },
      startLine: { type: 'number', description: 'Start line (1-based, optional)' },
      endLine: { type: 'number', description: 'End line (1-based, inclusive, optional)' },
    },
    required: ['path'],
  },
};

export function execute({ path: filePath, startLine, endLine }, codebasePath) {
  const resolved = resolve(codebasePath, filePath);

  if (!existsSync(resolved)) {
    return { error: `File not found: ${filePath}` };
  }

  const stat = statSync(resolved);
  if (stat.isDirectory()) {
    return { error: `Path is a directory, not a file: ${filePath}` };
  }

  if (stat.size > 1_000_000) {
    return { error: `File too large (${(stat.size / 1024).toFixed(0)}KB). Use line range.` };
  }

  const content = readFileSync(resolved, 'utf-8');
  const lines = content.split('\n');

  if (startLine || endLine) {
    const start = (startLine || 1) - 1;
    const end = endLine || lines.length;
    const slice = lines.slice(start, end);
    return {
      path: filePath,
      lines: { start: start + 1, end: Math.min(end, lines.length), total: lines.length },
      content: slice.join('\n'),
    };
  }

  return { path: filePath, lines: { total: lines.length }, content };
}
