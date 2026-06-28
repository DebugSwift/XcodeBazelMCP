export function printHelp(): void {
  console.log(`XcodeBazelMCP

Usage:
  xcodebazelmcp mcp                Start MCP JSON-RPC server on stdin/stdout
  xcodebazelmcp setup              Interactive config wizard
  xcodebazelmcp init               Install agent skills (Cursor/Codex)
  xcodebazelmcp upgrade            Upgrade to latest version (auto-detects npm/Homebrew/source)
  xcodebazelmcp check-update       Check if a newer version is available
  xcodebazelmcp workflows          List all workflow categories and their tools
  xcodebazelmcp toggle-workflow <id> [on|off]  Enable/disable a workflow category
  xcodebazelmcp tools              List all available MCP tools
  xcodebazelmcp doctor             Check Bazel, Xcode, simulator readiness

Build & Run:
  xcodebazelmcp build <target> [--debug|--release] [--simulator|--device] [--stream]
  xcodebazelmcp run <target> [--debug] [--simulator-name "iPhone 16 Pro"] [--stream]
  xcodebazelmcp install <path/to/App.app> [--simulator-id <UDID>]
  xcodebazelmcp launch <bundleId> [--simulator-id <UDID>] [--simulator-name "..."] [--launch-arg ...] [--launch-env KEY=VAL]
  xcodebazelmcp stop <bundleId> [--simulator-name "..."]
  xcodebazelmcp uninstall <bundleId> [--simulator-name "..."]
  xcodebazelmcp test <target> [--filter XCTestFilter] [--minimize-simulator] [--shutdown-simulator] [--stream]
  xcodebazelmcp coverage <target> [--filter XCTestFilter] [--minimize-simulator] [--shutdown-simulator]
  xcodebazelmcp clean [--expunge] [--stream]
  xcodebazelmcp app-path <target>
  xcodebazelmcp bundle-id <path/to/App.app | //target>

Query & Inspect:
  xcodebazelmcp discover [--scope //Apps/...] [--kind apps|tests|all]
  xcodebazelmcp query <bazel query expression>
  xcodebazelmcp target-info <target>
  xcodebazelmcp deps <target> [--depth 2]
  xcodebazelmcp rdeps <target> [--scope //Apps/...]
  xcodebazelmcp bsp-status [--query-targets]
  xcodebazelmcp last-command
  xcodebazelmcp command-log [--limit N]   Tail the persistent NDJSON command log (postmortems)

Config & Defaults:
  xcodebazelmcp defaults
  xcodebazelmcp set-defaults [--target //app:app] [--simulator-name "..."] [--simulator-id <UDID>]
                             [--build-mode debug] [--platform simulator|device|none] [--profile name] [--clear]
  xcodebazelmcp profiles

Simulator:
  xcodebazelmcp simulators [--booted]
  xcodebazelmcp sim-boot [--simulator-name "iPhone 17 Pro"]
  xcodebazelmcp sim-shutdown [--simulator-id <UDID>] [--all]
  xcodebazelmcp sim-erase --simulator-id <UDID>
  xcodebazelmcp sim-location --latitude 37.7749 --longitude -122.4194
  xcodebazelmcp sim-appearance --appearance dark
  xcodebazelmcp sim-open [--simulator-id <UDID>] [--simulator-name "..."]
  xcodebazelmcp screenshot <output.png> [--simulator-name "..."] [--mask alpha|black|ignored]
  xcodebazelmcp video-record <output.mp4> [--simulator-name "..."]
                              Records until Ctrl+C.
  xcodebazelmcp status-bar [--time "9:41"] [--battery-level 100] [--network wifi] [--clear]
  xcodebazelmcp ui-dump [--simulator-name "..."]
  xcodebazelmcp add-media <path...> [--simulator-name "..."]       Add photos/videos to the photo library
  xcodebazelmcp app-container <bundleId> [--kind app|data|groups] [--simulator-name "..."]

Device:
  xcodebazelmcp devices [--all]
  xcodebazelmcp device-run <target> [--debug|--release] [--device-id <UDID>] [--device-name "..."] [--stream]
  xcodebazelmcp device-install <path/to/App.app> [--device-id <UDID>]
  xcodebazelmcp device-launch <bundleId> [--device-id <UDID>] [--launch-arg ...] [--launch-env KEY=VAL]
  xcodebazelmcp device-stop <bundleId> [--device-id <UDID>]
  xcodebazelmcp device-uninstall <bundleId> [--device-id <UDID>]
  xcodebazelmcp device-list-apps [--device-id <UDID>]
  xcodebazelmcp device-test <target> [--filter ...] [--device-id <UDID>] [--timeout <seconds>] [--stream]
  xcodebazelmcp device-screenshot <output.png> [--device-id <UDID>]
  xcodebazelmcp device-app-path <target>                  Locate the built .app for a device target
  xcodebazelmcp device-log-start [--device-id <UDID>] [--process <name>]
  xcodebazelmcp device-log-stop <captureId>
  xcodebazelmcp device-info [--device-id <UDID>]
  xcodebazelmcp device-pair [--device-id <UDID>]
  xcodebazelmcp device-unpair [--device-id <UDID>]
  xcodebazelmcp device-list-pairs

macOS:
  xcodebazelmcp macos-build <target> [--debug|--release] [--stream]
  xcodebazelmcp macos-run <target> [--debug|--release] [--run-arg ...] [--stream]
  xcodebazelmcp macos-test <target> [--filter XCTestFilter] [--stream]
  xcodebazelmcp macos-discover [--scope //mac/...] [--kind macos_apps|macos_tests|macos_all]
  xcodebazelmcp macos-coverage <target> [--filter ...]
  xcodebazelmcp macos-clean [--expunge]
  xcodebazelmcp macos-launch <target-or-app-path> [--launch-arg ...]
  xcodebazelmcp macos-stop <bundleId> [--process <name>]
  xcodebazelmcp macos-install <target-or-app-path> [--destination /Applications]
  xcodebazelmcp macos-app-path <target>
  xcodebazelmcp macos-bundle-id <app-path-or-target>
  xcodebazelmcp macos-log [--process <name>] [--level debug|info|default] [--timeout 30]
  xcodebazelmcp macos-screenshot <output.png> [--window]

tvOS:
  xcodebazelmcp tvos-build <target> [--debug|--release] [--stream]
  xcodebazelmcp tvos-run <target> [--debug|--release] [--run-arg ...] [--stream]
  xcodebazelmcp tvos-test <target> [--filter XCTestFilter] [--stream]
  xcodebazelmcp tvos-discover [--scope //tvos/...] [--kind tvos_apps|tvos_tests|tvos_all]

watchOS:
  xcodebazelmcp watchos-build <target> [--debug|--release] [--stream]
  xcodebazelmcp watchos-run <target> [--debug|--release] [--run-arg ...] [--stream]
  xcodebazelmcp watchos-test <target> [--filter XCTestFilter] [--stream]
  xcodebazelmcp watchos-discover [--scope //watch/...] [--kind watchos_apps|watchos_tests|watchos_all]

visionOS:
  xcodebazelmcp visionos-build <target> [--debug|--release] [--stream]
  xcodebazelmcp visionos-run <target> [--debug|--release] [--run-arg ...] [--stream]
  xcodebazelmcp visionos-test <target> [--filter XCTestFilter] [--stream]
  xcodebazelmcp visionos-discover [--scope //vision/...] [--kind visionos_apps|visionos_tests|visionos_all]

Xcode Native MCP (Xcode 26.3+):
  xcodebazelmcp xcode-mcp-status            Detect Apple's native Xcode MCP (mcpbridge), lldb-mcp, DeviceHub
  xcodebazelmcp devicehub                   Open DeviceHub.app (Xcode-beta / Xcode 27) for device interaction
  xcodebazelmcp xcode-export-skills [--output-dir <dir>] [--replace-existing]
                              Export Xcode's agent SKILL.md bundles (needs a running Xcode)

Daemon:
  xcodebazelmcp daemon [--workspace <path>]  Start the background daemon (foreground, Ctrl+C to stop)
  xcodebazelmcp daemon-start                 Ensure daemon is running (spawns in background)
  xcodebazelmcp daemon-stop                  Stop the daemon
  xcodebazelmcp daemon-status                Show daemon status and active operations

Scaffold:
  xcodebazelmcp new <template> <name> [-o <dir>] [--bundle-id com.example.MyApp] [--minimum-os 17.0]
  xcodebazelmcp templates                    List available scaffold templates
                Templates: ios_app, ios_test, ios_app_with_tests, macos_app, macos_test, macos_app_with_tests

Swift Package (SPM):
  xcodebazelmcp spm-build [--path <dir>] [--release] [--target <name>] [--stream]
  xcodebazelmcp spm-test [--path <dir>] [--filter TestClass.testMethod] [--stream]
  xcodebazelmcp spm-run [<executable>] [--path <dir>] [--release] [--run-arg ...]
  xcodebazelmcp spm-clean [--path <dir>]
  xcodebazelmcp spm-resolve [--path <dir>]
  xcodebazelmcp spm-dump [--path <dir>]
  xcodebazelmcp spm-init [--type library|executable|tool] [--name MyPackage] [--path <dir>]

UI Automation:
  xcodebazelmcp tap <x> <y> [--simulator-name "..."]
  xcodebazelmcp double-tap <x> <y> [--simulator-name "..."]
  xcodebazelmcp long-press <x> <y> [--duration 1.5]
  xcodebazelmcp swipe <up|down|left|right> [--x 200] [--y 400] [--distance 300]
  xcodebazelmcp pinch --x 200 --y 400 --scale 2.0
  xcodebazelmcp type "Hello" [--simulator-name "..."]
  xcodebazelmcp key-press Return
  xcodebazelmcp drag --from-x 100 --from-y 200 --to-x 300 --to-y 400
  xcodebazelmcp a11y [--simulator-name "..."]          Accessibility snapshot

App Interaction:
  xcodebazelmcp privacy <grant|revoke|reset> <service> [bundleId] [--simulator-name "..."]
  xcodebazelmcp push <bundleId> [--title "..."] [--body "..."] [--badge N] [--payload file.json]
  xcodebazelmcp open-url <url> [--simulator-name "..."]

Debugging (LLDB):
  xcodebazelmcp lldb-attach <pid|processName> [--wait] [--device]
  xcodebazelmcp lldb-detach <sessionId>
  xcodebazelmcp lldb-break set --session <id> --file Foo.swift --line 42
  xcodebazelmcp lldb-break set --session <id> --symbol viewDidLoad
  xcodebazelmcp lldb-break list --session <id>
  xcodebazelmcp lldb-break delete --session <id> --id 1
  xcodebazelmcp lldb-bt <sessionId>
  xcodebazelmcp lldb-vars <sessionId> [--scope local|args|all]
  xcodebazelmcp lldb-expr <sessionId> <expression>
  xcodebazelmcp lldb-step <sessionId> <over|into|out|continue>
  xcodebazelmcp lldb-threads <sessionId> [--select-thread N] [--select-frame N]
  xcodebazelmcp lldb-cmd <sessionId> <raw lldb command>
  xcodebazelmcp lldb-sessions

Logging:
  xcodebazelmcp log-start [--simulator-id <UDID>] [--simulator-name <name>]
                          [--process MyApp] [--subsystem com.example.MyApp]
                          [--level debug]
                          Streams logs to stdout. Press Ctrl+C to stop.`);
}
