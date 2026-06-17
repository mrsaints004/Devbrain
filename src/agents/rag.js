import { search } from '../rag/store.js';
import { logAgent, logInference } from '../logger.js';
import * as qvac from '@qvac/sdk';
import { getModelId } from '../models.js';

export async function searchCode(query, workspace, limit = 8) {
  logAgent('rag', 'search', { query: query.slice(0, 100), limit });

  try {
    const results = await search(query, workspace, limit);

    if (!Array.isArray(results)) {
      logAgent('rag', 'search_unexpected_format', { type: typeof results, keys: results ? Object.keys(results) : [] });
      // Handle case where QVAC returns { results: [...] } or similar wrapper
      const items = results?.results || results?.documents || results?.matches || [];
      if (Array.isArray(items) && items.length > 0) {
        return items.map((r, i) => ({
          rank: i + 1,
          content: r.document || r.text || r.content || String(r),
          score: r.score ?? r.similarity ?? null,
        }));
      }
      return [];
    }

    const chunks = results.map((r, i) => ({
      rank: i + 1,
      content: r.document || r.text || r.content || String(r),
      score: r.score ?? r.similarity ?? null,
    }));

    logAgent('rag', 'search_done', { resultsCount: chunks.length });
    return chunks;
  } catch (err) {
    logAgent('rag', 'search_error', { error: err.message });
    return [];
  }
}

export async function rerankResults(query, chunks, topK = 5) {
  if (chunks.length <= topK) return chunks;

  const modelId = getModelId('llm');
  if (!modelId) return chunks.slice(0, topK); // Fallback: just take top-K by vector score

  logAgent('reranker', 'start', { candidates: chunks.length, topK });
  const start = Date.now();

  const candidateList = chunks.map((c, i) =>
    `[${i}] ${c.content.slice(0, 200).replace(/\n/g, ' ')}`
  ).join('\n');

  try {
    const run = qvac.completion({
      modelId,
      history: [
        {
          role: 'system',
          content: `You are a relevance scorer. Given a query and numbered code snippets, return ONLY the indices of the ${topK} most relevant snippets as a comma-separated list. Example: 0,3,1,4,2. Order by relevance (most relevant first). Respond with ONLY the numbers.`,
        },
        {
          role: 'user',
          content: `Query: ${query}\n\nSnippets:\n${candidateList}`,
        },
      ],
      stream: false,
      generationParams: { temp: 0, predict: 64 },
    });

    const result = await run.final;
    const durationMs = Date.now() - start;
    const responseText = (result.contentText || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    logInference({
      modelId,
      prompt: `[reranker] ${query.slice(0, 60)}`,
      tokensIn: result.stats?.cacheTokens,
      tokensOut: result.stats?.generatedTokens,
      ttft: result.stats?.timeToFirstToken,
      tps: result.stats?.tokensPerSecond,
      durationMs,
      agent: 'reranker',
    });

    const indices = responseText
      .split(/[,\s]+/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n >= 0 && n < chunks.length);

    const seen = new Set();
    const reranked = [];
    for (const idx of indices) {
      if (!seen.has(idx)) {
        seen.add(idx);
        reranked.push({ ...chunks[idx], rank: reranked.length + 1 });
      }
      if (reranked.length >= topK) break;
    }

    if (reranked.length < topK) {
      for (const chunk of chunks) {
        if (reranked.length >= topK) break;
        const origIdx = chunks.indexOf(chunk);
        if (!seen.has(origIdx)) {
          seen.add(origIdx);
          reranked.push({ ...chunk, rank: reranked.length + 1 });
        }
      }
    }

    logAgent('reranker', 'done', { kept: reranked.length, durationMs });
    return reranked;
  } catch (err) {
    logAgent('reranker', 'error', { error: err.message });
    return chunks.slice(0, topK);
  }
}

const MAX_CONTEXT_CHARS = 4500;

export function formatContext(chunks) {
  if (chunks.length === 0) return 'No relevant code found in the indexed codebase.';

  let context = '';
  for (const c of chunks) {
    const block = `--- Result ${c.rank} (score: ${c.score?.toFixed(3) ?? 'N/A'}) ---\n${c.content}\n\n`;
    if (context.length + block.length > MAX_CONTEXT_CHARS) break;
    context += block;
  }
  return context.trim() || 'No relevant code found in the indexed codebase.';
}
