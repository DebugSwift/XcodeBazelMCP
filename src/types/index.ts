type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue | undefined };

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonObject;
}

export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'resource'; resource: { uri: string; mimeType: string; text: string } };

export interface ToolCallResult {
  content: ToolContent[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

export interface SessionDefaults {
  target?: string;
  simulatorName?: string;
  simulatorId?: string;
  deviceName?: string;
  deviceId?: string;
  buildMode?: BuildMode;
  platform?: BuildPlatform;
  streaming?: boolean;
}

export interface ProfileConfig {
  defaultTarget?: string;
  defaultSimulatorName?: string;
  defaultSimulatorId?: string;
  defaultDeviceName?: string;
  defaultDeviceId?: string;
  defaultBuildMode?: BuildMode;
  defaultPlatform?: BuildPlatform;
  streaming?: boolean;
}

export interface FileConfig {
  workspacePath?: string;
  bazelPath?: string;
  maxOutput?: number;
  defaultSimulatorName?: string;
  defaultDeviceName?: string;
  defaultDeviceId?: string;
  defaultPlatform?: BuildPlatform;
  defaultBuildMode?: BuildMode;
  defaultTarget?: string;
  defaultStreaming?: boolean;
  profiles?: Record<string, ProfileConfig>;
  enabledWorkflows?: string[];
}

export interface RuntimeConfig {
  workspacePath: string;
  bazelPath: string;
  maxOutput: number;
  configFilePath?: string;
  /** True when workspace was inferred by walking up from cwd/env (not explicitly set). */
  workspaceAutoDiscovered?: boolean;
  defaults: SessionDefaults;
  activeProfile?: string;
  profiles: Record<string, ProfileConfig>;
  enabledWorkflows?: string[];
}

export type FailureKind = 'ok' | 'spawn-error' | 'timeout' | 'signal' | 'nonzero-exit';

export interface CommandResult {
  command: string;
  args: string[];
  exitCode: number;
  signal?: NodeJS.Signals | null;
  durationMs: number;
  /** Combined stdout+stderr in arrival order (head+tail truncated). */
  output: string;
  truncated: boolean;
  /** Separate stdout channel (head+tail truncated). */
  stdout?: string;
  /** Separate stderr channel — where Bazel/Swift write real diagnostics. */
  stderr?: string;
  /** Explicit failure classification so spawn errors != crashes != timeouts. */
  failureKind?: FailureKind;
  /** True when the command was killed by the timeout watchdog. */
  timedOut?: boolean;
  /** Configured timeout (seconds) for this invocation. */
  timeoutSeconds?: number;
  /** Approximate characters dropped by head+tail truncation. */
  bytesDropped?: number;
  /** For spawn errors: the underlying errno code (ENOENT, EACCES, ...). */
  spawnErrorCode?: string;
  /** Correlation id linking the MCP request, the spawned command, and the log line. */
  id?: string;
  /** Optional resolved-config context surfaced on failure (bazel path, workspace, startup args). */
  context?: Record<string, string>;
}

export type TargetKind =
  | 'apps' | 'tests' | 'all'
  | 'macos_apps' | 'macos_tests' | 'macos_all'
  | 'tvos_apps' | 'tvos_tests' | 'tvos_all'
  | 'watchos_apps' | 'watchos_tests' | 'watchos_all'
  | 'visionos_apps' | 'visionos_tests' | 'visionos_all';
export type BuildMode = 'none' | 'debug' | 'release' | 'release_with_symbols';
export type BuildPlatform = 'none' | 'simulator' | 'device' | 'macos' | 'tvos' | 'watchos' | 'visionos';

export interface BuildArgs extends JsonObject {
  target?: string;
  startupArgs?: string[];
  buildMode?: BuildMode;
  platform?: BuildPlatform;
  simulatorName?: string;
  simulatorVersion?: string;
  deviceId?: string;
  deviceName?: string;
  configs?: string[];
  extraArgs?: string[];
  timeoutSeconds?: number;
}

export interface TestArgs extends JsonObject {
  target?: string;
  startupArgs?: string[];
  testFilter?: string;
  simulatorName?: string;
  simulatorVersion?: string;
  configs?: string[];
  extraArgs?: string[];
  timeoutSeconds?: number;
  minimizeSimulator?: boolean;
  shutdownSimulatorAfterTest?: boolean;
}

export interface QueryArgs extends JsonObject {
  expression?: string;
  startupArgs?: string[];
  output?: string;
  extraArgs?: string[];
  timeoutSeconds?: number;
}

export interface BuildAndRunArgs extends BuildArgs {
  simulatorId?: string;
  launchArgs?: string[];
  launchEnv?: Record<string, string>;
}

export interface InstallAppArgs extends JsonObject {
  appPath?: string;
  simulatorId?: string;
  simulatorName?: string;
}

export interface LaunchAppArgs extends JsonObject {
  bundleId?: string;
  simulatorId?: string;
  launchArgs?: string[];
  launchEnv?: Record<string, string>;
}
