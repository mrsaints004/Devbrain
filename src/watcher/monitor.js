import { watch } from 'chokidar';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { chunkCode, isCodeFile } from '../rag/chunker.js';
import { ingest } from '../rag/store.js';
import { log, logAgent } from '../logger.js';
import { detectSmells } from '../agents/smell.js';

let watcher = null;
let changeQueue = [];
let debounceTimer = null;
let isReindexing = false;
const DEBOUNCE_MS = 5000;

// Event emitter for UI notifications
let onChangeCallback = null;
let onSmellCallback = null;

export function onFileChange(callback) {
  onChangeCallback = callback;
}

export function onCodeSmell(callback) {
  onSmellCallback = callback;
}

export function startWatcher(codebasePath, workspace) {
  if (watcher) return;

  const ignored = [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/__pycache__/**',
    '**/coverage/**',
    '**/logs/**',
    '**/.DS_Store',
    '**/*.log',
    '**/.qvac/**',
    '**/package-lock.json',
  ];

  log('watcher_start', { codebasePath });

  watcher = watch(codebasePath, {
    ignored,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500 },
  });

  watcher.on('change', (filePath) => handleChange('modified', filePath, codebasePath, workspace));
  watcher.on('add', (filePath) => handleChange('added', filePath, codebasePath, workspace));
  watcher.on('unlink', (filePath) => handleChange('deleted', filePath, codebasePath, workspace));

  watcher.on('ready', () => {
    log('watcher_ready', { message: 'File watcher ready' });
    console.log('  [Watcher] Monitoring codebase for changes...');
  });

  watcher.on('error', (err) => {
    log('watcher_error', { error: err.message });
  });
}

function handleChange(type, filePath, codebasePath, workspace) {
  const relPath = relative(codebasePath, filePath);

  // Only process code files
  if (type !== 'deleted' && !isCodeFile(filePath)) return;

  changeQueue.push({ type, filePath, relPath, timestamp: Date.now() });

  // Notify UI
  if (onChangeCallback) {
    onChangeCallback({ type, relPath, timestamp: Date.now() });
  }

  // Debounce re-indexing
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => processQueue(codebasePath, workspace), DEBOUNCE_MS);
}

async function processQueue(codebasePath, workspace) {
  if (changeQueue.length === 0) return;

  // Prevent concurrent re-indexing (avoids saturating the embedding model)
  if (isReindexing) {
    // Reschedule for later
    debounceTimer = setTimeout(() => processQueue(codebasePath, workspace), DEBOUNCE_MS);
    return;
  }

  isReindexing = true;
  const batch = [...changeQueue];
  changeQueue = [];

  const modifiedFiles = batch.filter((c) => c.type !== 'deleted');
  logAgent('watcher', 'reindex', { filesCount: modifiedFiles.length });

  const documents = [];
  for (const { filePath, relPath } of modifiedFiles) {
    try {
      const source = readFileSync(filePath, 'utf-8');
      const chunks = chunkCode(source, relPath);
      for (const chunk of chunks) {
        documents.push(`[${chunk.filePath}:${chunk.startLine}-${chunk.endLine}]\n${chunk.text}`);
      }
    } catch {
      // file may have been deleted between detection and read
    }
  }

  if (documents.length > 0) {
    try {
      await ingest(documents, workspace);
      logAgent('watcher', 'reindex_done', { documents: documents.length });
      console.log(`  [Watcher] Re-indexed ${modifiedFiles.length} files (${documents.length} chunks)`);
    } catch (err) {
      logAgent('watcher', 'reindex_error', { error: err.message });
    }
  }

  isReindexing = false;

  // Run code smell detection on modified files (non-blocking)
  if (onSmellCallback) {
    for (const { filePath, relPath } of modifiedFiles) {
      try {
        const source = readFileSync(filePath, 'utf-8');
        detectSmells(relPath, source).then((issues) => {
          if (onSmellCallback) {
            if (issues) {
              onSmellCallback({ filePath: relPath, issues, timestamp: Date.now() });
            } else {
              // File is clean — broadcast for health tracking
              onSmellCallback({ filePath: relPath, clean: true, timestamp: Date.now() });
            }
          }
        }).catch(() => {});
      } catch {
        // file may have been deleted
      }
    }
  }
}

export function stopWatcher() {
  if (watcher) {
    watcher.close();
    watcher = null;
    log('watcher_stop', { message: 'File watcher stopped' });
  }
}

export function getWatcherStatus() {
  return {
    running: !!watcher,
    queueSize: changeQueue.length,
  };
}
