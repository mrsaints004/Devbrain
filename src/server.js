import express from 'express';
import { join } from 'node:path';
import { handleQuery } from './agents/orchestrator.js';
import { indexCodebase, getIndexStatus } from './rag/indexer.js';
import { getStatus as getModelStatus, loadAllModels, hasModel } from './models.js';
import { getEntries, getSessionStats } from './logger.js';
import { getProviderStatus } from './p2p/provider.js';
import { getWatcherStatus } from './watcher/monitor.js';
import { synthesizeSpeech } from './agents/vision.js';

export function createServer({ codebasePath, workspace }) {
  const app = express();

  app.use(express.json({ limit: '20mb' })); // Allow image uploads
  app.use(express.static(join(import.meta.dirname, '..', 'web')));

  // Simple request queue to prevent model-busy rejections
  let queryLock = Promise.resolve();
  function withLock(fn) {
    const prev = queryLock;
    let resolve;
    queryLock = new Promise((r) => { resolve = r; });
    return prev.then(fn).finally(resolve);
  }

  // === QUERY ENDPOINTS ===

  // Standard query (blocking)
  app.post('/api/query', async (req, res) => {
    const { query, imageData, imageMimeType } = req.body;
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Missing "query" field' });
    }

    await withLock(async () => {
      try {
        const result = await handleQuery(query, {
          workspace,
          codebasePath,
          imageData,
          imageMimeType,
        });
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
  });

  // Streaming query via Server-Sent Events
  app.post('/api/query/stream', async (req, res) => {
    const { query, imageData, imageMimeType } = req.body;
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Missing "query" field' });
    }

    // Set up SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    res.write(`data: ${JSON.stringify({ type: 'start', query })}\n\n`);

    await withLock(async () => {
      try {
        const result = await handleQuery(query, {
          workspace,
          codebasePath,
          stream: true,
          imageData,
          imageMimeType,
          onProgress: (progress) => {
            res.write(`data: ${JSON.stringify({ type: 'progress', ...progress })}\n\n`);
          },
          onToken: (token) => {
            res.write(`data: ${JSON.stringify({ type: 'token', token })}\n\n`);
          },
        });

        // Send final result with metadata
        res.write(`data: ${JSON.stringify({
          type: 'done',
          intent: result.intent,
          steps: result.steps,
          durationMs: result.durationMs,
          security: result.security,
        })}\n\n`);
      } catch (err) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
      }
    });

    res.end();
  });

  // === INDEX ENDPOINTS ===

  app.post('/api/index', async (req, res) => {
    const targetPath = req.body.path || codebasePath;
    try {
      const result = await indexCodebase(targetPath, workspace);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // === STATUS ENDPOINTS ===

  app.get('/api/status', (req, res) => {
    res.json({
      models: getModelStatus(),
      index: getIndexStatus(),
      p2p: getProviderStatus(),
      watcher: getWatcherStatus(),
      session: getSessionStats(),
    });
  });

  // === MODEL ENDPOINTS ===

  app.post('/api/models/load', async (req, res) => {
    try {
      const result = await loadAllModels();
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // === TTS ENDPOINT ===

  app.post('/api/tts', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Missing "text" field' });
    if (!hasModel('tts')) return res.status(503).json({ error: 'TTS model not loaded' });

    try {
      const audio = await synthesizeSpeech(text);
      if (Buffer.isBuffer(audio)) {
        res.set('Content-Type', 'audio/wav');
        res.send(audio);
      } else {
        res.json({ audio: audio });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // === LOGS ENDPOINTS ===

  app.get('/api/logs', (req, res) => {
    const entries = getEntries();
    const limit = parseInt(req.query.limit) || 100;
    res.json(entries.slice(-limit));
  });

  app.get('/api/stats', (req, res) => {
    res.json(getSessionStats());
  });

  // === FILE CHANGE EVENTS (SSE) ===

  const fileChangeClients = new Set();

  app.get('/api/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    fileChangeClients.add(res);
    req.on('close', () => fileChangeClients.delete(res));
  });

  // Broadcast file changes to connected clients
  app.broadcastFileChange = (change) => {
    const data = JSON.stringify(change);
    for (const client of fileChangeClients) {
      client.write(`data: ${data}\n\n`);
    }
  };

  // === SPA FALLBACK ===

  const indexHtml = join(import.meta.dirname, '..', 'web', 'index.html');
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      res.sendFile(indexHtml);
    } else {
      next();
    }
  });

  return app;
}
