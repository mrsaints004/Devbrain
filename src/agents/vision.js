import * as qvac from '@qvac/sdk';
import { getModelId, hasModel } from '../models.js';
import { logAgent, logInference } from '../logger.js';
import { hardenSystemPrompt, filterOutput } from '../security/guard.js';

const SYSTEM_PROMPT = hardenSystemPrompt(
  `You are a multimodal code intelligence assistant. You analyze images of code, architecture diagrams, UI screenshots, error messages, and technical documentation.
When analyzing an image:
- Describe what you see in technical detail
- If it's code, transcribe it and explain it
- If it's a diagram, describe the architecture and data flow
- If it's a UI screenshot, describe the layout and suggest improvements
- If it's an error, diagnose the issue and suggest fixes
Use markdown formatting in your response.`
);

/**
 * Analyze an image (screenshot, diagram, code photo) using the vision model.
 * Falls back to LLM with description if vision model unavailable.
 */
export async function analyzeImage(query, imageData, options = {}) {
  const { stream = false, onToken, mimeType = 'image/png' } = options;

  logAgent('vision', 'analyze', { queryLength: query.length, hasImage: !!imageData, mimeType });

  const visionModelId = getModelId('vision');
  const llmModelId = getModelId('llm');
  const modelId = visionModelId || llmModelId;

  if (!modelId) throw new Error('No model available for vision analysis');

  const start = Date.now();
  let answer = '';

  if (visionModelId && imageData) {
    // Use multimodal completion with image
    const run = qvac.completion({
      modelId: visionModelId,
      history: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image', data: imageData, mimeType },
            { type: 'text', text: query || 'Analyze this image in detail. What do you see?' },
          ],
        },
      ],
      stream: false,
      generationParams: {
        temp: 0.3,
        predict: 2048,
      },
    });

    const result = await run.final;
    const durationMs = Date.now() - start;
    answer = result.contentText || 'Unable to analyze image.';

    logInference({
      modelId: visionModelId,
      prompt: `[vision] ${query.slice(0, 80)}`,
      tokensIn: result.stats?.cacheTokens,
      tokensOut: result.stats?.generatedTokens,
      ttft: result.stats?.timeToFirstToken,
      tps: result.stats?.tokensPerSecond,
      durationMs,
      agent: 'vision',
    });
  } else {
    // Fallback: use LLM with text description
    const fallbackPrompt = `The user has shared an image but the vision model is not available.
Based on their question, provide guidance on what they might be looking at.
User's question: ${query}`;

    const run = qvac.completion({
      modelId: llmModelId,
      history: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: fallbackPrompt },
      ],
      stream: false,
      generationParams: { temp: 0.3, predict: 1024 },
    });

    const result = await run.final;
    answer = result.contentText || 'Vision model unavailable.';
    const durationMs = Date.now() - start;

    logInference({
      modelId: llmModelId,
      prompt: `[vision-fallback] ${query.slice(0, 80)}`,
      tokensIn: result.stats?.cacheTokens,
      tokensOut: result.stats?.generatedTokens,
      durationMs,
      agent: 'vision',
    });
  }

  // Simulate streaming to callback
  if (stream && onToken && answer) {
    const words = answer.split(' ');
    for (const word of words) {
      onToken(word + ' ');
    }
  }

  answer = filterOutput(answer);
  logAgent('vision', 'done', { answerLength: answer.length });
  return answer;
}

/**
 * Transcribe audio using STT model.
 */
export async function transcribeAudio(audioBuffer) {
  const sttModelId = getModelId('stt');
  if (!sttModelId) throw new Error('STT model not loaded');

  logAgent('stt', 'transcribe', { audioSize: audioBuffer.length });
  const start = Date.now();

  const result = await qvac.transcribe({
    modelId: sttModelId,
    audio: audioBuffer,
  });

  const durationMs = Date.now() - start;
  const text = result.text || result.transcription || '';

  logInference({
    modelId: sttModelId,
    prompt: '[stt] audio transcription',
    durationMs,
    agent: 'stt',
  });

  logAgent('stt', 'done', { textLength: text.length });
  return text;
}

/**
 * Generate speech from text using TTS model.
 */
export async function synthesizeSpeech(text) {
  const ttsModelId = getModelId('tts');
  if (!ttsModelId) throw new Error('TTS model not loaded');

  logAgent('tts', 'synthesize', { textLength: text.length });
  const start = Date.now();

  const result = await qvac.tts({
    modelId: ttsModelId,
    text: text.slice(0, 500),
  });

  const durationMs = Date.now() - start;
  logInference({
    modelId: ttsModelId,
    prompt: `[tts] ${text.slice(0, 50)}`,
    durationMs,
    agent: 'tts',
  });

  logAgent('tts', 'done', { durationMs });
  return result.audio || result;
}
