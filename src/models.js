import * as qvac from '@qvac/sdk';
import { logModelLoad, logModelUnload, log } from './logger.js';

const loaded = new Map();

// Model configurations — prioritizing QVAC Psy models + community models
const MODEL_CONFIGS = {
  // Primary LLM — QVAC's own Psy model for code reasoning
  llm: {
    modelSrc: qvac.PSY_4B_INST_Q4_K_M || qvac.QWEN3_4B_INST_Q4_K_M,
    label: 'Psy 4B Instruct Q4_K_M (primary LLM)',
    modelConfig: { ctx_size: 8192 },
  },
  // Fallback LLM
  'llm-fallback': {
    modelSrc: qvac.LLAMA_3_2_1B_INST_Q4_0,
    label: 'Llama 3.2 1B Instruct (fallback)',
    modelConfig: { ctx_size: 4096 },
  },
  // Embeddings for RAG
  embeddings: {
    modelSrc: qvac.GTE_LARGE_FP16,
    label: 'GTE-Large FP16 (embeddings)',
  },
  // Vision model for multimodal (screenshot/diagram analysis)
  vision: {
    modelSrc: qvac.PSY_VISION_Q4_K_M || qvac.LLAVA_1_6_MISTRAL_7B_Q4_K_M || qvac.QWEN3_4B_INST_Q4_K_M,
    label: 'Psy Vision Q4_K_M (multimodal)',
    modelConfig: { ctx_size: 4096 },
  },
  // TTS model for voice output
  tts: {
    modelSrc: qvac.PSY_TTS || qvac.OUTETTS_0_2_500M,
    label: 'Psy TTS (text-to-speech)',
  },
  // STT/Whisper model for voice input
  stt: {
    modelSrc: qvac.PSY_STT || qvac.WHISPER_BASE,
    label: 'Psy STT (speech-to-text)',
  },
};

export async function loadModel(type, retries = 3) {
  if (loaded.has(type)) return loaded.get(type);

  const cfg = MODEL_CONFIGS[type];
  if (!cfg) throw new Error(`Unknown model type: ${type}`);

  // Skip if model source is unavailable in current SDK version
  if (!cfg.modelSrc) {
    log('model_unavailable', { type, label: cfg.label, message: 'Model source not available in SDK' });
    return null;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    log('model_loading', { type, label: cfg.label, attempt, maxAttempts: retries });
    const start = Date.now();

    try {
      const modelId = await qvac.loadModel({
        modelSrc: cfg.modelSrc,
        ...(cfg.modelConfig && { modelConfig: cfg.modelConfig }),
        onProgress: (progress) => {
          if (progress % 10 === 0) {
            console.log(`      [${type}] Download progress: ${progress}%`);
          }
        },
      });

      const durationMs = Date.now() - start;
      loaded.set(type, modelId);
      logModelLoad(modelId, type, durationMs);
      return modelId;
    } catch (err) {
      log('model_load_error', { type, attempt, error: err.message });
      console.error(`      [${type}] Attempt ${attempt}/${retries} failed: ${err.message}`);

      if (attempt < retries) {
        const delay = attempt * 5000;
        console.log(`      Retrying in ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}

export async function unloadModel(type) {
  const modelId = loaded.get(type);
  if (!modelId) return;
  await qvac.unloadModel(modelId);
  loaded.delete(type);
  logModelUnload(modelId);
}

export function getModelId(type) {
  return loaded.get(type);
}

export function hasModel(type) {
  return loaded.has(type) && loaded.get(type) != null;
}

export async function loadAllModels() {
  log('models_init', { message: 'Loading models sequentially to reduce memory pressure' });

  // Load embedding model first (required for RAG)
  console.log('      Loading embedding model...');
  const embId = await loadModel('embeddings');

  // Load primary LLM (try Psy first, fallback to Qwen/Llama)
  console.log('      Loading primary LLM (Psy model)...');
  let llmId;
  try {
    llmId = await loadModel('llm');
  } catch {
    console.log('      Primary LLM failed, trying fallback...');
    llmId = await loadModel('llm-fallback');
    loaded.set('llm', llmId);
  }

  // Load vision model (non-blocking, optional)
  console.log('      Loading vision model...');
  try {
    await loadModel('vision');
  } catch (err) {
    console.log(`      Vision model skipped: ${err.message}`);
  }

  // Load TTS model (non-blocking, optional)
  console.log('      Loading TTS model...');
  try {
    await loadModel('tts');
  } catch (err) {
    console.log(`      TTS model skipped: ${err.message}`);
  }

  // Load STT model (non-blocking, optional)
  console.log('      Loading STT model...');
  try {
    await loadModel('stt');
  } catch (err) {
    console.log(`      STT model skipped: ${err.message}`);
  }

  return { llmId, embId };
}

export function getStatus() {
  const status = {};
  for (const [type, modelId] of loaded) {
    status[type] = { modelId, loaded: true, label: MODEL_CONFIGS[type]?.label };
  }
  return status;
}

export function getLoadedModels() {
  return [...loaded.entries()].map(([type, id]) => ({
    type,
    modelId: id,
    label: MODEL_CONFIGS[type]?.label,
  }));
}
