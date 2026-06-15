---
name: retry-pattern
description: PostToolUse hook that detects retryable Bash errors (ETIMEDOUT, ECONNRESET, 5xx, MCP timeouts) and signals the agent to retry with exponential backoff, capped by max-attempts. Use when transient network errors cause the agent to give up unnecessarily.
---

# Retry Pattern

PostToolUse hook analyzes Bash results, matches against retryable error
patterns, tracks per-command attempt counts, and outputs a retry
recommendation with backoff delay when warranted.

## When to use

- `npm install` hits ETIMEDOUT — retry, don't abandon
- `git push` gets ECONNRESET — retry with backoff
- MCP call times out — retry up to N times

## Installation

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/skills/retry-pattern/hooks/retry-hook.js"
          }
        ]
      }
    ]
  }
}
```

Required files at install location:

```
~/.claude/skills/retry-pattern/SKILL.md
~/.claude/skills/retry-pattern/hooks/retry-hook.js
~/.claude/skills/retry-pattern/lib/retry.js
```

See `README.md` for retryable error patterns, backoff schedule, and attempt cap.
