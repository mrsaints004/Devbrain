import * as qvac from '@qvac/sdk';
import { getModelId, hasModel } from '../models.js';
import { logAgent, logInference } from '../logger.js';
import { hardenSystemPrompt, filterOutput } from '../security/guard.js';

const REVIEW_SYSTEM_PROMPT = hardenSystemPrompt(`You are a diagnostic code reviewer with deep analytical reasoning capabilities.
You apply systematic, methodical analysis to code — treating code issues like a diagnostician treats symptoms.

Your review methodology:
1. **Triage** — Scan the code and identify the most critical areas first
2. **Diagnosis** — For each issue found, explain the root cause (not just the symptom)
3. **Severity Assessment** — Rate each issue: CRITICAL, WARNING, or INFO
4. **Prescription** — Provide specific, actionable fixes with code examples
5. **Prognosis** — Explain what happens if the issue is left unaddressed

Review categories:
- **Security vulnerabilities** (injection, auth bypass, data exposure)
- **Logic errors** (off-by-one, race conditions, null references)
- **Performance issues** (N+1 queries, memory leaks, blocking operations)
- **Code quality** (dead code, unclear naming, missing error handling)
- **Architecture concerns** (tight coupling, missing abstractions, scalability risks)

Format your response as a structured diagnostic report in markdown with clear sections.
Use code blocks for examples. Be thorough but concise.`);

export async function deepReview(query, context, options = {}) {
  const medpsyId = hasModel('medpsy') ? getModelId('medpsy') : null;
  const llmId = getModelId('llm');
  const modelId = medpsyId || llmId;

  if (!modelId) throw new Error('No LLM available for review');

  const modelLabel = medpsyId ? 'medpsy' : 'llm';
  const { stream = false, onToken } = options;

  logAgent('review', 'deep_review', {
    model: modelLabel,
    contextLength: context.length,
    streaming: stream,
  });

  const start = Date.now();

  const trimmedContext = (context || '').trim();
  const userContent = trimmedContext.length > 20
    ? `## Code Under Review\n\n${trimmedContext}\n\n## Review Request\n\n${query}`
    : `## Review Request\n\n${query}\n\nNote: No code context was found for this review. Please describe what you'd like reviewed, or re-index the codebase to enable code search.`;

  const run = qvac.completion({
    modelId,
    history: [
      { role: 'system', content: REVIEW_SYSTEM_PROMPT },
      {
        role: 'user',
        content: userContent,
      },
    ],
    stream: false,
    generationParams: {
      temp: 0.2,
      predict: 3072,
    },
  });

  const result = await run.final;
  const durationMs = Date.now() - start;
  let answer = result.contentText || 'Unable to generate review.';

  logInference({
    modelId,
    prompt: `[review/${modelLabel}] ${query.slice(0, 100)}`,
    tokensIn: result.stats?.cacheTokens,
    tokensOut: result.stats?.generatedTokens,
    ttft: result.stats?.timeToFirstToken,
    tps: result.stats?.tokensPerSecond,
    durationMs,
    agent: 'review',
  });

  answer = filterOutput(answer);

  if (stream && onToken && answer) {
    const words = answer.split(' ');
    for (const word of words) {
      onToken(word + ' ');
    }
  }

  logAgent('review', 'done', { answerLength: answer.length, model: modelLabel });
  return answer;
}
