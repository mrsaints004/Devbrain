import { writeFileSync, appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const LOG_DIR = join(import.meta.dirname, '..', 'logs');
const LOG_FILE = join(LOG_DIR, 'inference-log.json');
const CSV_FILE = join(LOG_DIR, 'inference-log.csv');

if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

let entries = [];
if (existsSync(LOG_FILE)) {
  try {
    entries = JSON.parse(readFileSync(LOG_FILE, 'utf-8'));
  } catch {
    entries = [];
  }
}

if (!existsSync(CSV_FILE)) {
  writeFileSync(CSV_FILE, 'timestamp,session_id,event,agent,model_id,prompt,tokens_in,tokens_out,ttft_ms,tps,duration_ms\n');
}

const sessionId = `session-${Date.now()}`;
let sessionStart = Date.now();

function persist() {
  writeFileSync(LOG_FILE, JSON.stringify(entries, null, 2));
}

function persistCsv(entry) {
  const row = [
    entry.timestamp,
    entry.sessionId,
    entry.event,
    entry.agent || '',
    entry.modelId || '',
    `"${(entry.prompt || '').replace(/"/g, '""').slice(0, 100)}"`,
    entry.tokensIn || '',
    entry.tokensOut || '',
    entry.ttft || '',
    entry.tps || '',
    entry.durationMs || '',
  ].join(',');
  appendFileSync(CSV_FILE, row + '\n');
}

export function log(event, data = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    sessionId,
    event,
    ...data,
  };
  entries.push(entry);
  persist();
  persistCsv(entry);
  const { timestamp, sessionId: _sid, ...rest } = entry;
  const preview = Object.keys(rest).length > 1 ? JSON.stringify(rest).slice(0, 120) : '';
  console.log(`[${timestamp}] ${event} ${preview}`);
}

export function logModelLoad(modelId, modelType, durationMs) {
  log('model_load', { modelId, modelType, durationMs });
}

export function logModelUnload(modelId) {
  log('model_unload', { modelId });
}

export function logInference({ modelId, prompt, tokensIn, tokensOut, ttft, tps, durationMs, agent }) {
  log('inference', {
    modelId,
    agent: agent || 'unknown',
    prompt: prompt?.slice(0, 200),
    tokensIn,
    tokensOut,
    ttft,
    tps,
    durationMs,
  });
}

export function logRag(action, data) {
  log(`rag_${action}`, data);
}

export function logAgent(agentName, action, data = {}) {
  log('agent', { agent: agentName, action, ...data });
}

export function logSecurity(event, data = {}) {
  log('security', { securityEvent: event, ...data });
}

export function logP2P(action, data = {}) {
  log('p2p', { action, ...data });
}

export function logFinetune(action, data = {}) {
  log('finetune', { action, ...data });
}

export function getEntries() {
  return entries;
}

export function getSessionStats() {
  const sessionEntries = entries.filter((e) => e.sessionId === sessionId);
  const inferences = sessionEntries.filter((e) => e.event === 'inference');
  const totalTokensIn = inferences.reduce((sum, e) => sum + (e.tokensIn || 0), 0);
  const totalTokensOut = inferences.reduce((sum, e) => sum + (e.tokensOut || 0), 0);
  const avgTps = inferences.length > 0
    ? inferences.reduce((sum, e) => sum + (e.tps || 0), 0) / inferences.length
    : 0;
  const avgTtft = inferences.length > 0
    ? inferences.reduce((sum, e) => sum + (e.ttft || 0), 0) / inferences.length
    : 0;

  return {
    sessionId,
    uptime: Date.now() - sessionStart,
    totalInferences: inferences.length,
    totalTokensIn,
    totalTokensOut,
    avgTps: Math.round(avgTps * 100) / 100,
    avgTtft: Math.round(avgTtft * 100) / 100,
    totalEvents: sessionEntries.length,
  };
}
