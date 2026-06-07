import * as qvac from '@qvac/sdk';
import { getModelId } from '../models.js';
import { logAgent, logInference } from '../logger.js';
import { hardenSystemPrompt, filterOutput } from '../security/guard.js';

const SYSTEM_PROMPT = hardenSystemPrompt(
  `You are a technical documentation generator. Generate comprehensive Markdown documentation for code.
Include: module summary, exported functions/classes with parameters and return types, usage examples, and dependencies.
Format output as clean, well-structured Markdown with proper headings, code blocks, and tables.`
);

export async function generateDocs(query, context, options = {}) {
  const modelId = getModelId('llm');
  if (!modelId) throw new Error('LLM not loaded');

  const { stream = false, onToken } = options;

  logAgent('doc', 'generate', { queryLength: query.length, contextLength: context.length });
  const start = Date.now();

  const run = qvac.completion({
    modelId,
    history: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `## Code to Document\n\n${context}\n\n## User Request\n\n${query}` },
    ],
    stream: false,
    generationParams: {
      temp: 0.3,
      predict: 2048,
    },
  });

  const result = await run.final;
  const durationMs = Date.now() - start;
  let docs = result.contentText || 'Unable to generate documentation.';

  logInference({
    modelId,
    prompt: `[doc] ${query.slice(0, 100)}`,
    tokensIn: result.stats?.cacheTokens,
    tokensOut: result.stats?.generatedTokens,
    ttft: result.stats?.timeToFirstToken,
    tps: result.stats?.tokensPerSecond,
    durationMs,
    agent: 'doc',
  });

  // Simulate streaming to callback
  if (stream && onToken && docs) {
    const words = docs.split(' ');
    for (const word of words) {
      onToken(word + ' ');
    }
  }

  docs = filterOutput(docs);
  logAgent('doc', 'done', { docsLength: docs.length });
  return docs;
}
