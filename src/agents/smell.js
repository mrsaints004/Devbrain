import * as qvac from '@qvac/sdk';
import { getModelId, hasModel } from '../models.js';
import { logAgent, logInference } from '../logger.js';
import { filterOutput } from '../security/guard.js';

const SMELL_PROMPT = `/no_think
You are a code quality analyzer. Given a code file that was just modified, identify potential issues.

Focus ONLY on real problems:
- Bugs (null refs, off-by-one, race conditions, unclosed resources)
- Security issues (injection, hardcoded secrets, unsafe eval)
- Performance problems (N+1 queries, unnecessary re-renders, memory leaks)
- Logic errors (unreachable code, incorrect conditions)

Rules:
- Be concise. Max 3 issues.
- If the code looks fine, respond with exactly: "No issues detected."
- Format each issue as: **[severity]** file:line — description
- Severity: CRITICAL, WARNING, or INFO
- Do NOT suggest style changes, naming conventions, or refactoring unless it's a bug.
- Do NOT use <think> tags. Respond directly with your findings.`;

// Queued smell detection to avoid model-busy conflicts
let smellQueue = [];
let smellRunning = false;

export async function detectSmells(filePath, content) {
  if (!hasModel('llm') && !hasModel('medpsy')) return null;
  if (!content || content.length < 20) return null;
  if (content.length > 8000) {
    content = content.slice(0, 8000);
  }

  // Queue the request and process sequentially
  return new Promise((resolve) => {
    smellQueue.push({ filePath, content, resolve });
    processSmellQueue();
  });
}

async function processSmellQueue() {
  if (smellRunning || smellQueue.length === 0) return;
  smellRunning = true;

  const { filePath, content, resolve } = smellQueue.shift();

  // Use primary LLM for smell detection (better at code analysis than MedPsy)
  // Falls back to MedPsy if LLM is unavailable
  const modelId = getModelId('llm') || getModelId('medpsy');
  const modelLabel = getModelId('llm') ? 'llm' : 'medpsy';

  logAgent('smell', 'analyze', { filePath, contentLength: content.length, model: modelLabel });
  const start = Date.now();

  try {
    const run = qvac.completion({
      modelId,
      history: [
        { role: 'system', content: SMELL_PROMPT },
        { role: 'user', content: `File: ${filePath}\n\n\`\`\`\n${content}\n\`\`\`` },
      ],
      stream: false,
      generationParams: {
        temp: 0.2,
        predict: 512,
      },
    });

    const result = await run.final;
    const durationMs = Date.now() - start;
    let answer = result.contentText || '';

    logInference({
      modelId,
      prompt: `[smell] ${filePath}`,
      tokensIn: result.stats?.cacheTokens,
      tokensOut: result.stats?.generatedTokens,
      ttft: result.stats?.timeToFirstToken,
      tps: result.stats?.tokensPerSecond,
      durationMs,
      agent: 'smell',
    });

    answer = filterOutput(answer);

    if (!answer || answer.toLowerCase().includes('no issues detected')) {
      logAgent('smell', 'clean', { filePath });
      resolve(null);
    } else {
      logAgent('smell', 'found', { filePath, issueLength: answer.length });
      resolve(answer);
    }
  } catch (err) {
    logAgent('smell', 'error', { filePath, error: err.message });
    // Retry once after a delay if model was busy
    if (err.message?.includes('Request') && smellQueue.length === 0) {
      smellQueue.push({ filePath, content, resolve });
      setTimeout(() => processSmellQueue(), 3000);
    } else {
      resolve(null);
    }
  } finally {
    smellRunning = false;
    // Process next in queue
    if (smellQueue.length > 0) {
      setTimeout(() => processSmellQueue(), 500);
    }
  }
}
