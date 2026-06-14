// lib/retry.js — Retry Pattern logic

'use strict';

const RETRYABLE_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
]);

const RETRYABLE_KEYWORDS = [
  'network',
  'temporary',
  'timeout',
  'retry',
  'unreachable',
  'connection reset',
  'connection refused',
];

const MAX_BACKOFF_MS = 8000;
const BASE_BACKOFF_MS = 1000;

/**
 * Check if an error is retryable based on exit code and stderr.
 *
 * @param {string} exitCode - Process exit code or signal
 * @param {string} stderr - Standard error output
 * @returns {boolean} - true if retryable
 */
function isRetryable(exitCode, stderr) {
  const exit = (exitCode || '').toString();
  const err = (stderr || '').toLowerCase();

  // Check retryable exit codes/signals
  if (RETRYABLE_CODES.has(exit)) {
    return true;
  }

  // Check for retryable keywords in stderr
  for (const kw of RETRYABLE_KEYWORDS) {
    if (err.includes(kw)) {
      return true;
    }
  }

  return false;
}

/**
 * Extract backoff delay from stderr if specified by the tool.
 *
 * @param {string} stderr - Standard error output
 * @returns {number|null} - Delay in milliseconds or null
 */
function extractBackoffDelay(stderr) {
  if (!stderr) return null;

  // Match patterns like:
  // "Retrying in 5 seconds..."
  // "retry after 2s"
  // "wait 10s"
  const patterns = [
    /retry(?:ing)?\s+(?:after|in)\s+(\d+)\s*(?:s|sec|second|seconds)/i,
    /wait\s+(\d+)\s*(?:s|sec|second|seconds)/i,
    /back(?:ing)?\s+off\s+(\d+)\s*(?:s|sec|second|seconds)/i,
  ];

  for (const pat of patterns) {
    const match = stderr.match(pat);
    if (match) {
      const seconds = parseInt(match[1], 10);
      if (seconds > 0 && seconds < 3600) {
        return seconds * 1000;
      }
    }
  }

  return null;
}

/**
 * Calculate exponential backoff delay for a given attempt.
 *
 * @param {number} attempt - Attempt number (0-indexed)
 * @returns {number} - Delay in milliseconds
 */
function calculateBackoff(attempt) {
  const delay = BASE_BACKOFF_MS * Math.pow(2, attempt);
  return Math.min(delay, MAX_BACKOFF_MS);
}

/**
 * Determine if a retry should be allowed based on attempt count.
 *
 * @param {number} attempt - Current attempt number (0-indexed)
 * @param {number} maxRetries - Maximum allowed retries
 * @returns {boolean} - true if retry allowed
 */
function shouldRetry(attempt, maxRetries) {
  return attempt < maxRetries;
}

module.exports = {
  isRetryable,
  extractBackoffDelay,
  calculateBackoff,
  shouldRetry,
  RETRYABLE_CODES,
  RETRYABLE_KEYWORDS,
  MAX_BACKOFF_MS,
  BASE_BACKOFF_MS,
};
