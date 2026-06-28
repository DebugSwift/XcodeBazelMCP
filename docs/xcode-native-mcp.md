# Xcode Native MCP Integration (Xcode 26.3+)

Apple ships a native Model Context Protocol (MCP) integration inside Xcode and
LLDB. XcodeBazelMCP **detects and bridges** this tooling so an agent can use
Xcode's own tools alongside the Bazel/simctl/devicectl flows — without replacing
anything. Everything here is additive and degrades gracefully on older Xcode.

> Status: `mcpbridge` ships in **Xcode 26.3 (stable)**. `lldb-mcp` and
> `DeviceHub.app` currently ship only in **Xcode-beta / Xcode 27**. The
> integration is treated as **beta**: detection is always safe, and the existing
> XcodeBazelMCP tools remain the supported path.

## What Apple provides

| Tool | Where | What it does |
|------|-------|--------------|
| `xcrun mcpbridge` | Xcode 26.3+ (`<dev>/usr/bin/mcpbridge`) | STDIO MCP bridge between an MCP client and a **running Xcode**'s tool service. Auto-selects the Xcode via `MCP_XCODE_PID` or `xcode-select`. |
| `xcrun mcpbridge run-agent <agent>` | Xcode 26.3+ | Launch a coding agent (e.g. `claude`) pre-wired with Xcode's MCP tools, auth, and env. `--dry-run` prints the resolved command; `--no-xcode-tools` excludes them. |
| `xcrun mcpbridge run-agent skills export` | Xcode 26.3+ | Export Xcode's globally available `SKILL.md` bundles (e.g. `device-interaction`, `swiftui-whats-new-27`). |
| `lldb-mcp` | Xcode-beta / 27 (`<dev>/usr/bin/lldb-mcp`) | LLDB MCP server for debugging. |
| `DeviceHub.app` | Xcode-beta / 27 (`<app>/Contents/Applications/DeviceHub.app`, bundle `com.apple.dt.Devices`) | GUI device manager — the successor to Xcode's Devices window. |

### Xcode's native device-interaction MCP tools

When connected through `mcpbridge` to a running Xcode 27, the agent gains
Xcode's own device tools (surfaced by the `device-interaction` skill):

```
DeviceInteractionStartSession      → start a background device/sim session
  DeviceInteractionInstallAndRun   → build + install + launch (commandLineArguments, environmentVariables)
    DeviceEventSynthesize          → perform a touch/UI interaction and observe state (repeatable)
  DeviceInteractionEndSession      → tear down (sessions are resource-heavy)
```

These complement XcodeBazelMCP's `bazel_ios_*` UI-automation/device tools, which
remain available for Bazel-built apps and pre-27 Xcode.

## What XcodeBazelMCP adds

Three opt-in tools (workflow `xcode`) and matching CLI commands:

| MCP tool | CLI | Purpose |
|----------|-----|---------|
| `bazel_xcode_native_mcp_status` | `xcodebazelmcp xcode-mcp-status` | Detect installs, `mcpbridge`/`lldb-mcp`/DeviceHub availability, running Xcode PIDs, and emit a ready-to-paste MCP client config. |
| `bazel_xcode_open_device_hub` | `xcodebazelmcp devicehub` | Open DeviceHub.app for device interaction (clear guidance when not installed). |
| `bazel_xcode_export_skills` | `xcodebazelmcp xcode-export-skills [--output-dir <dir>] [--replace-existing]` | Export Xcode's agent skill bundles (needs a running Xcode). |

Enable the workflow for MCP clients (it is **off by default**, like other
optional categories):

```sh
xcodebazelmcp toggle-workflow xcode on
```

The CLI commands work regardless of workflow filtering.

## Wiring Xcode's native tools into your MCP client

`xcode-mcp-status` prints a drop-in snippet. Add it next to XcodeBazelMCP so the
agent sees both tool sets (Bazel tools from XcodeBazelMCP, Xcode IDE/device tools
from `mcpbridge`):

```json
{
  "mcpServers": {
    "xcodebazelmcp": { "command": "npx", "args": ["xcodebazelmcp", "mcp"] },
    "xcode-native": { "command": "xcrun", "args": ["mcpbridge"] }
  }
}
```

- `mcpbridge` requires a **running Xcode**. With multiple Xcodes installed it
  uses `xcode-select`; pin one with `MCP_XCODE_PID=<pid>` or
  `env: { "DEVELOPER_DIR": "/Applications/Xcode-beta.app/Contents/Developer" }`.
- To target the beta toolchain for `lldb-mcp`/DeviceHub, set `DEVELOPER_DIR`
  before invoking, or select Xcode-beta via `xcode-select`.

## Backwards compatibility

- Detection never throws and never shells out destructively.
- On Xcode < 26.3 (no `mcpbridge`), `xcode-mcp-status` reports it's unavailable
  and the Bazel/simctl/devicectl tools continue to be the supported path.
- `bazel_xcode_open_device_hub` returns actionable guidance (use
  `bazel_ios_list_devices` / `bazel_ios_device_info`) when DeviceHub is absent.

## Quick check

```sh
xcodebazelmcp xcode-mcp-status
# → lists Xcode.app / Xcode-beta.app with mcpbridge/lldb-mcp/DeviceHub flags,
#   running Xcode PIDs, and the client-config snippet.
```
