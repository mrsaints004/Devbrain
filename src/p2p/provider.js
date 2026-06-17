import * as qvac from '@qvac/sdk';
import { log, logP2P } from '../logger.js';

let providerKey = null;
let isRunning = false;

/**
 * Start the QVAC P2P provider — makes this device's DevBrain
 * accessible to remote peers (phones, tablets, other machines).
 *
 * How it works:
 *   startQVACProvider() registers this device on the Holepunch DHT.
 *   When a remote client calls loadModel() with our public key in
 *   the `delegate` option, the SDK automatically routes their
 *   completion/embed/etc. requests to our locally loaded models.
 *   No custom request handling needed — the SDK handles it internally.
 */
export async function startProvider(options = {}) {
  logP2P('provider_starting', { message: 'Initializing QVAC P2P provider' });

  try {
    const result = await qvac.startQVACProvider({
      // Optional firewall: restrict to specific peer public keys
      // firewall: { mode: 'allow', publicKeys: ['<hex-key>'] },
    });

    providerKey = result.publicKey || null;
    isRunning = result.success === true;

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
    logP2P('provider_stopped', {});
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
  };
}
