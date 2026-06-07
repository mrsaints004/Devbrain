import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { log } from './logger.js';
import { loadAllModels } from './models.js';
import { indexCodebase } from './rag/indexer.js';
import { createServer } from './server.js';
import { startProvider } from './p2p/provider.js';
import { startWatcher, stopWatcher, onFileChange } from './watcher/monitor.js';

// Parse CLI args
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
  console.log(`
╔══════════════════════════════════════════════════╗
║              DevBrain v2.0.0                     ║
║   Offline Code Intelligence Platform            ║
║   Powered by QVAC SDK — 100% Local AI           ║
╠══════════════════════════════════════════════════╣
║  Multi-Agent | RAG | P2P | Multimodal | Secure  ║
╚══════════════════════════════════════════════════╝
`);

  log('startup', { codebasePath, port, workspace, watchMode, version: '2.0.0' });

  if (!existsSync(codebasePath)) {
    console.error(`Error: Codebase path does not exist: ${codebasePath}`);
    process.exit(1);
  }

  // Step 1: Load models (Psy + community models)
  console.log('[1/5] Loading models (Psy, Vision, TTS, STT, Embeddings)...');
  let modelsLoaded = false;
  try {
    await loadAllModels();
    console.log('      All available models loaded successfully.');
    modelsLoaded = true;
  } catch (err) {
    console.error('      Model loading partially failed:', err.message);
    console.error('      Server will start with available models.');
    modelsLoaded = true; // Continue with whatever loaded
  }

  // Step 2: Index codebase
  if (modelsLoaded) {
    console.log(`[2/5] Indexing codebase: ${codebasePath}`);
    try {
      const indexResult = await indexCodebase(codebasePath, workspace);
      console.log(`      Indexed ${indexResult.filesCount} files (${indexResult.chunksCount} chunks)`);
    } catch (err) {
      console.error('      Indexing failed:', err.message);
    }
  } else {
    console.log('[2/5] Skipping indexing (no embedding model)');
  }

  // Step 3: Start HTTP server
  console.log(`[3/5] Starting HTTP server on port ${port}...`);
  const app = createServer({ codebasePath, workspace });
  const httpServer = createHttpServer(app);
  await new Promise((resolve, reject) => {
    httpServer.listen(port, '0.0.0.0', () => {
      console.log(`      Server running at http://localhost:${port}`);
      console.log(`      (Accessible on LAN for mobile testing)`);
      resolve();
    });
    httpServer.on('error', reject);
  });

  // Step 4: Start file watcher (if --watch mode)
  if (watchMode) {
    console.log('[4/5] Starting file watcher (real-time re-indexing)...');
    startWatcher(codebasePath, workspace);
    onFileChange((change) => {
      if (app.broadcastFileChange) {
        app.broadcastFileChange(change);
      }
    });
  } else {
    console.log('[4/5] File watcher disabled (use --watch to enable)');
  }

  // Step 5: Start P2P provider
  if (!skipP2P) {
    console.log('[5/5] Starting P2P provider (Holepunch DHT)...');
    startProvider({ workspace, codebasePath }).catch((err) => {
      console.error('      P2P provider error:', err.message);
    });
  } else {
    console.log('[5/5] P2P provider skipped (--no-p2p)');
  }

  console.log(`
╔══════════════════════════════════════════════════╗
║  DevBrain is ready!                              ║
╠══════════════════════════════════════════════════╣
║  Web UI:     http://localhost:${port}               ║
║  API:        http://localhost:${port}/api/query      ║
║  Stream:     http://localhost:${port}/api/query/stream║
║  Status:     http://localhost:${port}/api/status     ║
║  Stats:      http://localhost:${port}/api/stats      ║
╚══════════════════════════════════════════════════╝
`);
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down DevBrain...');
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
