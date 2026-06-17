import * as qvac from '@qvac/sdk';
import { getModelId, hasModel } from '../models.js';
import { logAgent } from '../logger.js';
import { hardenSystemPrompt, filterOutput } from '../security/guard.js';

const BENCHMARK_QUERIES = [
  { label: 'explain', query: 'Explain how the main entry point works', intent: 'explain_code' },
  { label: 'find_bug', query: 'Find potential bugs in the error handling', intent: 'find_bug' },
  { label: 'refactor', query: 'Suggest refactoring improvements for the router', intent: 'refactor' },
  { label: 'search', query: 'Where are database connections handled?', intent: 'search_code' },
  { label: 'general', query: 'What is the overall architecture of this project?', intent: 'general_question' },
];

const CLOUD_COST_PER_QUERY = 0.015;
const CLOUD_AVG_LATENCY_MS = 2500;

export async function runBenchmark() {
  const modelId = getModelId('llm');
  if (!modelId) throw new Error('LLM not loaded — cannot run benchmark');

  logAgent('benchmark', 'start', { queries: BENCHMARK_QUERIES.length });

  const results = [];
  const systemPrompt = hardenSystemPrompt(
    'You are a code intelligence assistant. Answer concisely using the context provided.'
  );

  for (const bq of BENCHMARK_QUERIES) {
    const start = Date.now();

    const run = qvac.completion({
      modelId,
      history: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: bq.query },
      ],
      stream: false,
      generationParams: {
        temp: 0.3,
        predict: 512,
      },
    });

    const result = await run.final;
    const durationMs = Date.now() - start;

    const answer = filterOutput(result.contentText || '');
    results.push({
      label: bq.label,
      query: bq.query,
      intent: bq.intent,
      durationMs,
      ttft: result.stats?.timeToFirstToken || null,
      tps: result.stats?.tokensPerSecond || null,
      tokensIn: result.stats?.cacheTokens || 0,
      tokensOut: result.stats?.generatedTokens || 0,
      answerLength: answer.length,
    });
  }

  const avgTtft = Math.round(results.reduce((s, r) => s + (r.ttft || 0), 0) / results.length);
  const avgTps = +(results.reduce((s, r) => s + (r.tps || 0), 0) / results.length).toFixed(1);
  const avgLatency = Math.round(results.reduce((s, r) => s + r.durationMs, 0) / results.length);
  const totalTokensIn = results.reduce((s, r) => s + r.tokensIn, 0);
  const totalTokensOut = results.reduce((s, r) => s + r.tokensOut, 0);

  const cloudTotalCost = +(BENCHMARK_QUERIES.length * CLOUD_COST_PER_QUERY).toFixed(3);
  const cloudTotalLatency = BENCHMARK_QUERIES.length * CLOUD_AVG_LATENCY_MS;

  const modelsLoaded = [];
  if (hasModel('llm')) modelsLoaded.push('Qwen3 4B');
  if (hasModel('medpsy')) modelsLoaded.push('MedPsy 4B');
  if (hasModel('embeddings')) modelsLoaded.push('GTE-Large');
  if (hasModel('vision')) modelsLoaded.push('Qwen3-VL 2B');
  if (hasModel('stt')) modelsLoaded.push('Whisper Base');
  if (hasModel('tts')) modelsLoaded.push('Supertonic');

  const benchmark = {
    timestamp: new Date().toISOString(),
    queriesRun: results.length,
    results,
    summary: {
      avgTtft,
      avgTps,
      avgLatencyMs: avgLatency,
      totalTokensIn,
      totalTokensOut,
    },
    comparison: {
      local: {
        cost: '$0.00',
        avgLatencyMs: avgLatency,
        privacy: '100% — zero data leaves device',
        modelsLoaded,
      },
      cloud: {
        estimatedCost: `$${cloudTotalCost}`,
        avgLatencyMs: CLOUD_AVG_LATENCY_MS,
        privacy: 'Code sent to remote servers',
        note: 'Estimated based on GPT-4o-mini pricing (~$0.015/query avg)',
      },
    },
  };

  logAgent('benchmark', 'complete', {
    avgTps,
    avgTtft,
    avgLatency,
    queriesRun: results.length,
  });

  return benchmark;
}
