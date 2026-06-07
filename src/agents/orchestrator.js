import { classifyIntent } from './router.js';
import { searchCode, formatContext } from './rag.js';
import { analyze } from './code.js';
import { handleWithTools } from './tool.js';
import { generateDocs } from './doc.js';
import { analyzeImage, transcribeAudio, synthesizeSpeech } from './vision.js';
import { logAgent } from '../logger.js';
import { sanitizeInput } from '../security/guard.js';
import { hasModel } from '../models.js';

const DEFAULT_WORKSPACE = 'devbrain-default';

/**
 * Main query handler — orchestrates multi-agent pipeline.
 * Supports both blocking and streaming modes.
 */
export async function handleQuery(query, options = {}) {
  const {
    workspace = DEFAULT_WORKSPACE,
    codebasePath = '.',
    stream = false,
    onToken,
    imageData,
    imageMimeType,
    audioData,
  } = options;

  const startTime = Date.now();

  // Security: sanitize input
  const { sanitized, threats, processable } = sanitizeInput(query);
  if (!processable) {
    return {
      query,
      intent: 'blocked',
      response: 'Invalid query. Please provide a valid code-related question.',
      steps: [{ agent: 'security', action: 'blocked', threats }],
      durationMs: Date.now() - startTime,
    };
  }

  const safeQuery = sanitized;
  logAgent('orchestrator', 'start', { query: safeQuery.slice(0, 150), hasImage: !!imageData, hasAudio: !!audioData });

  // Handle audio input: transcribe first
  let finalQuery = safeQuery;
  const steps = [];

  if (audioData) {
    try {
      const transcription = await transcribeAudio(audioData);
      finalQuery = transcription || safeQuery;
      steps.push({ agent: 'stt', action: 'transcribe', text: transcription.slice(0, 100) });
    } catch (err) {
      steps.push({ agent: 'stt', action: 'error', error: err.message });
    }
  }

  if (threats.length > 0) {
    steps.push({ agent: 'security', action: 'warning', threats });
  }

  // Step 1: Classify intent
  const intent = await classifyIntent(finalQuery, !!imageData);
  logAgent('orchestrator', 'intent', { intent });
  steps.push({ agent: 'router', intent });

  let response;
  const streamOpts = { stream, onToken };

  try {
    switch (intent) {
      case 'analyze_image': {
        response = await analyzeImage(finalQuery, imageData, {
          ...streamOpts,
          mimeType: imageMimeType,
        });
        steps.push({ agent: 'vision', action: 'analyze_image' });
        break;
      }

      case 'search_code': {
        const chunks = await searchCode(finalQuery, workspace);
        steps.push({ agent: 'rag', resultsCount: chunks.length });

        if (chunks.length > 0) {
          const context = formatContext(chunks);
          response = await analyze(finalQuery, context, 'general_question', streamOpts);
          steps.push({ agent: 'code', action: 'analyze' });
        } else {
          response = await handleWithTools(finalQuery, codebasePath, streamOpts);
          steps.push({ agent: 'tool', action: 'fallback_search' });
        }
        break;
      }

      case 'explain_code': {
        const chunks = await searchCode(finalQuery, workspace);
        steps.push({ agent: 'rag', resultsCount: chunks.length });
        if (chunks.length > 0) {
          const context = formatContext(chunks);
          response = await analyze(finalQuery, context, 'explain_code', streamOpts);
          steps.push({ agent: 'code', action: 'explain' });
        } else {
          response = await handleWithTools(finalQuery, codebasePath, streamOpts);
          steps.push({ agent: 'tool', action: 'fallback_explain' });
        }
        break;
      }

      case 'find_bug': {
        const chunks = await searchCode(finalQuery, workspace);
        steps.push({ agent: 'rag', resultsCount: chunks.length });
        if (chunks.length > 0) {
          const context = formatContext(chunks);
          response = await analyze(finalQuery, context, 'find_bug', streamOpts);
          steps.push({ agent: 'code', action: 'find_bug' });
        } else {
          response = await handleWithTools(finalQuery, codebasePath, streamOpts);
          steps.push({ agent: 'tool', action: 'fallback_bug' });
        }
        break;
      }

      case 'refactor': {
        const chunks = await searchCode(finalQuery, workspace);
        steps.push({ agent: 'rag', resultsCount: chunks.length });
        if (chunks.length > 0) {
          const context = formatContext(chunks);
          response = await analyze(finalQuery, context, 'refactor', streamOpts);
          steps.push({ agent: 'code', action: 'refactor' });
        } else {
          response = await handleWithTools(finalQuery, codebasePath, streamOpts);
          steps.push({ agent: 'tool', action: 'fallback_refactor' });
        }
        break;
      }

      case 'generate_docs': {
        const chunks = await searchCode(finalQuery, workspace);
        steps.push({ agent: 'rag', resultsCount: chunks.length });
        if (chunks.length > 0) {
          const context = formatContext(chunks);
          response = await generateDocs(finalQuery, context, streamOpts);
          steps.push({ agent: 'doc', action: 'generate' });
        } else {
          response = await handleWithTools(finalQuery, codebasePath, streamOpts);
          steps.push({ agent: 'tool', action: 'fallback_docs' });
        }
        break;
      }

      case 'general_question':
      default: {
        const chunks = await searchCode(finalQuery, workspace);
        steps.push({ agent: 'rag', resultsCount: chunks.length });

        if (chunks.length > 0) {
          const context = formatContext(chunks);
          response = await analyze(finalQuery, context, 'general_question', streamOpts);
          steps.push({ agent: 'code', action: 'answer' });
        } else {
          response = await handleWithTools(finalQuery, codebasePath, streamOpts);
          steps.push({ agent: 'tool', action: 'fallback' });
        }
        break;
      }
    }
  } catch (err) {
    logAgent('orchestrator', 'error', { error: err.message });
    response = `Error processing query: ${err.message}`;
    steps.push({ agent: 'error', message: err.message });
  }

  const durationMs = Date.now() - startTime;
  logAgent('orchestrator', 'complete', { durationMs, stepsCount: steps.length, intent });

  return {
    query: finalQuery,
    intent,
    response,
    steps,
    durationMs,
    security: threats.length > 0 ? { warnings: threats } : undefined,
  };
}
