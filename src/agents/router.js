import * as qvac from '@qvac/sdk';
import { getModelId } from '../models.js';
import { logAgent, logInference } from '../logger.js';
import { hardenSystemPrompt } from '../security/guard.js';

const INTENTS = [
  'search_code',
  'explain_code',
  'find_bug',
  'security_audit',
  'deep_review',
  'generate_docs',
  'refactor',
  'analyze_image',
  'general_question',
];

const SYSTEM_PROMPT = hardenSystemPrompt(`You are an intent classifier for a code intelligence system.
Given a user query about a codebase, classify it into exactly one of these intents:
- search_code: user wants to find specific code, files, functions, or patterns
- explain_code: user wants to understand how code works
- find_bug: user wants to identify bugs, issues, or potential problems
- security_audit: user specifically wants a security review, vulnerability assessment, or safety analysis
- deep_review: user wants a thorough, in-depth code review, diagnostic analysis, or comprehensive quality assessment
- generate_docs: user wants documentation generated for code
- refactor: user wants code improvement suggestions or refactoring
- analyze_image: user mentions an image, screenshot, diagram, or visual content
- general_question: general questions about the project, architecture, or anything else

Respond with ONLY the intent name, nothing else.`);

export async function classifyIntent(query, hasImage = false) {
  // Fast path: if image is attached, route to analyze_image
  if (hasImage) return 'analyze_image';

  const q = query.toLowerCase();
  if (/\b(security\s+(?:audit|review|scan|check|assess)|vulnerability\s+(?:scan|assess|check)|penetration|pen\s?test|safety\s+(?:analysis|review|check)|threat\s+model)/i.test(q)) return 'security_audit';
  if (/\b(deep\s+review|code\s+review|thorough\s+(?:analysis|review)|diagnos(?:e|tic|is)|comprehensive\s+review|quality\s+(?:review|assessment|check|audit))\b/.test(q)) return 'deep_review';
  if (/\b(bug|bugs|err?ors?|issue|issues|problem|problems|wrong|broken|fix|debug|vulnerability|vulnerabilities|lint)\b/.test(q)) return 'find_bug';
  if (/\b(refactor|improve|clean\s?up|optimize|simplify|performance)\b/.test(q)) return 'refactor';
  if (/\b(explain|how\s+does|what\s+does|walk\s+me\s+through|understand|what\s+is)\b/.test(q)) return 'explain_code';
  if (/\b(document|docs|documentation|jsdoc|readme|docstring)\b/.test(q)) return 'generate_docs';
  if (/\b(find|search|where|locate|grep|which\s+file)\b/.test(q)) return 'search_code';

  const modelId = getModelId('llm');
  if (!modelId) throw new Error('LLM not loaded');

  logAgent('router', 'classify', { query: query.slice(0, 100) });
  const start = Date.now();

  const run = qvac.completion({
    modelId,
    history: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: query },
    ],
    stream: false,
    generationParams: {
      temp: 0,
      predict: 64,
    },
  });

  const result = await run.final;
  const durationMs = Date.now() - start;
  const responseText = (result.contentText || '').trim().toLowerCase();

  logInference({
    modelId,
    prompt: `[router] ${query.slice(0, 100)}`,
    tokensIn: result.stats?.cacheTokens,
    tokensOut: result.stats?.generatedTokens,
    ttft: result.stats?.timeToFirstToken,
    tps: result.stats?.tokensPerSecond,
    durationMs,
    agent: 'router',
  });

  const cleaned = responseText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  let intent = INTENTS.find((i) => cleaned === i);

  if (!intent) {
    intent = INTENTS.find((i) => cleaned.includes(i));
  }

  if (!intent) {
    intent = INTENTS.find((i) => responseText.includes(i)) || 'general_question';
  }

  logAgent('router', 'classified', { intent, rawResponse: responseText.slice(0, 50) });
  return intent;
}
