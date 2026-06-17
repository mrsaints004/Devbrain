/**
 * Router intent classification tests.
 * Tests keyword fast-paths to ensure queries are routed correctly.
 * Run: node test/router.test.js
 */

import { strict as assert } from 'node:assert';

// We test the keyword fast-paths directly (these don't need QVAC SDK)
const INTENT_PATTERNS = {
  security_audit: /\b(security\s+(?:audit|review|scan|check|assess)|vulnerability\s+(?:scan|assess|check)|penetration|pen\s?test|safety\s+(?:analysis|review|check)|threat\s+model)\b/i,
  find_bug: /\b(bug|bugs|err?ors?|issue|issues|problem|problems|wrong|broken|fix|debug|vulnerability|vulnerabilities|lint)\b/,
  refactor: /\b(refactor|improve|clean\s?up|optimize|simplify|performance)\b/,
  explain_code: /\b(explain|how\s+does|what\s+does|walk\s+me\s+through|understand|what\s+is)\b/,
  generate_docs: /\b(document|docs|documentation|jsdoc|readme|docstring)\b/,
  search_code: /\b(find|search|where|locate|grep|which\s+file)\b/,
};

function classifyByKeyword(query) {
  const q = query.toLowerCase();
  for (const [intent, pattern] of Object.entries(INTENT_PATTERNS)) {
    if (pattern.test(q)) return intent;
  }
  return 'general_question';
}

const tests = [
  // Security audit (must be tested before find_bug since pattern order matters)
  ['Run a security audit on the API', 'security_audit'],
  ['Perform a security review of authentication', 'security_audit'],
  ['Vulnerability scan the codebase', 'security_audit'],
  ['Do a penetration test assessment', 'security_audit'],
  ['Safety analysis of the payment module', 'security_audit'],
  ['Threat model the user input flow', 'security_audit'],

  // Bug finding
  ['Find bugs in the server code', 'find_bug'],
  ['There is an error in login.js', 'find_bug'],
  ['Debug this function', 'find_bug'],
  ['Fix the authentication issue', 'find_bug'],
  ['Any vulnerabilities in the API?', 'find_bug'],
  ['What problems does this have?', 'find_bug'],

  // Refactoring
  ['Refactor the database module', 'refactor'],
  ['How can I improve this code?', 'refactor'],
  ['Optimize the search algorithm', 'refactor'],
  ['Simplify this function', 'refactor'],
  ['Clean up the router', 'refactor'],

  // Explain
  ['Explain how the orchestrator works', 'explain_code'],
  ['What does the handleQuery function do?', 'explain_code'],
  ['How does P2P delegation work?', 'explain_code'],
  ['Walk me through the RAG pipeline', 'explain_code'],
  ['What is the purpose of guard.js?', 'explain_code'],

  // Docs
  ['Generate documentation for the API', 'generate_docs'],
  ['Write JSDoc for this module', 'generate_docs'],
  ['Create a README for this project', 'generate_docs'],

  // Search
  ['Find the authentication handler', 'search_code'],
  ['Where is the database connection defined?', 'search_code'],
  ['Search for all API endpoints', 'search_code'],
  ['Which file handles routing?', 'search_code'],
  ['Grep for TODO comments', 'search_code'],

  // General
  ['What frameworks does this use?', 'general_question'],
  ['Give me an overview of the project', 'general_question'],
  ['How many lines of code are there?', 'general_question'],
];

let passed = 0;
let failed = 0;

console.log('Router Intent Classification Tests\n');

for (const [query, expected] of tests) {
  const result = classifyByKeyword(query);
  if (result === expected) {
    passed++;
    console.log(`  PASS  "${query}" -> ${result}`);
  } else {
    failed++;
    console.log(`  FAIL  "${query}" -> ${result} (expected: ${expected})`);
  }
}

console.log(`\n${passed} passed, ${failed} failed out of ${tests.length} tests`);
if (failed > 0) process.exit(1);
