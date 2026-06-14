#!/usr/bin/env node
// hooks/retry-hook.js — PostToolUse hook: detects retryable errors and signals retry

'use strict';

const fs = require('fs');
const path = require('path');

// Configuration via environment variables
const MAX_RETRIES = parseInt(process.env.RETRY_MAX_RETRIES || '3', 10);
const STATE_DIR = process.env.RETRY_STATE_DIR || path.join(require('os').homedir(), '.claude');

// State file for tracking retry attempts
const STATE_FILE = path.join(STATE_DIR, 'retry-state.json');

// Import retry logic
const { isRetryable, extractBackoffDelay, calculateBackoff, shouldRetry } = require('../lib/retry');

/**
 * Load retry state from disk.
 */
function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Save retry state to disk.
 */
function saveState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Generate a fingerprint for a tool invocation.
 * Groups retryable errors from the same command together.
 */
function fingerprint(tool, command) {
  // Normalize command by removing variable parts
  const normalized = command
    .replace(/\d+/g, 'N')           // numbers → N
    .replace(/[a-f0-9]{8,}/gi, '<h>') // hashes → <h>
    .replace(/["'][^"']*["']/g, '"..."') // quoted strings → "..."
    .substring(0, 200);              // truncate

  return `${tool}:${normalized}`;
}

/**
 * Main hook logic.
 */
function main() {
  // Read hook input from stdin
  let input = '';
  for (const chunk of process.stdin) {
    input += chunk;
  }

  let data;
  try {
    data = JSON.parse(input);
  } catch {
    // No input or invalid JSON — nothing to do
    process.exit(0);
  }

  const { tool, command, exitCode, stderr } = data;

  // Only process Bash tool calls
  if (tool !== 'Bash') {
    process.exit(0);
  }

  // Check if error is retryable
  if (!isRetryable(String(exitCode || ''), stderr || '')) {
    // Clear retry state for this fingerprint on success
    const fp = fingerprint(tool, command);
    const state = loadState();
    delete state[fp];
    saveState(state);
    process.exit(0);
  }

  // Error is retryable — check retry state
  const fp = fingerprint(tool, command);
  const state = loadState();
  const entry = state[fp] || { count: 0, lastAttempt: 0 };

  const now = Date.now();
  const attempt = entry.count + 1;

  // Check if we should retry
  if (!shouldRetry(attempt, MAX_RETRIES)) {
    console.log(`Retry Pattern: max retries (${MAX_RETRIES}) exceeded for: ${command.substring(0, 100)}`);
    delete state[fp];
    saveState(state);
    process.exit(0);
  }

  // Calculate backoff delay
  const suggestedBackoff = extractBackoffDelay(stderr || '');
  const backoff = suggestedBackoff || calculateBackoff(attempt);

  // Update state
  state[fp] = {
    count: attempt,
    lastAttempt: now,
    backoff,
    command: command.substring(0, 200),
    exitCode,
  };
  saveState(state);

  // Output retry recommendation
  const delaySec = (backoff / 1000).toFixed(1);
  console.log(`Retry Pattern: retryable error detected (attempt ${attempt}/${MAX_RETRIES}).`);
  console.log(`Recommendation: wait ${delaySec}s before retrying, then re-run: ${command.substring(0, 80)}...`);

  process.exit(0);
}

main();
