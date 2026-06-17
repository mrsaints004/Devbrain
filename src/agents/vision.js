import * as qvac from '@qvac/sdk';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
    // Save base64 image to temp file (SDK attachments require file paths)
    const ext = mimeType === 'image/jpeg' ? '.jpg' : '.png';
    const tempDir = mkdtempSync(join(tmpdir(), 'devbrain-'));
    const tempPath = join(tempDir, `image${ext}`);

    try {
      // imageData may be a base64 string (possibly with data URI prefix)
      const base64 = imageData.replace(/^data:image\/\w+;base64,/, '');
      writeFileSync(tempPath, Buffer.from(base64, 'base64'));

      const run = qvac.completion({
        modelId: visionModelId,
        history: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: query || 'Analyze this image in detail. What do you see?',
            attachments: [{ path: tempPath }],
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
    } finally {
      // Clean up temp file
      try { unlinkSync(tempPath); } catch { /* ignore */ }
    }
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

  // Filter output BEFORE streaming
  answer = filterOutput(answer);

  // Simulate streaming to callback
  if (stream && onToken && answer) {
    const words = answer.split(' ');
    for (const word of words) {
      onToken(word + ' ');
    }
  }

  logAgent('vision', 'done', { answerLength: answer.length });
  return answer;
}

export async function transcribeAudio(audioBuffer) {
  const sttModelId = getModelId('stt');
  if (!sttModelId) throw new Error('STT model not loaded');

  logAgent('stt', 'transcribe', { audioSize: audioBuffer.length });
  const start = Date.now();

  // SDK transcribe expects audioChunk as { type: 'base64', value } or string/Buffer
  const audioBase64 = Buffer.isBuffer(audioBuffer)
    ? audioBuffer.toString('base64')
    : audioBuffer;

  const result = await qvac.transcribe({
    modelId: sttModelId,
    audioChunk: audioBase64,
  });

  const durationMs = Date.now() - start;
  const text = result.text || '';

  logInference({
    modelId: sttModelId,
    prompt: '[stt] audio transcription',
    durationMs,
    agent: 'stt',
  });

  logAgent('stt', 'done', { textLength: text.length });
  return text;
}

export async function synthesizeSpeech(text) {
  const ttsModelId = getModelId('tts');
  if (!ttsModelId) throw new Error('TTS model not loaded');

  logAgent('tts', 'synthesize', { textLength: text.length });
  const start = Date.now();

  const result = qvac.textToSpeech({
    modelId: ttsModelId,
    text: text.slice(0, 500),
    inputType: 'text',
    stream: false,
  });

  const audioBuffer = await result.buffer;
  const durationMs = Date.now() - start;

  logInference({
    modelId: ttsModelId,
    prompt: `[tts] ${text.slice(0, 50)}`,
    durationMs,
    agent: 'tts',
  });

  logAgent('tts', 'done', { durationMs, samples: audioBuffer?.length });

  // Convert int16 PCM samples to a WAV buffer for the browser
  if (Array.isArray(audioBuffer) && audioBuffer.length > 0) {
    const sampleRate = 44100;
    const pcm = new Int16Array(audioBuffer);
    const pcmBytes = Buffer.from(pcm.buffer);
    const header = Buffer.alloc(44);

    // WAV header
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcmBytes.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);       // subchunk1 size
    header.writeUInt16LE(1, 20);        // PCM format
    header.writeUInt16LE(1, 22);        // mono
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28); // byte rate
    header.writeUInt16LE(2, 32);        // block align
    header.writeUInt16LE(16, 34);       // bits per sample
    header.write('data', 36);
    header.writeUInt32LE(pcmBytes.length, 40);

    return Buffer.concat([header, pcmBytes]);
  }

  return audioBuffer;
}
