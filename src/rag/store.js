import * as qvac from '@qvac/sdk';
import { getModelId } from '../models.js';
import { logRag } from '../logger.js';

const DEFAULT_WORKSPACE = 'devbrain-default';

export async function ingest(documents, workspace = DEFAULT_WORKSPACE) {
  const modelId = getModelId('embeddings');
  if (!modelId) throw new Error('Embedding model not loaded');

  logRag('ingest_start', { count: documents.length, workspace });

  const result = await qvac.ragIngest({
    modelId,
    documents,
    workspace,
    onProgress: (stage, current, total) => {
      if (current % 50 === 0 || current === total) {
        logRag('ingest_progress', { stage, current, total });
      }
    },
  });

  logRag('ingest_complete', {
    workspace,
    processed: result.processed?.length ?? documents.length,
    dropped: result.droppedIndices?.length ?? 0,
  });

  return result;
}

export async function search(query, workspace = DEFAULT_WORKSPACE, limit = 10) {
  const modelId = getModelId('embeddings');
  if (!modelId) throw new Error('Embedding model not loaded');

  logRag('search', { query: query.slice(0, 100), workspace, limit });

  const results = await qvac.ragSearch({
    modelId,
    query,
    workspace,
    limit,
  });

  logRag('search_results', { count: results.length });
  return results;
}

export async function embed(text) {
  const modelId = getModelId('embeddings');
  if (!modelId) throw new Error('Embedding model not loaded');
  return qvac.embed({ modelId, text });
}
