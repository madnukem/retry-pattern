// tests/retry.test.js — Retry Pattern tests

'use strict';

const fs = require('fs');
const path = require('path');

// Test helpers
function createTestSuite(name) {
  const tempDir = path.join(__dirname, '.temp-' + Date.now());
  fs.mkdirSync(tempDir, { recursive: true });

  let passed = 0;
  let failed = 0;

  return {
    tempDir,
    test(description, fn) {
      try {
        fn();
        console.log(`  PASS: ${description}`);
        passed++;
      } catch (err) {
        console.log(`  FAIL: ${description}`);
        console.log(`    ${err.message}`);
        failed++;
      }
    },
    summary() {
      console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
      process.exit(failed > 0 ? 1 : 0);
    }
  };
}

// Import retry functions
const { isRetryable, extractBackoffDelay, shouldRetry } = require('../lib/retry');

// Run tests
const suite = createTestSuite('Retry Pattern');

suite.test('detects ETIMEDOUT as retryable', () => {
  const result = isRetryable('ETIMEDOUT', '');
  if (result !== true) throw new Error('Expected true for ETIMEDOUT');
});

suite.test('detects ECONNREFUSED as retryable', () => {
  const result = isRetryable('ECONNREFUSED', '');
  if (result !== true) throw new Error('Expected true for ECONNREFUSED');
});

suite.test('detects ECONNRESET as retryable', () => {
  const result = isRetryable('ECONNRESET', '');
  if (result !== true) throw new Error('Expected true for ECONNRESET');
});

suite.test('detects network keyword in stderr as retryable', () => {
  const result = isRetryable('', 'network unreachable');
  if (result !== true) throw new Error('Expected true for network keyword');
});

suite.test('detects temporary keyword in stderr as retryable', () => {
  const result = isRetryable('', 'temporary failure');
  if (result !== true) throw new Error('Expected true for temporary keyword');
});

suite.test('rejects permanent errors as non-retryable', () => {
  const result = isRetryable('', 'permission denied');
  if (result !== false) throw new Error('Expected false for permission denied');
});

suite.test('rejects syntax errors as non-retryable', () => {
  const result = isRetryable('', 'SyntaxError');
  if (result !== false) throw new Error('Expected false for SyntaxError');
});

suite.test('extracts backoff delay from stderr (npm)', () => {
  const stderr = 'Retrying in 5 seconds...';
  const delay = extractBackoffDelay(stderr);
  if (delay !== 5000) throw new Error(`Expected 5000ms, got ${delay}`);
});

suite.test('extracts backoff delay from stderr (curl)', () => {
  const stderr = 'retry after 2s';
  const delay = extractBackoffDelay(stderr);
  if (delay !== 2000) throw new Error(`Expected 2000ms, got ${delay}`);
});

suite.test('returns null for no backoff in stderr', () => {
  const delay = extractBackoffDelay('random error');
  if (delay !== null) throw new Error(`Expected null, got ${delay}`);
});

suite.test('shouldRetry allows first retry (count=0)', () => {
  const result = shouldRetry(0, 3);
  if (result !== true) throw new Error('Expected true for count=0');
});

suite.test('shouldRetry allows second retry (count=1)', () => {
  const result = shouldRetry(1, 3);
  if (result !== true) throw new Error('Expected true for count=1');
});

suite.test('shouldRetry blocks beyond max retries', () => {
  const result = shouldRetry(3, 3);
  if (result !== false) throw new Error('Expected false for count=3');
});

suite.test('calculates exponential backoff correctly', () => {
  const { calculateBackoff } = require('../lib/retry');
  const delays = [1000, 2000, 4000]; // 1s, 2s, 4s
  for (let i = 0; i < delays.length; i++) {
    const delay = calculateBackoff(i);
    if (delay !== delays[i]) throw new Error(`Attempt ${i}: expected ${delays[i]}ms, got ${delay}ms`);
  }
});

suite.test('caps exponential backoff at max delay', () => {
  const { calculateBackoff } = require('../lib/retry');
  const delay = calculateBackoff(10); // Would be 1024s, should cap
  if (delay > 8000) throw new Error(`Expected delay <= 8000ms, got ${delay}ms`);
});

suite.summary();
