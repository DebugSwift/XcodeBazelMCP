# Streaming Build Output

Status: **Implemented**

## Overview

Long-running Bazel commands (build, test, query, clean) can stream stdout/stderr incrementally instead of buffering the entire output until completion. **Streaming is off by default** (`streaming: false`) to keep MCP tool responses compact. Opt in with `streaming: true` when you want live progress notifications.

## Supported Tools

| Tool | CLI flag |
|---|---|
| `bazel_ios_build` | `--stream` |
| `bazel_ios_build_and_run` | `--stream` |
| `bazel_ios_test` | `--stream` |
| `bazel_ios_query` | `--stream` |
| `bazel_ios_clean` | `--stream` |

## MCP Protocol

Set `streaming: true` in the tool arguments (or via `bazel_ios_set_defaults`) and include a `_meta.progressToken` in the request:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "bazel_ios_build",
    "_meta": { "progressToken": "build-1" },
    "arguments": {
      "target": "//app:app",
      "streaming": true
    }
  }
}
```

The server sends `notifications/progress` messages as output arrives:

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/progress",
  "params": {
    "progressToken": "build-1",
    "data": "[42 / 96] Compiling Swift module //app:app.library\n"
  }
}
```

After the command completes, the normal `tools/call` result is returned with the full summary.

## CLI

```sh
xcodebazelmcp build //app:app --stream
xcodebazelmcp run //app:app --stream
xcodebazelmcp test //tests:tests --stream
xcodebazelmcp clean --stream
```

Output is piped to stdout in real-time as it arrives, followed by the final status summary.

## Implementation

- `runCommandStreaming` (async generator) in `src/utils/process.ts` — spawns the child process and yields `StreamChunk` objects (`{ stream, data }`) as data arrives, then yields the final `CommandResult`.
- `runBazelStreaming` in `src/core/bazel.ts` — wraps `runCommandStreaming` with workspace validation and config.
- `callBazelToolStreaming` in `src/tools/bazel-tools.ts` — dispatches to `runBazelStreaming` for supported tools, calls the `onProgress` callback for each chunk, then returns the final result. For `build_and_run`, the post-build steps (install + launch) run after streaming completes.
- MCP server sends `notifications/progress` JSON-RPC notifications for each chunk when `_meta.progressToken` is provided and `streaming: true`.
- Non-streaming callers are unaffected — `callBazelTool` still works identically.
