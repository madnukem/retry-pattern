// tests/integration.test.js — Integration tests for retry-hook use-cases

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function createTestSuite(name) {
  const tempDir = path.join(__dirname, '.temp-integration-' + Date.now());
  fs.mkdirSync(tempDir, { recursive: true });

  let passed = 0;
  let failed = 0;

  return {
    tempDir,
    test(description, fn) {
      try {
        // Clear state before each test
        const stateFile = path.join(tempDir, 'retry-state.json');
        if (fs.existsSync(stateFile)) {
          fs.unlinkSync(stateFile);
        }

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
      fs.rmSync(tempDir, { recursive: true, force: true });
      process.exit(failed > 0 ? 1 : 0);
    }
  };
}

const suite = createTestSuite('Retry Integration Tests');

// Mock hook input
function createHookInput(tool, command, exitCode, stderr) {
  return JSON.stringify({ tool, command, exitCode, stderr });
}

// Helper: run hook and capture output
function runHook(input, tempDir) {
  const hookPath = path.join(__dirname, '../hooks/retry-hook.js');
  const tmpInput = path.join(tempDir, 'input.json');
  fs.writeFileSync(tmpInput, input);

  try {
    const output = execSync(`node ${hookPath} < ${tmpInput}`, {
      env: { ...process.env, RETRY_STATE_DIR: tempDir },
      encoding: 'utf8',
    });
    return { success: true, output };
  } catch (err) {
    return { success: false, error: err.message, output: err.stdout || '' };
  }
}

// Helper: read retry state
function readState(tempDir) {
  const stateFile = path.join(tempDir, 'retry-state.json');
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return {};
  }
}

// === Use Case 1: npm install timeout ===
suite.test('use-case: npm install timeout triggers retry', () => {
  const input = createHookInput(
    'Bash',
    'npm install',
    'ETIMEDOUT',
    'npm ERR! network timeout at https://registry.npmjs.org'
  );

  const result = runHook(input, suite.tempDir);
  if (!result.success) throw new Error('Hook should succeed');

  const output = result.output || '';
  if (!output.includes('Retry Pattern')) {
    throw new Error('Expected retry message in output');
  }
  if (!output.includes('attempt 1/3')) {
    throw new Error('Expected attempt count in output');
  }
});

// === Use Case 2: git push connection reset ===
suite.test('use-case: git push ECONNRESET triggers retry', () => {
  const input = createHookInput(
    'Bash',
    'git push',
    'ECONNRESET',
    'fatal: read error: Connection reset by peer'
  );

  const result = runHook(input, suite.tempDir);
  if (!result.success) throw new Error('Hook should succeed');

  const state = readState(suite.tempDir);
  const fp = Object.keys(state)[0];
  if (!fp) throw new Error('Expected state entry');

  if (state[fp].count !== 1) {
    throw new Error(`Expected count=1, got ${state[fp].count}`);
  }
  if (state[fp].exitCode !== 'ECONNRESET') {
    throw new Error(`Expected exitCode=ECONNRESET, got ${state[fp].exitCode}`);
  }
});

// === Use Case 3: curl temporary failure with suggested backoff ===
suite.test('use-case: curl temporary failure with suggested backoff', () => {
  const input = createHookInput(
    'Bash',
    'curl https://api.example.com/data',
    null,
    'Temporary failure, retrying in 5 seconds...'
  );

  const result = runHook(input, suite.tempDir);
  if (!result.success) throw new Error('Hook should succeed');

  const state = readState(suite.tempDir);
  const fp = Object.keys(state)[0];
  if (!fp) throw new Error('Expected state entry');

  // Should extract backoff from stderr
  if (state[fp].backoff !== 5000) {
    throw new Error(`Expected backoff=5000ms, got ${state[fp].backoff}`);
  }
});

// === Use Case 4: Non-retryable error (permission denied) ===
suite.test('use-case: permission denied does NOT trigger retry', () => {
  const input = createHookInput(
    'Bash',
    'cat /root/secrets',
    'EACCES',
    'cat: /root/secrets: Permission denied'
  );

  const result = runHook(input, suite.tempDir);
  if (!result.success) throw new Error('Hook should succeed');

  const output = result.output || '';
  if (output.includes('Retry Pattern')) {
    throw new Error('Should NOT output retry message for permission denied');
  }

  const state = readState(suite.tempDir);
  if (Object.keys(state).length > 0) {
    throw new Error('State should be empty for non-retryable errors');
  }
});

// === Use Case 5: Syntax error is not retryable ===
suite.test('use-case: syntax error does NOT trigger retry', () => {
  const input = createHookInput(
    'Bash',
    'node script.js',
    '1',
    'SyntaxError: Unexpected token'
  );

  const result = runHook(input, suite.tempDir);
  if (!result.success) throw new Error('Hook should succeed');

  const state = readState(suite.tempDir);
  if (Object.keys(state).length > 0) {
    throw new Error('State should be empty for syntax errors');
  }
});

