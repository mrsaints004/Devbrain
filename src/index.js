import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { log } from './logger.js';
import { loadAllModels } from './models.js';
import { indexCodebase } from './rag/indexer.js';
import { createServer } from './server.js';
import { startProvider } from './p2p/provider.js';
import { startWatcher, stopWatcher, onFileChange } from './watcher/monitor.js';

const args = process.argv.slice(2);
function getArg(name, defaultValue) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultValue;
}

const codebasePath = resolve(getArg('path', '.'));
const port = parseInt(getArg('port', '3000'), 10);
const workspace = getArg('workspace', 'devbrain-default');
const skipP2P = args.includes('--no-p2p');
const watchMode = args.includes('--watch');

async function main() {
  console.log('\n  DevBrain v2.0.0 — Offline Code Intelligence (QVAC SDK)\n');

  log('startup', { codebasePath, port, workspace, watchMode, version: '2.0.0' });

  if (!existsSync(codebasePath)) {
    console.error(`Error: path does not exist: ${codebasePath}`);
    process.exit(1);
  }

  // Load core models (LLM + embeddings) — these are required
  console.log('  Loading core models...');
  try {
    await loadAllModels();
    console.log('  Core models loaded (vision/STT/TTS loading in background).');
  } catch (err) {
    console.error(`  Model loading failed: ${err.message}`);
  }

  // Index codebase
  console.log(`  Indexing: ${codebasePath}`);
  try {
    const indexResult = await indexCodebase(codebasePath, workspace);
    console.log(`  Indexed ${indexResult.filesCount} files (${indexResult.chunksCount} chunks)`);
  } catch (err) {
    console.error(`  Indexing failed: ${err.message}`);
  }

  // HTTP server — start immediately, don't wait for optional models
  const app = createServer({ codebasePath, workspace });
  const httpServer = createHttpServer(app);
  await new Promise((resolve, reject) => {
    httpServer.listen(port, '0.0.0.0', () => resolve());
    httpServer.on('error', reject);
  });
  console.log(`  Server: http://localhost:${port}`);

  // File watcher
  if (watchMode) {
    startWatcher(codebasePath, workspace);
    onFileChange((change) => {
      if (app.broadcastFileChange) app.broadcastFileChange(change);
    });
    console.log('  Watcher: active (code smell detection enabled)');
  }

  // P2P
  if (!skipP2P) {
    startProvider({ workspace, codebasePath }).catch((err) => {
      console.error(`  P2P error: ${err.message}`);
    });
    console.log('  P2P: provider starting...');
  }

  console.log('\n  Ready. Open http://localhost:3000\n');
}

process.on('SIGINT', () => {
  stopWatcher();
  log('shutdown', { reason: 'SIGINT' });
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopWatcher();
  log('shutdown', { reason: 'SIGTERM' });
  process.exit(0);
});

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
