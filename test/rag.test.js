/**
 * RAG formatting and context tests.
 * Tests context formatting, truncation, and edge cases.
 * Run: node test/rag.test.js
 */

import { strict as assert } from 'node:assert';
import { formatContext } from '../src/agents/rag.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}: ${err.message}`);
  }
}

console.log('RAG Context Formatting Tests\n');

test('formats chunks with rank and score', () => {
  const chunks = [
    { rank: 1, content: 'function hello() { return "world"; }', score: 0.95 },
    { rank: 2, content: 'const greeting = "hello";', score: 0.82 },
  ];
  const context = formatContext(chunks);
  assert(context.includes('Result 1'));
  assert(context.includes('Result 2'));
  assert(context.includes('0.950'));
  assert(context.includes('function hello'));
  assert(context.includes('greeting'));
});

test('handles empty chunks array', () => {
  const context = formatContext([]);
  assert(context.includes('No relevant code found'));
});

test('handles chunks with null score', () => {
  const chunks = [
    { rank: 1, content: 'some code', score: null },
  ];
  const context = formatContext(chunks);
  assert(context.includes('N/A'));
});

test('truncates context to stay within limits', () => {
  const longContent = 'x'.repeat(2000);
  const chunks = [
    { rank: 1, content: longContent, score: 0.9 },
    { rank: 2, content: longContent, score: 0.8 },
    { rank: 3, content: longContent, score: 0.7 },
  ];
  const context = formatContext(chunks);
  // Should not exceed ~4500 chars
  assert(context.length <= 5000, `Context too long: ${context.length}`);
});

test('preserves order by rank', () => {
  const chunks = [
    { rank: 1, content: 'FIRST', score: 0.9 },
    { rank: 2, content: 'SECOND', score: 0.8 },
    { rank: 3, content: 'THIRD', score: 0.7 },
  ];
  const context = formatContext(chunks);
  const firstIdx = context.indexOf('FIRST');
  const secondIdx = context.indexOf('SECOND');
  assert(firstIdx < secondIdx, 'First result should appear before second');
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests`);
if (failed > 0) process.exit(1);
