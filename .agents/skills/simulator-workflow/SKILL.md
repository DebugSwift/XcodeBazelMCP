---
name: simulator-workflow
description: >-
  Build, run, and test iOS apps on simulators. Use when working on simulator
  build flows, app bundle discovery, simulator resolution, or boot/install/launch
  logic.
---

# Simulator Workflow

## Build + Run + Launch Chain

The `bazel_ios_build_and_run` tool chains these steps (each failure short-circuits):

1. **Build** — `bazel build <target>`
2. **Find app** — search `bazel-bin/` using target label's package path
3. **Resolve simulator** — priority: explicit UDID > name match > first booted > first available iPhone > first available device
4. **Boot** — lazy, only `simctl boot` if state != `Booted`
5. **Install** — `simctl install <udid> <app_path>`
6. **Read bundle ID** — `plutil -convert json -o -` on `Info.plist` (sync `execSync`)
7. **Launch** — `simctl launch <udid> <bundleId>`

## App Bundle Discovery

- After `bazel build`, search `bazel-bin/` using the target label's package path.
- Target `//:Foo` → `bazel-bin/Foo.app`, `//Apps/Bar:Bar` → `bazel-bin/Apps/Bar/Bar.app`.
- `rules_apple` places bundles inside `<target>_archive-root/Payload/` — `findAppBundle` searches recursively.

## Simulator Resolution

`resolveSimulator` returns `{ device: SimulatorDevice; warning?: string }`:
- `warning` is set when the resolved simulator is not the explicitly requested one (fallback).
- `resolveSimulatorFromArgs` in `helpers.ts` is the convenience wrapper — returns `{ sim, warning }`.
- `prependWarning(message, warning)` prepends the warning to tool output.

## Launch Environment Variables

Env vars are passed via `SIMCTL_CHILD_*` prefix convention — simctl forwards them to the launched process.

For **Cursor DEBUG MODE** (NDJSON hypothesis logs), use the `swift-agent-debug-log` skill and `bazel_ios_agent_debug_*` tools:

- `AGENT_DEBUG_LOG_PATH` / `AGENT_DEBUG_SESSION_ID` via `launchEnv` on `build_and_run` or `agent_debug_repro`
- Simulator fallback: `Documents/agent-debug.ndjson` + `bazel_ios_agent_debug_log_pull`
- Do not rely on the sim app writing directly to `.cursor/debug-*.log` on the host

## Platform CPU Flags

| Platform | Flag |
|----------|------|
| iOS simulator | `--ios_multi_cpus=sim_arm64` |
| iOS device | `--ios_multi_cpus=arm64` |
| macOS | (none — host arch) |
| tvOS | `--tvos_cpus=sim_arm64` |
| watchOS | `--watchos_cpus=arm64` |
| visionOS | `--visionos_cpus=sim_arm64` |

## Platform Discovery Queries

Uses `rules_apple` rule names: `ios_application`, `macos_application`, `tvos_application`, `watchos_application`, `visionos_application` (and `*_unit_test` variants).
