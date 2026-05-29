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
  buildMode?: BuildMode;
  platform?: BuildPlatform;
}

export interface ProfileConfig {
  defaultTarget?: string;
  defaultSimulatorName?: string;
  defaultSimulatorId?: string;
  defaultBuildMode?: BuildMode;
  defaultPlatform?: BuildPlatform;
}

export interface FileConfig {
  workspacePath?: string;
  bazelPath?: string;
  maxOutput?: number;
  defaultSimulatorName?: string;
  defaultPlatform?: BuildPlatform;
  defaultBuildMode?: BuildMode;
  defaultTarget?: string;
  profiles?: Record<string, ProfileConfig>;
  enabledWorkflows?: string[];
}

export interface RuntimeConfig {
  workspacePath: string;
  bazelPath: string;
  maxOutput: number;
  configFilePath?: string;
  defaults: SessionDefaults;
  activeProfile?: string;
  profiles: Record<string, ProfileConfig>;
  enabledWorkflows?: string[];
}

export interface CommandResult {
  command: string;
  args: string[];
  exitCode: number;
  signal?: NodeJS.Signals | null;
  durationMs: number;
  output: string;
  truncated: boolean;
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
