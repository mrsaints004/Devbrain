import express from 'express';
import { join } from 'node:path';
import { handleQuery } from './agents/orchestrator.js';
import { indexCodebase, getIndexStatus } from './rag/indexer.js';
import { getStatus as getModelStatus, loadAllModels, hasModel } from './models.js';
import { getEntries, getSessionStats } from './logger.js';
import { getProviderStatus } from './p2p/provider.js';
import { getWatcherStatus, onCodeSmell } from './watcher/monitor.js';
import { synthesizeSpeech, transcribeAudio } from './agents/vision.js';
import { runBenchmark } from './agents/benchmark.js';

export function createServer({ codebasePath, workspace }) {
  const app = express();

  app.use(express.json({ limit: '20mb' })); // Allow image uploads
  app.use(express.static(join(import.meta.dirname, '..', 'web')));

  let queryLock = Promise.resolve();
  function withLock(fn) {
    const prev = queryLock;
    let resolve;
    queryLock = new Promise((r) => { resolve = r; });
    return prev.then(fn).finally(resolve);
  }

  // Query (blocking)
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

  // Query (SSE streaming)
  app.post('/api/query/stream', async (req, res) => {
    const { query, imageData, imageMimeType } = req.body;
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Missing "query" field' });
    }

    // /index command
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

    // SSE
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

  app.post('/api/index', async (req, res) => {
    const targetPath = req.body.path || codebasePath;
    try {
      const result = await indexCodebase(targetPath, workspace);
      if (req.body.path) {
        app.activePath = req.body.path;
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Status + code health
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

  app.post('/api/models/load', async (req, res) => {
    try {
      const result = await loadAllModels();
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

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

  app.get('/api/benchmark', async (req, res) => {
    await withLock(async () => {
      try {
        const result = await runBenchmark();
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
  });

  app.get('/api/logs', (req, res) => {
    const entries = getEntries();
    const limit = parseInt(req.query.limit) || 100;
    res.json(entries.slice(-limit));
  });

  app.get('/api/stats', (req, res) => {
    res.json(getSessionStats());
  });

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

  app.broadcastFileChange = (change) => {
    const data = JSON.stringify(change);
    for (const client of fileChangeClients) {
      client.write(`data: ${data}\n\n`);
    }
  };

  onCodeSmell((smell) => {
    if (smell.clean) {
      codeHealth.clean++;
      const data = JSON.stringify({ type: 'smell_clean', filePath: smell.filePath });
      for (const client of fileChangeClients) {
        client.write(`data: ${data}\n\n`);
      }
    } else {
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