// === Use Case 6: Multiple retries until max ===
suite.test('use-case: multiple retries stop at max (3)', () => {
  const input = createHookInput(
    'Bash',
    'npm install',
    'ETIMEDOUT',
    'network timeout'
  );

  // First retry (count 0 -> 1)
  runHook(input, suite.tempDir);

  // Second retry (count 1 -> 2)
  let state = readState(suite.tempDir);
  const fp = Object.keys(state)[0];
  state[fp].count = 1;
  fs.writeFileSync(path.join(suite.tempDir, 'retry-state.json'), JSON.stringify(state));
  runHook(input, suite.tempDir);

  // Third retry (count 2 -> 3)
  state = readState(suite.tempDir);
  state[fp].count = 2;
  fs.writeFileSync(path.join(suite.tempDir, 'retry-state.json'), JSON.stringify(state));
  runHook(input, suite.tempDir);

  state = readState(suite.tempDir);
  if (state[fp] && state[fp].count !== 3) {
    throw new Error(`Expected count=3, got ${state[fp]?.count}`);
  }

  // Fourth attempt should trigger max retries message
  state[fp].count = 3;
  fs.writeFileSync(path.join(suite.tempDir, 'retry-state.json'), JSON.stringify(state));

  const result = runHook(input, suite.tempDir);
  if (!result.success) throw new Error('Fourth call should succeed');

  const output = result.output || '';
  if (!output.includes('max retries (3) exceeded')) {
    throw new Error('Expected max retries exceeded message');
  }

  // State should be cleared
  state = readState(suite.tempDir);
  if (state[fp]) {
    throw new Error('State should be cleared after max retries');
  }
});

// === Use Case 7: Success clears retry state ===
suite.test('use-case: successful run clears previous retry state', () => {
  // First, create a retry state
  const retryInput = createHookInput(
    'Bash',
    'npm install',
    'ETIMEDOUT',
    'timeout'
  );
  runHook(retryInput, suite.tempDir);

  let state = readState(suite.tempDir);
  if (Object.keys(state).length === 0) {
    throw new Error('Expected state entry after retry');
  }

  // Now simulate success
  const successInput = createHookInput(
    'Bash',
    'npm install',
    '0',
    'added 125 packages in 3s'
  );
  runHook(successInput, suite.tempDir);

  state = readState(suite.tempDir);
  if (Object.keys(state).length > 0) {
    throw new Error('State should be cleared after success');
  }
});

// === Use Case 8: Different commands have separate state ===
suite.test('use-case: different commands track retry state separately', () => {
  const cmd1 = createHookInput('Bash', 'npm install', 'ETIMEDOUT', 'timeout');
  const cmd2 = createHookInput('Bash', 'git push', 'ECONNRESET', 'reset');

  runHook(cmd1, suite.tempDir);
  runHook(cmd2, suite.tempDir);

  const state = readState(suite.tempDir);
  const fingerprints = Object.keys(state);

  if (fingerprints.length !== 2) {
    throw new Error(`Expected 2 state entries, got ${fingerprints.length}`);
  }
});

// === Use Case 9: Exponential backoff progression ===
suite.test('use-case: exponential backoff increases with attempts', () => {
  const input = createHookInput(
    'Bash',
    'curl https://api.example.com',
    'ETIMEDOUT',
    'timeout'
  );

  // First attempt
  runHook(input, suite.tempDir);
  let state = readState(suite.tempDir);
  const fp = Object.keys(state)[0];
  const b1 = state[fp].backoff;

  // Prepare second attempt
  state[fp].count = 1;
  fs.writeFileSync(path.join(suite.tempDir, 'retry-state.json'), JSON.stringify(state));

  runHook(input, suite.tempDir);
  state = readState(suite.tempDir);
  const b2 = state[fp].backoff;

  // Second backoff should be 2x first (2000 vs 1000)
  if (b2 !== b1 * 2) {
    throw new Error(`Expected backoff=${b1*2}, got ${b2}`);
  }
});

// === Use Case 10: Non-Bash tools are ignored ===
suite.test('use-case: Read/Write tools do not trigger retry logic', () => {
  const input = createHookInput(
    'Read',
    '/path/to/file.txt',
    null,
    'some error'
  );

  const result = runHook(input, suite.tempDir);
  if (!result.success) throw new Error('Hook should succeed');

  const state = readState(suite.tempDir);
  if (Object.keys(state).length > 0) {
    throw new Error('Non-Bash tools should not create state');
  }
});

// === Use Case 11: First retry uses 1s backoff ===
suite.test('use-case: first retry uses 1000ms backoff', () => {
  const input = createHookInput(
    'Bash',
    'npm install',
    'ETIMEDOUT',
    'timeout'
  );

  runHook(input, suite.tempDir);
  const state = readState(suite.tempDir);
  const fp = Object.keys(state)[0];

  if (state[fp].backoff !== 1000) {
    throw new Error(`Expected backoff=1000ms, got ${state[fp].backoff}`);
  }
});

// === Use Case 12: Backoff caps at 8s ===
suite.test('use-case: backoff caps at 8000ms for high attempts', () => {
  const input = createHookInput(
    'Bash',
    'curl https://api.example.com',
    'ETIMEDOUT',
    'timeout'
  );

  // First run to get the fingerprint
  runHook(input, suite.tempDir);
  let state = readState(suite.tempDir);
  const fp = Object.keys(state)[0];

  // Simulate attempt 2 (still within limit, but backoff would be 4s)
  state[fp].count = 2;
  fs.writeFileSync(path.join(suite.tempDir, 'retry-state.json'), JSON.stringify(state));

  runHook(input, suite.tempDir);
  state = readState(suite.tempDir);

  // With count=2, backoff = 1000 * 2^2 = 4000ms (within cap)
  if (state[fp].backoff !== 4000) {
    throw new Error(`Expected backoff=4000ms, got ${state[fp].backoff}`);
  }

  // Now test the cap - simulate what would be a high backoff
  // Manually set count to a value that would exceed cap without the cap
  // calculateBackoff(10) = 1000 * 2^10 = 1024000ms -> capped to 8000ms
  // But we can't test this directly because count=10 > MAX_RETRIES
  // So we test by checking the cap constant
  const { calculateBackoff, MAX_BACKOFF_MS } = require('../lib/retry');
  const capped = calculateBackoff(100);
  if (capped !== MAX_BACKOFF_MS) {
    throw new Error(`Expected calculateBackoff to cap at ${MAX_BACKOFF_MS}ms, got ${capped}ms`);
  }
});

suite.summary();
