import * as qvac from '@qvac/sdk';
import { getModelId } from '../models.js';
import { logAgent, logInference } from '../logger.js';
import { hardenSystemPrompt, filterOutput } from '../security/guard.js';

const PROMPTS = {
  explain_code: hardenSystemPrompt(
    'You are a code expert. Explain the code snippets provided clearly. Reference file paths and line numbers. Use markdown formatting with code blocks.'
  ),
  find_bug: hardenSystemPrompt(
    'You are a senior code reviewer. Find bugs, security issues, or potential problems in the code snippets. Suggest fixes with code examples. Use markdown formatting.'
  ),
  refactor: hardenSystemPrompt(
    'You are a refactoring specialist. Suggest improvements to the code: better patterns, performance optimizations, cleaner abstractions. Show before/after code examples in markdown.'
  ),
  general_question: hardenSystemPrompt(
    'You are a code intelligence assistant. Answer the question using the code context provided. Be precise, reference specific files and functions. Use markdown formatting.'
  ),
};

export async function analyze(query, context, intent = 'explain_code', options = {}) {
  const modelId = getModelId('llm');
  if (!modelId) throw new Error('LLM not loaded');

  const systemPrompt = PROMPTS[intent] || PROMPTS.general_question;
  const { stream = false, onToken } = options;

  logAgent('code', 'analyze', { intent, contextLength: context.length, streaming: stream });
  const start = Date.now();

  const run = qvac.completion({
    modelId,
    history: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `## Relevant Code Context\n\n${context}\n\n## Question\n\n${query}` },
    ],
    stream: false, // QVAC SDK uses .final for results
    generationParams: {
      temp: 0.3,
      predict: 2048,
    },
  });

  const result = await run.final;
  const durationMs = Date.now() - start;
  let answer = result.contentText || 'Unable to generate analysis.';

  logInference({
    modelId,
    prompt: `[code/${intent}] ${query.slice(0, 100)}`,
    tokensIn: result.stats?.cacheTokens,
    tokensOut: result.stats?.generatedTokens,
    ttft: result.stats?.timeToFirstToken,
    tps: result.stats?.tokensPerSecond,
    durationMs,
    agent: 'code',
  });

  // Filter output BEFORE streaming (removes <think> tags, credentials, etc.)
  answer = filterOutput(answer);

  // Simulate streaming by sending tokens in chunks to the callback
  if (stream && onToken && answer) {
    const words = answer.split(' ');
    for (const word of words) {
      onToken(word + ' ');
    }
  }

  logAgent('code', 'done', { answerLength: answer.length });
  return answer;
}
