# Clawdbot Ralph

A Clawdbot plugin that applies the Ralph pattern for agentic coding: structured prompts, explicit exit signals, and tight loop control. Designed to work with Claude Code or Codex CLIs by configuring the runner command.

## Features

- Ralph project scaffolding (`PROMPT.md`, `@fix_plan.md`, `@AGENT.md`, `specs/`, `logs/`)
- Prompt assembly that enforces an explicit `RALPH_STATUS` block
- Response analysis with exit-signal gating (completion indicators + `EXIT_SIGNAL: true`)
- CLI commands + tools for automation

## Installation

```bash
clawdbot plugins install clawd-plugin-ralph
```

Or from GitHub:

```bash
clawdbot plugins install github:pepicrft/clawd-plugin-ralph
```

## Configuration

```json5
{
  plugins: {
    entries: {
      "clawd-plugin-ralph": {
        enabled: true,
        config: {
          projectRoot: "/Users/you/ralph-project",
          agent: "claude",
          provider: "claude",
          exitIndicatorThreshold: 2,
          maxLoops: 20,
          runForever: false,
          sessionTimeoutHours: 24,
          heartbeatFile: ".ralph_heartbeat.json",
          heartbeatIntervalMs: 30000,
          git: {
            enabled: true,
            onExit: true,
            push: true,
            commitPrefix: "[ralph]",
            remote: "origin"
          },
          runner: {
            command: "claude",
            args: ["-p", "{prompt}"],
            continueOnError: false,
            retryLimit: 0,
            retryDelayMs: 5000
          }
        }
      }
    }
  }
}
```

### Multiple projects

Configure multiple Ralph targets under a single Gateway by defining `projects`:

```json5
{
  plugins: {
    entries: {
      "clawd-plugin-ralph": {
        enabled: true,
        config: {
          defaultProject: "micelio",
          projects: {
            micelio: { projectRoot: "/Users/you/src/micelio" },
            plasma: { projectRoot: "/Users/you/src/Plasma" }
          }
        }
      }
    }
  }
}
```

Then use `--project` on CLI commands (for example: `clawdbot ralph status --project plasma`).

### Codex runner example

CLI flags differ across Codex variants; customize as needed:

```json5
{
  runner: {
    command: "codex",
    args: ["--prompt", "{prompt}"]
  }
}
```

### Runner placeholders

You can reference these tokens in `runner.args`:

- `{prompt}`: The compiled prompt text.
- `{outputFormat}`: The output format (`json` or `text`).
- `{allowedTools}`: The allowed tools string (if set).
- `{sessionId}`: The current Ralph session id.

## CLI Usage

```bash
# Initialize a Ralph project in the current directory
clawdbot ralph init

# Or create a new directory
clawdbot ralph init my-project

# Print the compiled prompt
clawdbot ralph prompt

# Override agent label
clawdbot ralph prompt --agent codex

# Run one or more Ralph loops
clawdbot ralph run --loops 3

# Run with a specific agent label
clawdbot ralph run --agent codex --loops 2

# Run continuously and keep looping on runner errors
clawdbot ralph run --forever --continue-on-error

# Check heartbeat status
clawdbot ralph status

# Target a specific project
clawdbot ralph status --project micelio

# Analyze a response file
clawdbot ralph analyze --file response.txt
```

## Tools

- `ralph_init_project`
- `ralph_next_prompt`
- `ralph_analyze_response`
- `ralph_status`

## How It Works

1. Builds a unified prompt from `PROMPT.md`, `@fix_plan.md`, and `@AGENT.md`.
2. Runs the configured CLI with a requirement to emit `RALPH_STATUS` including `EXIT_SIGNAL: true|false`.
3. Parses the response and exits only when both completion indicators and the explicit exit signal are present.
4. Optionally commits and pushes changes on completion (configurable via `git`).

## Requirements

- Node 20+
- Claude Code CLI or Codex CLI (configured via `runner`)

## Tests

```bash
npm test
npm run build
```

## License

MIT
