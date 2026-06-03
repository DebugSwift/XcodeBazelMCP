---
name: swift-agent-debug-log
description: >-
  Instrument Swift/iOS apps for Cursor DEBUG MODE: NDJSON hypothesis logs on the
  host or simulator Documents. Use with XcodeBazelMCP agent_debug tools (clear,
  read, pull, repro) instead of Read/delete_file on host paths from sim code.
---

# Swift Agent Debug Log (Cursor DEBUG MODE)

XcodeBazelMCP owns **runtime** (build, launch, read logs). This skill is the **protocol** (NDJSON schema, `hypothesisId`, session cleanup).

## Log path strategy

| Runtime | Where Swift writes | How the agent reads |
|---------|-------------------|---------------------|
| macOS / unit tests | Host path from env | `bazel_ios_agent_debug_log_read` |
| iOS Simulator | `Documents/agent-debug.ndjson` (sandbox-safe) | `bazel_ios_agent_debug_log_pull` or env if using host mount |

**Never** hardcode repo paths like `Apps/Consumer/.cursor/debug-*.log` in app code — the sim sandbox cannot write there.

### Environment (preferred for host / tests)

`bazel_ios_build_and_run` / `bazel_ios_agent_debug_repro` pass via `launchEnv` → `SIMCTL_CHILD_*`:

- `AGENT_DEBUG_LOG_PATH` — absolute host path (e.g. `<workspace>/.cursor/debug-{session}.log`)
- `AGENT_DEBUG_SESSION_ID` — Cursor debug session id

Swift reads `ProcessInfo.processInfo.environment` and appends one NDJSON object per line.

### Simulator fallback

If no host path is writable, append NDJSON to:

`FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]/agent-debug.ndjson`

Then pull with `bazel_ios_agent_debug_log_pull` (`destPath` optional copy to `.cursor/debug-*.log`).

## Swift instrumentation (minimal)

```swift
func agentDebugLog(
  location: String,
  message: String,
  data: [String: Any] = [:],
  hypothesisId: String,
  runId: String = "pre-fix"
) {
  let env = ProcessInfo.processInfo.environment
  let sessionId = env["AGENT_DEBUG_SESSION_ID"] ?? ""
  let payload: [String: Any] = [
    "sessionId": sessionId,
    "location": location,
    "message": message,
    "data": data,
    "hypothesisId": hypothesisId,
    "runId": runId,
    "timestamp": Int(Date().timeIntervalSince1970 * 1000),
  ]
  guard let line = try? JSONSerialization.data(withJSONObject: payload),
        let str = String(data: line, encoding: .utf8) else { return }
  let row = str + "\n"
  if let path = env["AGENT_DEBUG_LOG_PATH"], !path.isEmpty {
    if let handle = FileHandle(forWritingAtPath: path) {
      handle.seekToEndOfFile(); handle.write(Data(row.utf8)); try? handle.close()
    } else {
      FileManager.default.createFile(atPath: path, contents: Data(row.utf8))
    }
    return
  }
  let doc = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
  let url = doc.appendingPathComponent("agent-debug.ndjson")
  if let handle = try? FileHandle(forWritingTo: url) {
    handle.seekToEndOfFile(); handle.write(Data(row.utf8)); try? handle.close()
  } else {
    try? row.write(to: url, atomically: true, encoding: .utf8)
  }
}
```

Wrap calls in `// #region agent log` … `// #endregion` so Xcode folds them.

## Agent workflow (use MCP tools, not raw file tools)

1. `bazel_ios_agent_debug_log_clear` — `{ "logPath": "<abs>/.cursor/debug-{session}.log" }`
2. `bazel_ios_agent_debug_repro` or `bazel_ios_build_and_run` with `launchEnv` / repro sets `AGENT_DEBUG_*`
3. User reproduces the bug
4. `bazel_ios_agent_debug_log_read` — filter `hypothesisId`, `runId`; use `hypothesisStatusHints` for CONFIRMED/REJECTED hints
5. If empty on host → `bazel_ios_agent_debug_log_pull` with `bundleId` + optional `destPath`

MCP resource: `xcodebazel://agent-debug-log?path=<url-encoded-abs-path>`

## NDJSON line schema

```json
{
  "sessionId": "522bed",
  "location": "MyType.swift:42",
  "message": "branch taken",
  "data": { "count": 3 },
  "hypothesisId": "A",
  "runId": "pre-fix",
  "timestamp": 1733456789000
}
```

## Optional: os_log transport

`bazel_ios_log_capture_start` with `jsonLinesOnly: true` or `messageContains: "agentDebugLog"` — noisier than file pull; use when you cannot add file IO.
