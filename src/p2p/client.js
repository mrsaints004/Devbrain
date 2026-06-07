#!/usr/bin/env node
/**
 * DevBrain P2P Client — connects to a remote DevBrain provider
 * and sends queries over the Holepunch DHT network.
 *
 * Usage:
 *   node src/p2p/client.js --key <provider-public-key> --query "What does this project do?"
 *   node src/p2p/client.js --key <key> --interactive
 *
 * This allows phones, tablets, or other machines to leverage
 * a more powerful device's DevBrain instance for code intelligence.
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

let connection = null;

async function connect() {
  console.log(`Connecting to DevBrain provider: ${providerKey.slice(0, 16)}...`);
  console.log('Using Holepunch DHT for peer-to-peer connection...\n');

  try {
    connection = await qvac.connectToQVACProvider({
      publicKey: providerKey,
      onDisconnect: () => {
        console.log('\n[Disconnected from provider]');
        if (interactive) process.exit(0);
      },
    });

    console.log('Connected successfully!\n');
    return true;
  } catch (err) {
    console.error(`Failed to connect: ${err.message}`);
    console.error('Make sure the provider is running and the key is correct.');
    return false;
  }
}

async function sendQuery(query, imageData = null) {
  if (!connection) {
    console.error('Not connected to provider');
    return null;
  }

  const start = Date.now();
  console.log(`\n--- Querying: "${query.slice(0, 80)}" ---`);

  try {
    const response = await connection.request({
      query,
      imageData,
      imageMimeType: imageData ? 'image/png' : undefined,
    });

    const durationMs = Date.now() - start;

    if (response.error) {
      console.error(`Error: ${response.error}`);
      return null;
    }

    console.log(`\nIntent: ${response.intent} | Duration: ${(durationMs / 1000).toFixed(1)}s`);
    console.log(`Pipeline: ${response.steps?.map((s) => s.agent).join(' → ')}`);
    console.log(`\n${response.response}`);
    console.log(`\n--- End (${(durationMs / 1000).toFixed(1)}s, delegated to provider) ---\n`);

    return response;
  } catch (err) {
    console.error(`Query failed: ${err.message}`);
    return null;
  }
}

async function runInteractive() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('DevBrain P2P Client — Interactive Mode');
  console.log('Type your questions. Press Ctrl+C to exit.\n');

  const prompt = () => {
    rl.question('devbrain> ', async (query) => {
      if (!query.trim()) { prompt(); return; }
      if (query.trim() === 'exit' || query.trim() === 'quit') {
        rl.close();
        process.exit(0);
      }
      await sendQuery(query.trim());
      prompt();
    });
  };

  prompt();
}

async function main() {
  const connected = await connect();
  if (!connected) process.exit(1);

  if (singleQuery) {
    await sendQuery(singleQuery);
    process.exit(0);
  } else {
    await runInteractive();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
