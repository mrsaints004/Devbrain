import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { chunkCode, isCodeFile } from './chunker.js';
import { ingest } from './store.js';
import { log } from '../logger.js';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', '__pycache__',
  '.cache', 'coverage', '.nyc_output', 'vendor', 'target',
  '.svn', '.hg', 'logs', '.DS_Store',
]);

const MAX_FILE_SIZE = 500_000; // 500KB

function walkDir(dir, basePath, files = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry) || entry.startsWith('.')) continue;

    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      walkDir(fullPath, basePath, files);
    } else if (stat.isFile() && stat.size <= MAX_FILE_SIZE && isCodeFile(entry)) {
      files.push(fullPath);
    }
  }
  return files;
}

let indexedState = { filesCount: 0, chunksCount: 0, codebasePath: null, indexedAt: null };

export function getIndexStatus() {
  return { ...indexedState };
}

export async function indexCodebase(codebasePath, workspace) {
  log('index_start', { codebasePath });

  const files = walkDir(codebasePath, codebasePath);
  log('index_files_found', { count: files.length });

  const allChunks = [];
  for (const filePath of files) {
    try {
      const source = readFileSync(filePath, 'utf-8');
      const relPath = relative(codebasePath, filePath);
      const chunks = chunkCode(source, relPath);
      allChunks.push(...chunks);
    } catch {
      // skip unreadable files
    }
  }

  log('index_chunks_created', { count: allChunks.length });

  // Format chunks as documents for RAG ingestion: prefix with file path, line info, and label
  const documents = allChunks.map(
    (c) => `[${c.filePath}:${c.startLine}-${c.endLine}]${c.label ? ` (${c.label})` : ''}\n${c.text}`
  );

  if (documents.length === 0) {
    log('index_empty', { message: 'No code files found to index' });
    indexedState = { filesCount: 0, chunksCount: 0, codebasePath, indexedAt: new Date().toISOString() };
    return indexedState;
  }

  // Ingest in batches to avoid memory issues
  const BATCH_SIZE = 100;
  for (let i = 0; i < documents.length; i += BATCH_SIZE) {
    const batch = documents.slice(i, i + BATCH_SIZE);
    await ingest(batch, workspace);
    log('index_batch', { batch: Math.floor(i / BATCH_SIZE) + 1, total: Math.ceil(documents.length / BATCH_SIZE) });
  }

  indexedState = {
    filesCount: files.length,
    chunksCount: allChunks.length,
    codebasePath,
    indexedAt: new Date().toISOString(),
  };

  log('index_complete', indexedState);
  return indexedState;
}
