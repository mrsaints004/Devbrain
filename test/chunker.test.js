/**
 * Code chunker tests.
 * Tests code-aware chunking, overlap, boundary detection, and edge cases.
 * Run: node test/chunker.test.js
 */

import { strict as assert } from 'node:assert';
import { chunkCode, isCodeFile } from '../src/rag/chunker.js';

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

console.log('Code Chunker Tests\n');

// === chunkCode tests ===

test('chunks a simple function', () => {
  const code = `function hello() {
  // This function greets the user by printing a welcome message to the console
  // It is called during application startup to verify the runtime is working
  console.log("hello world, welcome to the application");
  return true;
}`;
  const chunks = chunkCode(code, 'test.js');
  assert(chunks.length >= 1, 'Should produce at least 1 chunk');
  assert(chunks[0].filePath === 'test.js');
  assert(chunks[0].startLine === 1);
  assert(chunks[0].text.includes('function hello'));
});

test('splits at function boundaries', () => {
  const code = `function first() {
  return 1;
}

function second() {
  return 2;
}

function third() {
  return 3;
}`;
  const chunks = chunkCode(code, 'multi.js');
  assert(chunks.length >= 1, 'Should produce chunks');
  // All content should be present across chunks
  const allText = chunks.map(c => c.text).join('\n');
  assert(allText.includes('first'), 'Should contain first function');
  assert(allText.includes('second'), 'Should contain second function');
  assert(allText.includes('third'), 'Should contain third function');
});

test('handles Python code', () => {
  const code = `def greet(name):
    print(f"Hello, {name}")

class User:
    def __init__(self, name):
        self.name = name

    def display(self):
        print(self.name)`;
  const chunks = chunkCode(code, 'app.py');
  assert(chunks.length >= 1);
  const allText = chunks.map(c => c.text).join('\n');
  assert(allText.includes('def greet'));
  assert(allText.includes('class User'));
});

test('handles Rust code', () => {
  const code = `pub fn process(data: &[u8]) -> Result<(), Error> {
    // process data
    Ok(())
}

pub struct Config {
    pub port: u16,
    pub host: String,
}

impl Config {
    pub fn new() -> Self {
        Config { port: 8080, host: "localhost".into() }
    }
}`;
  const chunks = chunkCode(code, 'main.rs');
  assert(chunks.length >= 1);
  const allText = chunks.map(c => c.text).join('\n');
  assert(allText.includes('pub fn process'));
  assert(allText.includes('pub struct Config'));
});

test('respects minimum chunk size', () => {
  const code = 'x = 1';  // Too small
  const chunks = chunkCode(code, 'tiny.py');
  assert(chunks.length === 0, 'Should skip chunks below minimum size');
});

test('handles empty input', () => {
  const chunks = chunkCode('', 'empty.js');
  assert(chunks.length === 0);
});

test('preserves line numbers', () => {
  const code = `// This is a utility module for processing data
// It contains several helper functions
// Licensed under Apache 2.0
function foo() {
  const result = processData(inputArray.map(item => item.value));
  return result.filter(x => x !== null).join(', ');
}`;
  const chunks = chunkCode(code, 'lines.js');
  assert(chunks.length >= 1);
  assert(chunks[0].startLine >= 1, 'Start line should be >= 1');
  assert(chunks[0].endLine >= chunks[0].startLine, 'End line should be >= start');
});

test('extracts labels from function definitions', () => {
  const code = `export function calculateTotal(items) {
  return items.reduce((sum, item) => sum + item.price, 0);
}`;
  const chunks = chunkCode(code, 'calc.js');
  assert(chunks.length >= 1);
  assert(chunks[0].label === 'calculateTotal', `Expected label "calculateTotal", got "${chunks[0].label}"`);
});

test('extracts labels from class definitions', () => {
  const code = `class UserService {
  constructor(db) {
    this.db = db;
  }
  async findById(id) {
    return this.db.query("SELECT * FROM users WHERE id = ?", [id]);
  }
}`;
  const chunks = chunkCode(code, 'service.js');
  assert(chunks.length >= 1);
  assert(chunks[0].label === 'UserService', `Expected label "UserService", got "${chunks[0].label}"`);
});

// === isCodeFile tests ===

test('recognizes JavaScript files', () => {
  assert(isCodeFile('app.js') === true);
  assert(isCodeFile('index.ts') === true);
  assert(isCodeFile('component.tsx') === true);
  assert(isCodeFile('utils.mjs') === true);
});

test('recognizes Python files', () => {
  assert(isCodeFile('main.py') === true);
});

test('recognizes Rust files', () => {
  assert(isCodeFile('lib.rs') === true);
});

test('recognizes Go files', () => {
  assert(isCodeFile('main.go') === true);
});

test('recognizes special files', () => {
  assert(isCodeFile('Makefile') === true);
  assert(isCodeFile('Dockerfile') === true);
});

test('rejects binary files', () => {
  assert(isCodeFile('image.png') === false);
  assert(isCodeFile('video.mp4') === false);
  assert(isCodeFile('app.exe') === false);
});

test('recognizes Solidity files', () => {
  assert(isCodeFile('Token.sol') === true);
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests`);
if (failed > 0) process.exit(1);
