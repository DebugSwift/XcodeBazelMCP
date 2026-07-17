<div align="center">
  <img src="https://github.com/XcodeBazelMCP/XcodeBazelMCP/blob/HEAD/assets/LOGO.png?raw=true" alt="XcodeBazelMCP" width="200">

  <h1>XcodeBazelMCP</h1>

  <p>
    A Model Context Protocol (MCP) server and CLI for Bazel-based Apple platform development.
    Ships 125 tools across 21 workflow categories covering iOS, macOS, tvOS, watchOS,
    visionOS, and Swift Package Manager.
  </p>

[![CI](https://github.com/XcodeBazelMCP/XcodeBazelMCP/actions/workflows/ci.yml/badge.svg)](https://github.com/XcodeBazelMCP/XcodeBazelMCP/actions/workflows/ci.yml)
[![npm package](https://img.shields.io/npm/v/xcodebazelmcp)](https://www.npmjs.com/package/xcodebazelmcp)
[![License MIT](https://img.shields.io/npm/l/xcodebazelmcp)](https://github.com/XcodeBazelMCP/XcodeBazelMCP/blob/main/LICENSE)
[![node >=18.x](https://img.shields.io/node/v/xcodebazelmcp)](https://nodejs.org/)
[![Xcode 16](https://img.shields.io/badge/Xcode-16-blue)](https://developer.apple.com/xcode/)
[![platform macOS](https://img.shields.io/badge/platform-macOS-lightgrey)](https://github.com/XcodeBazelMCP/XcodeBazelMCP)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-green)](https://modelcontextprotocol.io)
[![codecov](https://codecov.io/gh/XcodeBazelMCP/XcodeBazelMCP/branch/main/graph/badge.svg)](https://codecov.io/gh/XcodeBazelMCP/XcodeBazelMCP)
[![Socket Badge](https://badge.socket.dev/npm/package/xcodebazelmcp/0.1.0)](https://badge.socket.dev/npm/package/xcodebazelmcp/0.1.0)
[![Ask DeepWiki](https://img.shields.io/badge/Ask-DeepWiki-blue?logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTEgMTVoLTJ2LTJoMnYyem0wLTRoLTJWN2gydjZ6IiBmaWxsPSJ3aGl0ZSIvPjwvc3ZnPg==)](https://deepwiki.com/XcodeBazelMCP/XcodeBazelMCP)

</div>

<br>

## What It Provides

- **Build & Run** — Build, install, launch, and stop iOS/macOS apps on simulators and physical devices.
- **Test & Coverage** — Run unit/UI/build tests with filtering, streaming output, and code coverage.
- **Simulator Management** — Boot, shutdown, erase, configure location/appearance/status bar.
- **Physical Device** — Full device lifecycle via `xcrun devicectl`: list, pair, install, launch, terminate, screenshot, log capture.
- **LLDB Debugging** — Attach to simulator or device processes, set breakpoints, inspect variables, step through code.
- **UI Automation** — Tap, swipe, type, drag, pinch, and inspect accessibility trees on simulators (via IDB or CGEvent fallback).
- **Multi-platform** — tvOS, watchOS, visionOS build/run/test/discover targets.
- **Swift Package Manager** — Build, test, run, clean, resolve, dump, and init Swift packages.
- **Project Discovery** — Query the Bazel build graph, discover targets, inspect dependencies.
- **Scaffolding** — Generate new Bazel projects from templates (ios_app, macos_app, etc.).
- **Session & Config** — Workspace management, build profiles, defaults, health checks.
- **Background Daemon** — Per-workspace daemon for stateful operations.
- **Self-update** — Check for and install updates.

## Requirements

- macOS with Xcode installed
- Node.js 18+
- Bazel or Bazelisk on `PATH`
- A Bazel workspace (set via `BAZEL_IOS_WORKSPACE`, config file, or `set_workspace` tool)

### Optional (for device screenshots & logs on iOS 17+)

- `pymobiledevice3` — `pip3 install pymobiledevice3`
- For screenshots: `sudo pymobiledevice3 remote tunneld` running in background
- For logs: pymobiledevice3 is tried first automatically, falls back to `idevicesyslog`

## Installation

### npm

```sh
npm install -g xcodebazelmcp
```

Then use the installed CLI:

```sh
xcodebazelmcp mcp
```

### Homebrew

```sh
brew install XcodeBazelMCP/tap/xcodebazelmcp
```

Then use the installed CLI:

```sh
xcodebazelmcp mcp
```

Or run directly via npx (no install needed):

```sh
npx -y xcodebazelmcp mcp
```

### Quick start (interactive)

```sh
npx -y xcodebazelmcp setup
```

### Install agent skills (Cursor / Codex)

```sh
npx -y xcodebazelmcp init
```

## MCP Configuration

```json
{
  "mcpServers": {
    "XcodeBazelMCP": {
      "command": "npx",
      "args": ["-y", "xcodebazelmcp", "mcp"],
      "env": {
        "BAZEL_IOS_WORKSPACE": "/path/to/your/ios-workspace"
      }
    }
  }
}
```

If you installed the CLI globally with npm or Homebrew:

```json
{
  "mcpServers": {
    "XcodeBazelMCP": {
      "command": "xcodebazelmcp",
      "args": ["mcp"],
      "env": {
        "BAZEL_IOS_WORKSPACE": "/path/to/your/ios-workspace"
      }
    }
  }
}
```

Or with workspace flag:

```sh
npx -y xcodebazelmcp mcp --workspace /path/to/your/ios-workspace
```

### From source

```sh
git clone https://github.com/XcodeBazelMCP/XcodeBazelMCP.git
cd XcodeBazelMCP
npm install
npm run build
```

## Working with Workspaces

XcodeBazelMCP needs to know which Bazel workspace to operate on. There are several ways to set it, in order of precedence:

1. **MCP tool at runtime** — `bazel_ios_set_workspace` (sets the workspace for later tool calls)
2. **CLI flag** — `xcodebazelmcp mcp --workspace /path/to/workspace`
3. **Environment variable** — `BAZEL_IOS_WORKSPACE=/path/to/workspace`
4. **Config file** — `.xcodebazelmcp/config.yaml` in the workspace root (supports profiles)
5. **Fallback** — `process.cwd()`

For multi-workspace setups, use **profiles** in `config.yaml`:

```yaml
profiles:
  app:
    defaultTarget: '//app:app'
    defaultPlatform: simulator
    defaultBuildMode: debug
  mac:
    defaultTarget: '//mac:mac'
    defaultPlatform: macos
```

Then switch at runtime: `xcodebazelmcp set-defaults --profile app`

## Environment Variables

| Variable                       | Purpose                                                                 |
| ------------------------------ | ----------------------------------------------------------------------- |
| `BAZEL_IOS_WORKSPACE`          | Bazel workspace root (highest-precedence workspace source).             |
| `BAZEL_PATH` / `MCP_BAZEL_PATH`| Path to the Bazel/Bazelisk binary (defaults to `bazel` on `PATH`).      |
| `BAZEL_IOS_STARTUP_ARGS`       | Bazel startup args prepended to every invocation (quote-aware).         |
| `BAZEL_IOS_MCP_MAX_OUTPUT`     | Max captured command output in characters (default 200000).             |
| `BAZEL_IOS_SIMULATOR_CPU`      | Override the iOS simulator CPU (`sim_arm64` / `x86_64`; default: host).  |
| `BAZEL_IOS_DISCOVER_SCOPE`     | Default `discover` query scope for non-monorepo workspaces (e.g. `//...`). |
| `BAZEL_IOS_COMMAND_LOG`        | Path to the persistent NDJSON command log.                              |
| `BAZEL_IOS_COMMAND_LOG_MAX_BYTES` | Rotate the command log past this size (default 5 MiB).               |
| `BAZEL_IOS_COMMAND_LOG_DISABLE`| Set to `1` to disable command logging.                                  |
| `IDB_PATH`                     | Path to the `idb` binary for UI automation (else discovered on `PATH`). |
| `BITRISE_BUILD_CACHE_AUTH_TOKEN` | Optional. Enables `--config=bitrise` / `--config=remote_linux` (Bitrise RBE). When unset, XcodeBazelMCP strips those configs and runs locally instead of failing auth. |

### Bitrise RBE (optional)

DoorDash's `ios` repo defines `--config=bitrise` and `--config=remote_linux` for Bitrise remote execution. Those configs require `BITRISE_BUILD_CACHE_AUTH_TOKEN`.

**You do not need the token for local simulator builds/tests.** If an agent (or `extraArgs`) passes `--config=bitrise` without the token, XcodeBazelMCP automatically drops the Bitrise config flags and runs locally. Set the token only when you intentionally want RBE offload.


```sh
# Health check
xcodebazelmcp doctor

# Discover & query
xcodebazelmcp discover --scope //Apps/... --kind apps
xcodebazelmcp query 'deps(//app:app)'

# Build & run (simulator)
xcodebazelmcp build //app:app --debug --simulator
xcodebazelmcp run //app:app --simulator-name "iPhone 16 Pro"

# Build & run (device)
xcodebazelmcp device-run //app:app --device-name "iPhone"
xcodebazelmcp device-screenshot output.png --device-name "iPhone"
xcodebazelmcp device-log-start --device-name "iPhone"

# Test
xcodebazelmcp test //tests:UnitTests --filter "SomeTest/testCase" --stream

# macOS
xcodebazelmcp macos-build //mac:mac --debug
xcodebazelmcp macos-run //mac:mac

# Swift Package Manager
xcodebazelmcp spm-build --path ./MyPackage
xcodebazelmcp spm-test --filter "MyTests/testExample"

# Scaffold
xcodebazelmcp new ios_app MyNewApp --bundle-id com.example.MyNewApp

# Config
xcodebazelmcp defaults
xcodebazelmcp set-defaults --target //app:app --simulator-name "iPhone 16 Pro"
xcodebazelmcp workflows
```

## Workflow Categories (125 tools)

Workflows control which tools are advertised to MCP clients. Smart defaults enable the most common workflows; use `toggle-workflow` to customize.

| Category          | Tools | Description                                                                            |
| ----------------- | ----- | -------------------------------------------------------------------------------------- |
| **build**         | 2     | Build iOS targets for simulator or device                                              |
| **test**          | 2     | Run iOS tests with optional coverage                                                   |
| **simulator**     | 12    | Manage simulator lifecycle, settings, media, and containers                            |
| **app_lifecycle** | 6     | Install, launch, stop, uninstall apps on simulator                                     |
| **capture**       | 5     | Screenshot, video recording, log capture (simulator)                                   |
| **agent_debug**   | 4     | NDJSON agent debug logs (Cursor DEBUG MODE)                                            |
| **ui_automation** | 9     | Tap, swipe, type, drag, accessibility snapshot                                         |
| **deep_links**    | 2     | Open URLs and send push notifications                                                  |
| **device**        | 16    | Physical device build, deploy, test, screenshot, logs, uninstall, list apps            |
| **lldb**          | 10    | LLDB debugger: breakpoints, variables, stepping                                        |
| **macos**         | 13    | macOS build, run, test, discover                                                       |
| **tvos**          | 4     | tvOS build, run, test, discover                                                        |
| **watchos**       | 4     | watchOS build, run, test, discover                                                     |
| **visionos**      | 4     | visionOS build, run, test, discover                                                    |
| **spm**           | 7     | Swift Package Manager operations                                                       |
| **project**       | 6     | Target discovery, query, deps, rdeps                                                   |
| **scaffold**      | 2     | Generate new Bazel projects                                                            |
| **session**       | 7     | Workspace, defaults, profiles, health                                                  |
| **daemon**        | 3     | Background daemon management                                                           |
| **update**        | 2     | Self-update and version check                                                          |
| **xcode**         | 3     | Apple-native Xcode MCP detection, DeviceHub, skills ([docs](docs/xcode-native-mcp.md)) |

## iOS 17+ Device Notes

Apple replaced `lockdownd`/`usbmuxd` with CoreDevice (`remoted`) starting in iOS 17 / macOS 15. This means:

- **`xcrun devicectl`** is the only reliable CLI for device operations (list, install, launch, terminate).
- **Screenshots** require `pymobiledevice3` with `tunneld` running — no `devicectl` screenshot subcommand exists.
- **Logs** use `pymobiledevice3 syslog live` (automatic fallback to `idevicesyslog` for older devices).
- **Process termination** uses a two-step PID lookup since `devicectl` doesn't expose `bundleIdentifier` in process listings.

See [docs/device-support.md](docs/device-support.md) for full details.

## Development

```sh
git clone https://github.com/XcodeBazelMCP/XcodeBazelMCP.git
cd XcodeBazelMCP
npm install
npm run build     # Build dist/
npm test          # Run tests (vitest)
npm run lint      # ESLint
```

## Notes

The server launches Bazel with `spawn`, not a shell. Extra flags are passed as argv entries so commands are reproducible and avoid shell interpolation.
