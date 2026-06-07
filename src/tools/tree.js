import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { z } from 'zod';

export const schema = z.object({
  path: z.string().optional().default('.').describe('Directory path to generate tree for'),
  depth: z.number().optional().default(3).describe('Maximum depth to traverse'),
});

export const definition = {
  name: 'directory_tree',
  description: 'Generate a directory tree structure showing files and folders.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path (default: root)' },
      depth: { type: 'number', description: 'Max depth (default 3)' },
    },
    required: [],
  },
};

const IGNORE = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', '__pycache__',
  'coverage', 'vendor', 'target', '.DS_Store',
]);

function buildTree(dir, prefix, currentDepth, maxDepth) {
  if (currentDepth > maxDepth) return '  '.repeat(currentDepth) + '...\n';

  let entries;
  try { entries = readdirSync(dir).sort(); } catch { return ''; }

  let output = '';
  const filtered = entries.filter((e) => !IGNORE.has(e) && !e.startsWith('.'));

  for (let i = 0; i < filtered.length; i++) {
    const entry = filtered[i];
    const fullPath = join(dir, entry);
    const isLast = i === filtered.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const nextPrefix = prefix + (isLast ? '    ' : '│   ');

    let stat;
    try { stat = statSync(fullPath); } catch { continue; }

    if (stat.isDirectory()) {
      output += prefix + connector + entry + '/\n';
      output += buildTree(fullPath, nextPrefix, currentDepth + 1, maxDepth);
    } else {
      output += prefix + connector + entry + '\n';
    }
  }
  return output;
}

export function execute({ path: dirPath = '.', depth = 3 }, codebasePath) {
  const resolved = join(codebasePath, dirPath);
  const tree = buildTree(resolved, '', 0, depth);
  return { path: dirPath, tree: relative(codebasePath, resolved) + '/\n' + tree };
}
