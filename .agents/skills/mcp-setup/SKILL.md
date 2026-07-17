---
name: mcp-setup
description: >-
  Configure MCP server, daemon, scaffolding, or doctor. Use when setting up
  XcodeBazelMCP for other projects, configuring the daemon, running doctor, or
  working on project scaffolding templates.
---

# MCP Setup & Configuration

## Using in Other Projects

The package is **not published to npm** (`private: true`). Use the local `dist/cli.js` path in `.cursor/mcp.json`:

```json
{
  "XcodeBazelMCP": {
    "command": "node",
    "args": ["/Users/matheus.gois/Projects/XcodeBazelMCP/dist/cli.js", "mcp"],
    "env": { "BAZEL_IOS_WORKSPACE": "/path/to/your/workspace" }
  }
}
```

- After source changes, run `npm run build` to update `dist/`.
- Prefer absolute paths — `~` may not expand in all MCP clients.
- **Local Bazel execution is the default.** `BITRISE_BUILD_CACHE_AUTH_TOKEN` is not required. Bitrise RBE configs (`bitrise`, `remote_linux`) are stripped automatically unless the token is set.

## Config File

`.xcodebazelmcp/config.yaml` (in workspace root or `~/.xcodebazelmcp/`):

- `enabledWorkflows` — comma-separated workflow IDs (e.g. `build, test, simulator`)
- `profiles:` — nested blocks for per-project defaults
- `activateProfile` merges profile defaults into session defaults

## Per-Workspace Daemon

- Unix socket: `/tmp/xbmcp-daemon-<sha256(wsPath)[0:12]>.sock`
- PID file: `~/.xcodebazelmcp/daemons/<hash>.json`
- JSON protocol: `ping`, `status`, `list_ops`, `register_op`, `unregister_op`, `shutdown`
- Client spawns detached child via `child.unref()` with `XBMCP_DAEMON=1` env, polls up to 5s for socket.
- Auto-cleanup on `SIGTERM`/`SIGINT`: removes socket and PID file.

## Project Scaffolding

6 templates: `ios_app`, `ios_test`, `ios_app_with_tests`, `macos_app`, `macos_test`, `macos_app_with_tests`.

- Guards against overwriting — fails if `MODULE.bazel` or `WORKSPACE` already exists.
- Test-only templates generate BUILD.bazel under `${name}Tests/` subdirectory.
- Scaffold `name` validated with `^[A-Za-z][A-Za-z0-9_-]*$` to prevent path traversal.

## Doctor

Reports: system info (platform, arch, CPUs, memory, Node), workspace details (path, config, MODULE.bazel/WORKSPACE/.bazelrc), dependency versions (bazel, xcode, simctl), full tool inventory by workflow with enabled/disabled status.

Dependency checks run in parallel via `Promise.all`.

## Smoke Testing

`scripts/smoke.mjs` reads tool names from individual handler files under `src/tools/handlers/` (not `bazel-tools.ts` which only aggregates).
