import { search } from '../rag/store.js';
import { logAgent } from '../logger.js';

export async function searchCode(query, workspace, limit = 4) {
  logAgent('rag', 'search', { query: query.slice(0, 100), limit });

  try {
    const results = await search(query, workspace, limit);

    const chunks = results.map((r, i) => ({
      rank: i + 1,
      content: r.document || r.text || r.content || String(r),
      score: r.score ?? r.similarity ?? null,
    }));

    logAgent('rag', 'search_done', { resultsCount: chunks.length });
    return chunks;
  } catch (err) {
    logAgent('rag', 'search_error', { error: err.message });
    // Return empty results — orchestrator will fall back to tool agent
    return [];
  }
}

const MAX_CONTEXT_CHARS = 3000; // Stay well within 4096 token context window

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
