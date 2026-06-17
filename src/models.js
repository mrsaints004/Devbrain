import * as qvac from '@qvac/sdk';
import { logModelLoad, logModelUnload, log } from './logger.js';

const loaded = new Map();

const MODEL_CONFIGS = {
  llm: {
    modelSrc: qvac.QWEN3_4B_INST_Q4_K_M,
    modelType: 'llm',
    label: 'Qwen3 4B Q4_K_M',
    modelConfig: { ctx_size: 8192 },
  },
  embeddings: {
    modelSrc: qvac.GTE_LARGE_FP16,
    modelType: 'embeddings',
    label: 'GTE-Large FP16',
    modelConfig: {
      gpuLayers: 99,
      device: 'gpu',
    },
  },
  vision: {
    modelSrc: qvac.QWEN3VL_2B_MULTIMODAL_Q4_K,
    modelType: 'llm',
    label: 'Qwen3-VL 2B',
    modelConfig: {
      ctx_size: 4096,
      projectionModelSrc: qvac.MMPROJ_QWEN3VL_2B_MULTIMODAL_Q4_K,
    },
  },
  stt: {
    modelSrc: qvac.WHISPER_BASE_Q0F16 || qvac.WHISPER_SMALL_Q0F16,
    modelType: 'whisper',
    label: 'Whisper Base',
    modelConfig: {
      language: 'en',
      strategy: 'greedy',
    },
  },
  medpsy: {
    modelSrc: 'https://huggingface.co/qvac/MedPsy-4B-GGUF/resolve/main/medpsy-4b-q4_k_m-imat.gguf',
    modelType: 'llm',
    label: 'MedPsy 4B Q4_K_M',
    modelConfig: { ctx_size: 8192 },
  },
  tts: {
    modelSrc: qvac.TTS_SUPERTONIC2_OFFICIAL_TEXT_ENCODER_SUPERTONE_FP32?.src,
    modelType: 'tts',
    label: 'Supertonic2 TTS',
    modelConfig: {
      ttsEngine: 'supertonic',
      language: 'en',
      ttsSpeed: 1.05,
      ttsNumInferenceSteps: 5,
      ttsSupertonicMultilingual: true,
      ttsTextEncoderSrc: qvac.TTS_SUPERTONIC2_OFFICIAL_TEXT_ENCODER_SUPERTONE_FP32?.src,
      ttsDurationPredictorSrc: qvac.TTS_SUPERTONIC2_OFFICIAL_DURATION_PREDICTOR_SUPERTONE_FP32?.src,
      ttsVectorEstimatorSrc: qvac.TTS_SUPERTONIC2_OFFICIAL_VECTOR_ESTIMATOR_SUPERTONE_FP32?.src,
      ttsVocoderSrc: qvac.TTS_SUPERTONIC2_OFFICIAL_VOCODER_SUPERTONE_FP32?.src,
      ttsUnicodeIndexerSrc: qvac.TTS_SUPERTONIC2_OFFICIAL_UNICODE_INDEXER_SUPERTONE_FP32?.src,
      ttsTtsConfigSrc: qvac.TTS_SUPERTONIC2_OFFICIAL_TTS_CONFIG_SUPERTONE?.src,
      ttsVoiceStyleSrc: qvac.TTS_SUPERTONIC2_OFFICIAL_VOICE_STYLE_SUPERTONE?.src,
    },
  },
};

export async function loadModel(type, retries = 3) {
  if (loaded.has(type)) return loaded.get(type);

  const cfg = MODEL_CONFIGS[type];
  if (!cfg) throw new Error(`Unknown model type: ${type}`);

  if (!cfg.modelSrc) {
    log('model_unavailable', { type, label: cfg.label, message: 'Not available in SDK' });
    return null;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    log('model_loading', { type, label: cfg.label, attempt, maxAttempts: retries });
    const start = Date.now();

    try {
      const loadOpts = {
        modelSrc: cfg.modelSrc,
        modelType: cfg.modelType,
        ...(cfg.modelConfig && { modelConfig: cfg.modelConfig }),
        onProgress: (() => {
          let lastLogged = -1;
          return (progress) => {
            const pct = typeof progress === 'number' ? progress : progress?.percentage;
            if (pct == null) return;
            const rounded = Math.floor(pct / 10) * 10; // log at 0, 10, 20, ... 100
            if (rounded > lastLogged) {
              lastLogged = rounded;
              console.log(`      [${type}] ${rounded}%`);
            }
          };
        })(),
      };

      const modelId = await qvac.loadModel(loadOpts);

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
  await qvac.unloadModel({ modelId });
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
  log('models_init', { message: 'Sequential load to reduce memory pressure' });

  const embId = await loadModel('embeddings');
  const llmId = await loadModel('llm');

  let medpsyId = null;
  try {
    medpsyId = await loadModel('medpsy');
    console.log('  [core] MedPsy 4B loaded.');
  } catch (err) {
    console.log(`  [core] MedPsy skipped: ${err.message}`);
  }

  // Load optional models (vision, stt, tts) in background after core models
  loadOptionalModels().catch(() => {});

  return { llmId, embId, medpsyId };
}

async function loadOptionalModels() {
  for (const type of ['vision', 'stt', 'tts']) {
    try {
      await loadModel(type, 1);
      console.log(`  [background] ${type} loaded.`);
    } catch (err) {
      console.log(`  [background] ${type} skipped: ${err.message}`);
    }
  }
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
