#!/usr/bin/env node
// payload.test.js — Payload completeness test (T1 + T4 from SKILL-REQUIREMENTS.md)
//
// Regression for INCIDENT-2026-06-15-tdd-workflow-unknown:
// package.json without `files` whitelist produces a tarball missing hooks/,
// lib/, registry/ — installed users get a broken skill.
//
// This test runs `npm pack --dry-run --json` and asserts that every file in
// hooks/ and lib/ is actually present in the tarball output. It also copies
// the package into a temp dir and runs each hook to catch MODULE_NOT_FOUND
// regressions (the "works in dev, breaks in prod" failure mode).

'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

function createTestSuite() {
  let passed = 0;
  let failed = 0;
  return {
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
    results() {
      console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
      return failed > 0 ? 1 : 0;
    },
  };
}

const { test, assert, results } = (() => {
  const suite = createTestSuite();
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  return { test: suite.test, assert, results: suite.results };
})();

const PKG_ROOT = path.join(__dirname, '..');
const pkg = require(path.join(PKG_ROOT, 'package.json'));

function listFiles(dir) {
  const full = path.join(PKG_ROOT, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full)
    .filter(f => f.endsWith('.js'))
    .map(f => `${dir}/${f}`);
}

const HOOK_FILES = listFiles('hooks');
const LIB_FILES = listFiles('lib');

function npmPackFiles() {
  const out = execSync('npm pack --dry-run --json', {
    cwd: PKG_ROOT,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(out);
  return parsed[0].files.map(f => f.path);
}

// ── Tarball contains required directories ──────────────────────────────────

test('package.json declares a files whitelist', () => {
  assert(Array.isArray(pkg.files) && pkg.files.length > 0,
    'package.json must have a non-empty "files" array — without it npm pack ' +
    'drops hooks/ and lib/ (root cause of INCIDENT-2026-06-15)');
});

test('npm pack includes hooks/', () => {
  const files = npmPackFiles();
  assert(files.some(f => f.startsWith('hooks/')),
    `hooks/ missing from npm pack output. Files:\n${files.join('\n')}`);
});

test('npm pack includes lib/', () => {
  const files = npmPackFiles();
  assert(files.some(f => f.startsWith('lib/')),
    `lib/ missing from npm pack output. Files:\n${files.join('\n')}`);
});

test('npm pack includes SKILL.md at root', () => {
  const files = npmPackFiles();
  assert(files.includes('SKILL.md'),
    `SKILL.md missing from npm pack root. Files:\n${files.join('\n')}`);
});

test('npm pack includes every hook file', () => {
  const files = npmPackFiles();
  for (const h of HOOK_FILES) {
    assert(files.includes(h),
      `${h} missing from npm pack output. Files:\n${files.join('\n')}`);
  }
});

test('npm pack includes every lib file', () => {
  const files = npmPackFiles();
  for (const l of LIB_FILES) {
    assert(files.includes(l),
      `${l} missing from npm pack output. Files:\n${files.join('\n')}`);
  }
});

// ── End-to-end install test (T4) ────────────────────────────────────────────
//
// Copy the package into a temp dir (simulating `npm install` extraction) and
// run every hook from there with empty stdin. Catches MODULE_NOT_FOUND-style
// regressions where the hook resolves paths relative to the source repo.

test('every hook runs from a fresh install copy without MODULE_NOT_FOUND', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `${pkg.name}-install-`));
  try {
    const installed = path.join(tmp, 'package');
    fs.mkdirSync(installed);
    for (const entry of pkg.files) {
      const src = path.join(PKG_ROOT, entry);
      const dst = path.join(installed, entry);
      if (!fs.existsSync(src)) continue;
      const stat = fs.statSync(src);
      if (stat.isDirectory()) {
        fs.mkdirSync(dst, { recursive: true });
        fs.cpSync(src, dst, { recursive: true });
      } else {
        fs.copyFileSync(src, dst);
      }
    }
    for (const h of HOOK_FILES) {
      const hookPath = path.join(installed, h);
      assert(fs.existsSync(hookPath), `install copy missing ${h}`);
    }
    for (const h of HOOK_FILES) {
      const rel = h; // hooks/foo-hook.js
      let out = '';
      try {
        out = execSync(
          `node ${rel}`,
          { cwd: installed, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
            input: '{}',
            env: { ...process.env, AUDIT_ENABLED: '0', AUDIT_LOG: path.join(tmp, 'noop.log') },
            timeout: 5000 }
        );
      } catch (err) {
        // Hook may exit non-zero (no real hook input, --help unsupported).
        // That is fine — we only care that it didn't die of MODULE_NOT_FOUND.
        out = (err.stdout || '') + (err.stderr || '');
      }
      assert(!/MODULE_NOT_FOUND/.test(out),
        `${h} printed MODULE_NOT_FOUND from install copy:\n${out}`);
      assert(!/Cannot find module/.test(out),
        `${h} printed "Cannot find module" from install copy:\n${out}`);
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});

// ── README install instructions reference hooks + lib ─────────────────────

test('README mentions hooks/ in install instructions', () => {
  const readmePath = path.join(PKG_ROOT, 'README.md');
  if (!fs.existsSync(readmePath)) return;
  const readme = fs.readFileSync(readmePath, 'utf8');
  assert(/hooks/.test(readme), 'README must mention hooks/ for installation');
});

const code = results();
process.exit(code);
