import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { z } from 'zod';

export const schema = z.object({
  pattern: z.string().describe('Glob-like pattern or filename substring to match'),
  contentPattern: z.string().optional().describe('Search for this text inside matching files'),
  maxResults: z.number().optional().default(20).describe('Maximum number of results'),
});

export const definition = {
  name: 'search_files',
  description: 'Search for files by name pattern and optionally grep their content.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Filename pattern to match (e.g. "*.js", "router")' },
      contentPattern: { type: 'string', description: 'Text to search for inside files (optional)' },
      maxResults: { type: 'number', description: 'Max results to return (default 20)' },
    },
    required: ['pattern'],
  },
};

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', '__pycache__', 'coverage', 'vendor', 'target',
]);

function matchesPattern(filename, pattern) {
  if (pattern.startsWith('*.')) {
    return filename.endsWith(pattern.slice(1));
  }
  return filename.toLowerCase().includes(pattern.toLowerCase());
}

function walkAndMatch(dir, basePath, pattern, results, maxResults) {
  if (results.length >= maxResults) return;

  let entries;
  try { entries = readdirSync(dir); } catch { return; }

  for (const entry of entries) {
    if (results.length >= maxResults) return;
    if (IGNORE_DIRS.has(entry) || entry.startsWith('.')) continue;

    const fullPath = join(dir, entry);
    let stat;
    try { stat = statSync(fullPath); } catch { continue; }

    if (stat.isDirectory()) {
      walkAndMatch(fullPath, basePath, pattern, results, maxResults);
    } else if (matchesPattern(entry, pattern)) {
      results.push(relative(basePath, fullPath));
    }
  }
}

export function execute({ pattern, contentPattern, maxResults = 20 }, codebasePath) {
  const matchingFiles = [];
  walkAndMatch(codebasePath, codebasePath, pattern, matchingFiles, contentPattern ? 500 : maxResults);

  if (!contentPattern) {
    return { pattern, matches: matchingFiles.slice(0, maxResults) };
  }

  const grepResults = [];
  for (const relPath of matchingFiles) {
    if (grepResults.length >= maxResults) break;

    try {
      const content = readFileSync(join(codebasePath, relPath), 'utf-8');
      const lines = content.split('\n');
      const matchingLines = [];

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(contentPattern)) {
          matchingLines.push({ line: i + 1, text: lines[i].trim() });
        }
      }

      if (matchingLines.length > 0) {
        grepResults.push({ file: relPath, matches: matchingLines.slice(0, 5) });
      }
    } catch {
      // skip unreadable
    }
  }

  return { pattern, contentPattern, results: grepResults };
}
