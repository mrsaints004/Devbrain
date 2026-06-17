import express from 'express';
import { join } from 'node:path';
import { handleQuery } from './agents/orchestrator.js';
import { indexCodebase, getIndexStatus } from './rag/indexer.js';
import { getStatus as getModelStatus, loadAllModels, hasModel } from './models.js';
import { getEntries, getSessionStats } from './logger.js';
import { getProviderStatus } from './p2p/provider.js';
import { getWatcherStatus, onCodeSmell } from './watcher/monitor.js';
import { synthesizeSpeech, transcribeAudio } from './agents/vision.js';

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
          codebasePath: app.activePath || codebasePath,
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

    // Handle /index command from chat
    const indexMatch = query.match(/^\/index\s+(.+)$/);
    if (indexMatch) {
      const targetPath = indexMatch[1].trim();
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`data: ${JSON.stringify({ type: 'start', query })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'progress', step: 'indexing', message: `Indexing ${targetPath}...` })}\n\n`);
      try {
        const result = await indexCodebase(targetPath, workspace);
        app.activePath = targetPath;
        const msg = `Re-indexed **${targetPath}**\n\n${result.filesCount} files, ${result.chunksCount} chunks indexed. You can now ask questions about this codebase.`;
        res.write(`data: ${JSON.stringify({ type: 'token', token: msg })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done', intent: 'index', steps: [{ agent: 'indexer', action: 'reindex' }], durationMs: 0 })}\n\n`);
      } catch (err) {
        res.write(`data: ${JSON.stringify({ type: 'token', token: `Error indexing: ${err.message}` })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: 'done', intent: 'index', steps: [{ agent: 'indexer', action: 'error' }], durationMs: 0 })}\n\n`);
      }
      res.end();
      return;
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
          codebasePath: app.activePath || codebasePath,
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
      // Update the active codebase path for tool agent
      if (req.body.path) {
        app.activePath = req.body.path;
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // === STATUS ENDPOINTS ===

  // Code health tracking
  const codeHealth = { critical: 0, warning: 0, info: 0, clean: 0 };

  app.get('/api/status', (req, res) => {
    res.json({
      models: getModelStatus(),
      index: getIndexStatus(),
      p2p: getProviderStatus(),
      watcher: getWatcherStatus(),
      session: getSessionStats(),
      codeHealth,
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

  // === STT ENDPOINT ===

  app.post('/api/stt', async (req, res) => {
    const { audio } = req.body; // base64-encoded audio
    if (!audio) return res.status(400).json({ error: 'Missing "audio" field' });
    if (!hasModel('stt')) return res.status(503).json({ error: 'STT model not loaded' });

    try {
      const audioBuffer = Buffer.from(audio, 'base64');
      const text = await transcribeAudio(audioBuffer);
      res.json({ text });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // === TTS ENDPOINT ===

  app.post('/api/tts', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Missing "text" field' });

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

  // Broadcast code smell alerts to connected clients + track health
  onCodeSmell((smell) => {
    if (smell.clean) {
      // File was analyzed and found clean
      codeHealth.clean++;
      const data = JSON.stringify({ type: 'smell_clean', filePath: smell.filePath });
      for (const client of fileChangeClients) {
        client.write(`data: ${data}\n\n`);
      }
    } else {
      // Issues found
      const issueText = (smell.issues || '').toUpperCase();
      if (issueText.includes('CRITICAL')) codeHealth.critical++;
      else if (issueText.includes('WARNING')) codeHealth.warning++;
      else codeHealth.info++;
      const data = JSON.stringify({ type: 'smell', ...smell });
      for (const client of fileChangeClients) {
        client.write(`data: ${data}\n\n`);
      }
      console.log(`  [SmellDetect] Issues in ${smell.filePath}`);
    }
  });

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
