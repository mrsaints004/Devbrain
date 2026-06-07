/**
 * Code-aware chunking: splits source files into logical blocks
 * (functions, classes, import groups) rather than naive character splits.
 */

const MAX_CHUNK_SIZE = 1500;
const MIN_CHUNK_SIZE = 100;

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
];

function isBlockStart(line) {
  const trimmed = line.trimStart();
  return BLOCK_PATTERNS.some((p) => p.test(trimmed));
}

function isBlankLine(line) {
  return line.trim() === '';
}

export function chunkCode(source, filePath) {
  const lines = source.split('\n');
  const chunks = [];
  let currentChunk = [];
  let chunkStartLine = 1;

  function flushChunk() {
    const text = currentChunk.join('\n').trim();
    if (text.length >= MIN_CHUNK_SIZE) {
      chunks.push({
        text,
        filePath,
        startLine: chunkStartLine,
        endLine: chunkStartLine + currentChunk.length - 1,
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
      chunkStartLine = i + 2;
      continue;
    }

    if (currentChunk.length > 0 && isBlockStart(line) && currentText.length > MIN_CHUNK_SIZE) {
      flushChunk();
      chunkStartLine = i + 1;
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
]);

export function isCodeFile(filePath) {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  const basename = filePath.split('/').pop().toLowerCase();
  return CODE_EXTENSIONS.has(ext) || ['makefile', 'dockerfile', 'rakefile', 'gemfile'].includes(basename);
}
