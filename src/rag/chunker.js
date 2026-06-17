const MAX_CHUNK_SIZE = 1500;
const MIN_CHUNK_SIZE = 100;
const OVERLAP_LINES = 3; // Lines of overlap between consecutive chunks

const BLOCK_PATTERNS = [
  /^(?:export\s+)?(?:async\s+)?function\s+/,
  /^(?:export\s+)?class\s+/,
  /^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?\(/,
  /^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*\(.*\)\s*=>/,
  /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+/,
  /^(?:export\s+)?interface\s+/,
  /^(?:export\s+)?type\s+/,
  /^(?:export\s+)?enum\s+/,
  /^def\s+/,
  /^class\s+.*:/,
  /^(?:pub\s+)?(?:async\s+)?fn\s+/,
  /^(?:pub\s+)?struct\s+/,
  /^(?:pub\s+)?impl\s+/,
  /^func\s+/,
  /^type\s+\w+\s+struct/,
  // Additional patterns for better boundary detection
  /^(?:export\s+)?default\s+function/,
  /^(?:export\s+)?const\s+\w+\s*:\s*\w+/,  // TypeScript const with type
  /^@\w+/,  // Decorators (Python, TS)
  /^#\[/,   // Rust attributes
];

function isBlockStart(line) {
  const trimmed = line.trimStart();
  return BLOCK_PATTERNS.some((p) => p.test(trimmed));
}

function isBlankLine(line) {
  return line.trim() === '';
}

/**
 * Extract a summary label from the first meaningful line of a chunk.
 * Used as metadata for better search relevance.
 */
function extractLabel(lines) {
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('#') && !trimmed.startsWith('*')) {
      const match = trimmed.match(/(?:function|class|const|let|var|def|fn|func|struct|impl|type|interface|enum)\s+(\w+)/);
      if (match) return match[1];
      return trimmed.slice(0, 60);
    }
  }
  return null;
}

export function chunkCode(source, filePath) {
  const lines = source.split('\n');
  const chunks = [];
  let currentChunk = [];
  let chunkStartLine = 1;

  function flushChunk() {
    const text = currentChunk.join('\n').trim();
    if (text.length >= MIN_CHUNK_SIZE) {
      const label = extractLabel(currentChunk);
      chunks.push({
        text,
        filePath,
        startLine: chunkStartLine,
        endLine: chunkStartLine + currentChunk.length - 1,
        label,
      });
    }
    currentChunk = [];
    chunkStartLine = 0;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (currentChunk.length === 0) {
      chunkStartLine = i + 1;
    }

    const currentText = currentChunk.join('\n');
    if (currentText.length > MAX_CHUNK_SIZE && isBlankLine(line)) {
      flushChunk();
      // Add overlap: include last N lines from previous chunk
      if (chunks.length > 0 && i > OVERLAP_LINES) {
        const overlapStart = Math.max(0, i - OVERLAP_LINES);
        currentChunk = lines.slice(overlapStart, i).filter(l => l.trim());
        chunkStartLine = overlapStart + 1;
      } else {
        chunkStartLine = i + 2;
      }
      continue;
    }

    if (currentChunk.length > 0 && isBlockStart(line) && currentText.length > MIN_CHUNK_SIZE) {
      flushChunk();
      // Add overlap: include last N lines from previous chunk as context
      if (chunks.length > 0 && i > OVERLAP_LINES) {
        const overlapStart = Math.max(0, i - OVERLAP_LINES);
        const overlapLines = lines.slice(overlapStart, i).filter(l => l.trim());
        if (overlapLines.length > 0) {
          currentChunk = [...overlapLines];
          chunkStartLine = overlapStart + 1;
        } else {
          chunkStartLine = i + 1;
        }
      } else {
        chunkStartLine = i + 1;
      }
    }

    currentChunk.push(line);
  }

  if (currentChunk.length > 0) {
    flushChunk();
  }

  return chunks;
}

const CODE_EXTENSIONS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt',
  '.c', '.cpp', '.h', '.hpp', '.cs',
  '.swift', '.m', '.mm',
  '.sh', '.bash', '.zsh',
  '.sql', '.graphql',
  '.vue', '.svelte',
  '.json', '.yaml', '.yml', '.toml',
  '.md', '.mdx', '.txt',
  '.css', '.scss', '.less',
  '.html', '.xml',
  '.dockerfile', '.makefile',
  '.sol', '.vy', // Smart contracts
  '.lua', '.zig', '.nim', '.ex', '.exs', // Additional languages
]);

export function isCodeFile(filePath) {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  const basename = filePath.split('/').pop().toLowerCase();
  return CODE_EXTENSIONS.has(ext) || ['makefile', 'dockerfile', 'rakefile', 'gemfile', 'justfile', 'cmakelists.txt'].includes(basename);
}
