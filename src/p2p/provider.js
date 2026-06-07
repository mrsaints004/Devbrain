import * as qvac from '@qvac/sdk';
import { log, logP2P } from '../logger.js';
import { handleQuery } from '../agents/orchestrator.js';

let providerKey = null;
let isRunning = false;
let connectedPeers = new Set();
let queryCount = 0;

/**
 * Start the QVAC P2P provider — makes this device's DevBrain
 * accessible to remote peers (phones, tablets, other machines).
 *
 * When a peer connects and sends a query, we run it through
 * the local orchestrator and stream results back.
 */
export async function startProvider(options = {}) {
  const { workspace = 'devbrain-default', codebasePath = '.' } = options;

  logP2P('provider_starting', { message: 'Initializing QVAC P2P provider' });

  try {
    const result = await qvac.startQVACProvider({
      onConnection: (peer) => {
        const peerId = peer.publicKey || peer.id || `peer-${Date.now()}`;
        connectedPeers.add(peerId);
        logP2P('peer_connected', { peerId, totalPeers: connectedPeers.size });
        console.log(`  [P2P] Peer connected: ${peerId.slice(0, 16)}... (${connectedPeers.size} active)`);
      },
      onDisconnection: (peer) => {
        const peerId = peer.publicKey || peer.id || `peer-${Date.now()}`;
        connectedPeers.delete(peerId);
        logP2P('peer_disconnected', { peerId, totalPeers: connectedPeers.size });
      },
      onRequest: async (request, peer) => {
        // Handle incoming queries from peers
        const peerId = (peer.publicKey || peer.id || 'unknown').slice(0, 16);
        queryCount++;
        logP2P('peer_query', { peerId, query: request.query?.slice(0, 100), queryCount });

        try {
          const result = await handleQuery(request.query, {
            workspace,
            codebasePath,
            imageData: request.imageData,
            imageMimeType: request.imageMimeType,
          });

          logP2P('peer_response', { peerId, durationMs: result.durationMs, intent: result.intent });
          return result;
        } catch (err) {
          logP2P('peer_query_error', { peerId, error: err.message });
          return { error: err.message };
        }
      },
    });

    providerKey = result.publicKey || null;
    isRunning = true;

    logP2P('provider_ready', { publicKey: providerKey, success: result.success });

    if (providerKey) {
      console.log('\n╔══════════════════════════════════════════════════╗');
      console.log('║           P2P Provider Active                    ║');
      console.log('╠══════════════════════════════════════════════════╣');
      console.log('║  Connection Key (share with peers):              ║');
      console.log(`║  ${providerKey.slice(0, 48)}║`);
      console.log('║                                                  ║');
      console.log('║  Peers can query your DevBrain remotely via:     ║');
      console.log('║    node src/p2p/client.js --key <key> --query    ║');
      console.log('║  Or open the mobile web client on your phone     ║');
      console.log('╚══════════════════════════════════════════════════╝\n');
    }

    return { publicKey: providerKey, success: result.success };
  } catch (err) {
    logP2P('provider_error', { error: err.message });
    console.log('  [P2P] Provider failed to start (non-critical):', err.message);
    return { publicKey: null, success: false };
  }
}

export async function stopProvider() {
  if (!isRunning) return;
  try {
    await qvac.stopQVACProvider();
    isRunning = false;
    logP2P('provider_stopped', { totalQueries: queryCount });
  } catch (err) {
    logP2P('provider_stop_error', { error: err.message });
  }
}

export function getProviderKey() {
  return providerKey;
}

export function getProviderStatus() {
  return {
    running: isRunning,
    publicKey: providerKey,
    connectedPeers: connectedPeers.size,
    totalQueries: queryCount,
    peers: [...connectedPeers].map((p) => p.slice(0, 16) + '...'),
  };
}
