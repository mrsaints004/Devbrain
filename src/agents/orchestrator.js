import { classifyIntent } from './router.js';
import { searchCode, formatContext, rerankResults } from './rag.js';
import { analyze } from './code.js';
import { deepReview } from './review.js';
import { handleWithTools } from './tool.js';
import { generateDocs } from './doc.js';
import { analyzeImage, transcribeAudio, synthesizeSpeech } from './vision.js';
import { logAgent } from '../logger.js';
import { sanitizeInput } from '../security/guard.js';
import { hasModel } from '../models.js';

const DEFAULT_WORKSPACE = 'devbrain-default';

export async function handleQuery(query, options = {}) {
  const {
    workspace = DEFAULT_WORKSPACE,
    codebasePath = '.',
    stream = false,
    onToken,
    onProgress,
    imageData,
    imageMimeType,
    audioData,
  } = options;

  const startTime = Date.now();

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

  if (onProgress) onProgress({ step: 'router', message: 'Classifying intent...' });
  const intent = await classifyIntent(finalQuery, !!imageData);
  logAgent('orchestrator', 'intent', { intent });
  steps.push({ agent: 'router', intent });
  if (onProgress) onProgress({ step: 'router_done', intent });

  let response;
  const streamOpts = { stream, onToken };

  async function ragSearch(searchQuery, limit = 8) {
    if (onProgress) onProgress({ step: 'rag', message: 'Searching codebase...' });
    const chunks = await searchCode(searchQuery || finalQuery, workspace, limit);
    steps.push({ agent: 'rag', resultsCount: chunks.length });
    if (onProgress) onProgress({ step: 'rag_done', resultsCount: chunks.length });
    return chunks;
  }

  async function ragSearchWithRerank(searchQuery, limit = 5) {
    const rawChunks = await ragSearch(searchQuery, 12);
    if (rawChunks.length <= limit) return rawChunks;
    if (onProgress) onProgress({ step: 'rerank', message: 'Re-ranking results...' });
    const reranked = await rerankResults(finalQuery, rawChunks, limit);
    steps.push({ agent: 'reranker', kept: reranked.length, from: rawChunks.length });
    return reranked;
  }

  async function chainToolThenCode(codeIntent) {
    if (onProgress) onProgress({ step: 'tool_search', message: 'Tool agent gathering context...' });
    let toolResult;
    try {
      toolResult = await handleWithTools(finalQuery, codebasePath, { stream: false });
      steps.push({ agent: 'tool', action: 'context_gather' });
    } catch {
      toolResult = null;
    }

    if (onProgress) onProgress({ step: 'generating', message: 'Synthesizing answer...' });
    const enrichedContext = toolResult
      ? `## Tool Agent Findings\n\n${toolResult}\n\n`
      : '';
    return analyze(finalQuery, enrichedContext, codeIntent, streamOpts);
  }

  async function deepAnalysis(codeIntent) {
    const chunks = await ragSearchWithRerank(finalQuery);

    if (chunks.length > 0) {
      const context = formatContext(chunks);

      if ((codeIntent === 'find_bug' || codeIntent === 'refactor') && chunks.length > 0) {
        const filePaths = extractFilePaths(chunks);
        let toolContext = '';
        if (filePaths.length > 0) {
          if (onProgress) onProgress({ step: 'tool_verify', message: 'Verifying with live files...' });
          try {
            const toolQuery = `Read these files and show their current content: ${filePaths.slice(0, 3).join(', ')}`;
            toolContext = await handleWithTools(toolQuery, codebasePath, { stream: false });
            steps.push({ agent: 'tool', action: 'verify_files', files: filePaths.length });
          } catch {
            /* proceed with RAG context */
          }
        }

        const fullContext = toolContext
          ? `## Indexed Code (RAG)\n\n${context}\n\n## Live File Content (verified)\n\n${toolContext}`
          : context;

        if (onProgress) onProgress({ step: 'generating', message: `${codeIntent === 'find_bug' ? 'Finding bugs' : 'Suggesting refactors'}...` });
        response = await analyze(finalQuery, fullContext, codeIntent, streamOpts);
        steps.push({ agent: 'code', action: codeIntent });
        return;
      }

      if (onProgress) onProgress({ step: 'generating', message: 'Analyzing code...' });
      response = await analyze(finalQuery, context, codeIntent, streamOpts);
      steps.push({ agent: 'code', action: codeIntent });
    } else {
      response = await chainToolThenCode(codeIntent);
      steps.push({ agent: 'code', action: `${codeIntent}_via_tool` });
    }
  }

  try {
    switch (intent) {
      case 'analyze_image': {
        if (onProgress) onProgress({ step: 'generating', message: 'Analyzing image...' });
        response = await analyzeImage(finalQuery, imageData, {
          ...streamOpts,
          mimeType: imageMimeType,
        });
        steps.push({ agent: 'vision', action: 'analyze_image' });
        break;
      }

      case 'security_audit': {
        await deepAnalysis('find_bug');
        break;
      }

      case 'deep_review': {
        const chunks = await ragSearchWithRerank(finalQuery);
        let reviewContext = '';

        if (chunks.length > 0) {
          reviewContext = formatContext(chunks);
          const filePaths = extractFilePaths(chunks);
          if (filePaths.length > 0) {
            if (onProgress) onProgress({ step: 'tool_verify', message: 'Reading live files for review...' });
            try {
              const toolQuery = `Read these files and show their current content: ${filePaths.slice(0, 3).join(', ')}`;
              const toolResult = await handleWithTools(toolQuery, codebasePath, { stream: false });
              steps.push({ agent: 'tool', action: 'verify_files', files: filePaths.length });
              if (toolResult) {
                reviewContext = `## Indexed Code (RAG)\n\n${reviewContext}\n\n## Live File Content\n\n${toolResult}`;
              }
            } catch { /* proceed with RAG context */ }
          }
        } else {
          if (onProgress) onProgress({ step: 'tool_search', message: 'Gathering code for review...' });
          try {
            const toolResult = await handleWithTools(finalQuery, codebasePath, { stream: false });
            steps.push({ agent: 'tool', action: 'context_gather' });
            reviewContext = toolResult || '';
          } catch {
            reviewContext = '';
          }
        }

        if (onProgress) onProgress({ step: 'generating', message: 'MedPsy diagnostic review...' });
        response = await deepReview(finalQuery, reviewContext, streamOpts);
        steps.push({ agent: 'review', action: 'deep_review' });
        break;
      }

      case 'search_code': {
        const chunks = await ragSearchWithRerank(finalQuery);
        if (chunks.length > 0) {
          const context = formatContext(chunks);
          if (onProgress) onProgress({ step: 'generating', message: 'Explaining results...' });
          response = await analyze(finalQuery, context, 'search_code', streamOpts);
          steps.push({ agent: 'code', action: 'search_explain' });
        } else {
          if (onProgress) onProgress({ step: 'generating', message: 'Searching with tools...' });
          response = await handleWithTools(finalQuery, codebasePath, streamOpts);
          steps.push({ agent: 'tool', action: 'search' });
        }
        break;
      }

      case 'explain_code': {
        await deepAnalysis('explain_code');
        break;
      }

      case 'find_bug': {
        await deepAnalysis('find_bug');
        break;
      }

      case 'refactor': {
        await deepAnalysis('refactor');
        break;
      }

      case 'generate_docs': {
        const chunks = await ragSearchWithRerank(finalQuery);
        if (chunks.length > 0) {
          if (onProgress) onProgress({ step: 'generating', message: 'Generating docs...' });
          const context = formatContext(chunks);
          response = await generateDocs(finalQuery, context, streamOpts);
          steps.push({ agent: 'doc', action: 'generate' });
        } else {
          if (onProgress) onProgress({ step: 'tool_read', message: 'Reading files...' });
          const toolResult = await handleWithTools(`Read the relevant files for: ${finalQuery}`, codebasePath, { stream: false });
          steps.push({ agent: 'tool', action: 'read_for_docs' });
          if (onProgress) onProgress({ step: 'generating', message: 'Generating docs...' });
          response = await generateDocs(finalQuery, toolResult || 'No files found.', streamOpts);
          steps.push({ agent: 'doc', action: 'generate_from_tool' });
        }
        break;
      }

      case 'general_question':
      default: {
        await deepAnalysis('general_question');
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

function extractFilePaths(chunks) {
  const paths = new Set();
  for (const chunk of chunks) {
    const match = chunk.content?.match(/^\[([^\]:]+)/);
    if (match) paths.add(match[1]);
  }
  return [...paths];
}
