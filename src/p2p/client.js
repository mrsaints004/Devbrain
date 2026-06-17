#!/usr/bin/env node
/**
 * DevBrain P2P Client — connects to a remote DevBrain provider
 * via Holepunch DHT and sends queries using delegated inference.
 *
 * Usage:
 *   node src/p2p/client.js --key <provider-public-key> --query "What does this project do?"
 *   node src/p2p/client.js --key <key> --interactive
 *
 * This allows phones, tablets, or other machines to leverage
 * a more powerful device's DevBrain instance for code intelligence.
 *
 * How it works:
 *   The QVAC SDK doesn't have a separate "connect" function.
 *   Instead, you call loadModel() with a `delegate` option containing
 *   the provider's public key. The SDK handles DHT connection internally.
 *   After that, completion() calls are transparently routed to the provider.
 */

import * as qvac from '@qvac/sdk';
import { createInterface } from 'node:readline';

// Parse CLI arguments
const args = process.argv.slice(2);
function getArg(name, defaultValue) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultValue;
}

const providerKey = getArg('key', null);
const singleQuery = getArg('query', null);
const interactive = args.includes('--interactive') || !singleQuery;

if (!providerKey) {
  console.error('Error: --key <provider-public-key> is required');
  console.error('');
  console.error('Usage:');
  console.error('  node src/p2p/client.js --key <key> --query "your question"');
  console.error('  node src/p2p/client.js --key <key> --interactive');
  console.error('');
  console.error('Get the provider key from the machine running DevBrain server.');
  process.exit(1);
}

let modelId = null;

async function connect() {
  console.log(`Connecting to DevBrain provider: ${providerKey.slice(0, 16)}...`);
  console.log('Using Holepunch DHT for peer-to-peer connection...');
  console.log('(First connection may take 15-45s for DHT discovery)\n');

  try {
    // Load a model with delegate option — the SDK connects to the
    // remote provider over HyperDHT and routes all inference there.
    modelId = await qvac.loadModel({
      modelSrc: qvac.QWEN3_4B_INST_Q4_K_M,
      modelConfig: { ctx_size: 8192 },
      delegate: {
        providerPublicKey: providerKey,
        timeout: 60_000,
        fallbackToLocal: false,
      },
      onProgress: (progress) => {
        const pct = typeof progress === 'number' ? progress : progress?.percentage;
        if (pct != null && pct % 25 === 0) {
          console.log(`  Download progress: ${pct}%`);
        }
      },
    });

    console.log('Connected to remote provider!\n');
    return true;
  } catch (err) {
    console.error(`Failed to connect: ${err.message}`);
    console.error('Make sure the provider is running and the key is correct.');
    return false;
  }
}

async function sendQuery(query) {
  if (!modelId) {
    console.error('Not connected to provider');
    return null;
  }

  const start = Date.now();
  console.log(`\n--- Querying: "${query.slice(0, 80)}" ---\n`);

  try {
    const run = qvac.completion({
      modelId,
      history: [
        {
          role: 'system',
          content: 'You are DevBrain, a code intelligence assistant. Answer questions about codebases clearly and concisely.',
        },
        { role: 'user', content: query },
      ],
      stream: true,
      generationParams: {
        temp: 0.3,
        predict: 1024,
      },
    });

    // Stream tokens as they arrive
    for await (const token of run.tokenStream) {
      process.stdout.write(token);
    }

    const result = await run.final;
    const durationMs = Date.now() - start;

    const tps = result.stats?.tokensPerSecond;
    const generated = result.stats?.generatedTokens;
    console.log(`\n\n--- Done (${(durationMs / 1000).toFixed(1)}s${tps ? `, ${tps.toFixed(1)} tok/s` : ''}${generated ? `, ${generated} tokens` : ''}, delegated to provider) ---\n`);

    return result;
  } catch (err) {
    console.error(`\nQuery failed: ${err.message}`);
    return null;
  }
}

async function runInteractive() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('DevBrain P2P Client — Interactive Mode');
  console.log('Type your questions. Type "exit" or press Ctrl+C to quit.\n');

  const prompt = () => {
    rl.question('devbrain> ', async (query) => {
      if (!query.trim()) { prompt(); return; }
      if (query.trim() === 'exit' || query.trim() === 'quit') {
        rl.close();
        await cleanup();
        process.exit(0);
      }
      await sendQuery(query.trim());
      prompt();
    });
  };

  prompt();
}

async function cleanup() {
  try {
    await qvac.close();
  } catch {
    // Ignore cleanup errors
  }
}

async function main() {
  const connected = await connect();
  if (!connected) process.exit(1);

  if (singleQuery) {
    await sendQuery(singleQuery);
    await cleanup();
    process.exit(0);
  } else {
    await runInteractive();
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nDisconnecting...');
  await cleanup();
  process.exit(0);
});

main().catch(async (err) => {
  console.error('Fatal error:', err);
  await cleanup();
  process.exit(1);
});
