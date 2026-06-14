# Retry Pattern for Claude Code

> PostToolUse hook that detects retryable errors and signals retry with exponential backoff.

By Vassa

## The Problem

Temporary network errors and timeouts cause agents to give up unnecessarily:

```
npm install → ETIMEDOUT → agent stops
git push → ECONNRESET → agent stops
MCP call → timeout → agent stops
```

A human would retry after a short pause. The agent should too.

## Solution

PostToolUse hook analyzes Bash tool results:

1. **Detects retryable errors** — exit codes and stderr patterns
2. **Tracks retry attempts** — per-command fingerprint state
3. **Signals retry** — outputs recommendation with backoff delay
4. **Exponential backoff** — 1s → 2s → 4s → 8s (max)
5. **Max retries** — configurable (default: 3)

### Retryable Signals

**Exit codes/signals:**
- `ETIMEDOUT`, `ECONNRESET`, `ECONNREFUSED`
- `EHOSTUNREACH`, `ENOTFOUND`, `EAI_AGAIN`
- `EPIPE`

**Stderr patterns:**
- "network", "temporary", "timeout"
- "retry", "unreachable"
- "connection reset", "connection refused"

### Non-retryable (give up immediately)

- Permission errors
- Syntax errors
- File not found
- "permission denied", "SyntaxError", "ENOENT"

## Architecture

```
┌──────────────────────┐
│   Claude Code         │
│   Bash tool executes │
└──────────┬───────────┘
           │
    ┌──────▼──────────────┐
    │  PostToolUse         │
    │  retry-hook.js       │
    └──────┬──────────────┘
           │
    ┌──────▼──────────────┐
    │  Is error retryable?│
    │  - Exit code check  │
    │  - Stderr patterns  │
    └──────┬──────────────┘
           │
      YES├─┴──┐NO
          │   │
          │   ▼
          │  Clear state
          │
    ┌─────▼─────────────┐
    │  Check retry count │
    │  vs MAX_RETRIES     │
    └─────┬─────────────┘
          │
    ┌─────▼─────────────┐
    │  Within limit?     │
    └─────┬─────────────┘
          │
      YES├─┴──┐NO
          │   │
          ▼   ▼
    ┌────────┴─────────┐
    │ Output retry     │
    │ recommendation  │
    │ Update state     │
    │ Delete state     │
    └──────────────────┘
```

## Installation

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node <path-to>/retry-pattern/hooks/retry-hook.js"
          }
        ]
      }
    ]
  }
}
```

Use absolute paths. Example: `node /home/user/retry-pattern/hooks/retry-hook.js`

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `RETRY_MAX_RETRIES` | 3 | Maximum retry attempts |
| `RETRY_STATE_DIR` | `~/.claude` | Directory for state file |

## State File

`~/.claude/retry-state.json`:

```json
{
  "Bash:npm install": {
    "count": 2,
    "lastAttempt": 1748901234567,
    "backoff": 4000,
    "command": "npm install",
    "exitCode": "ETIMEDOUT"
  }
}
```

## Tests

```bash
node tests/retry.test.js
```

15 tests covering:
- Retryable detection (exit codes, stderr patterns)
- Non-retryable rejection
- Backoff extraction from stderr
- Exponential backoff calculation
- Retry limit enforcement

## Limitations

1. **Bash tool only** — monitors only Bash commands
2. **Heuristic detection** — may miss some retryable errors
3. **Manual retry** — agent must decide to follow recommendation
4. **Persistent state** — survives sessions, use manual reset if needed

## Roadmap

- [ ] Automatic retry (hook re-issues command after backoff)
- [ ] Per-command retry limits
- [ ] Configurable retryable patterns
- [ ] Integration with circuit-breaker

## License

MIT
