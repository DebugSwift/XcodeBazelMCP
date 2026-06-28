import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { FileConfig, ProfileConfig, RuntimeConfig, SessionDefaults } from '../types/index.js';

/** Expand a leading `~` or `~/` to the user's home directory before resolving. */
export function expandTilde(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

function resolvePath(p: string): string {
  return resolve(expandTilde(p));
}

const DEFAULT_WORKSPACE = process.env.BAZEL_IOS_WORKSPACE || process.cwd();
const DEFAULT_BAZEL = process.env.BAZEL_PATH || process.env.MCP_BAZEL_PATH || 'bazel';
const DEFAULT_MAX_OUTPUT = Number(process.env.BAZEL_IOS_MCP_MAX_OUTPUT || 200_000);

const CONFIG_FILE_NAMES = ['config.yaml', 'config.yml'];
const CONFIG_DIR = '.xcodebazelmcp';

let config: RuntimeConfig = {
  workspacePath: resolvePath(DEFAULT_WORKSPACE),
  bazelPath: expandTilde(DEFAULT_BAZEL),
  maxOutput: DEFAULT_MAX_OUTPUT,
  defaults: {},
  profiles: {},
};

let configLoaded = false;

export function getConfig(): RuntimeConfig {
  if (!configLoaded) {
    loadConfigFile();
    configLoaded = true;
  }
  const clonedProfiles: Record<string, ProfileConfig> = {};
  for (const [k, v] of Object.entries(config.profiles)) {
    clonedProfiles[k] = { ...v };
  }
  return { ...config, defaults: { ...config.defaults }, profiles: clonedProfiles };
}

export function setWorkspace(workspacePath: string, bazelPath?: string): RuntimeConfig {
  config = {
    ...config,
    workspacePath: resolvePath(workspacePath),
    bazelPath: bazelPath ? expandTilde(bazelPath) : config.bazelPath,
  };
  configLoaded = false;
  return getConfig();
}

export function setDefaults(defaults: Partial<SessionDefaults>): SessionDefaults {
  config = {
    ...config,
    defaults: {
      ...config.defaults,
      ...Object.fromEntries(
        Object.entries(defaults).filter(([, v]) => v !== undefined),
      ),
    },
  };
  return { ...config.defaults };
}

export function clearDefaults(): SessionDefaults {
  config = { ...config, defaults: {}, activeProfile: undefined };
  return { ...config.defaults };
}

export function getDefaults(): SessionDefaults {
  return { ...config.defaults };
}

export function activateProfile(name: string): SessionDefaults {
  if (!configLoaded) {
    loadConfigFile();
    configLoaded = true;
  }
  const profile = config.profiles[name];
  if (!profile) {
    throw new Error(`Unknown profile "${name}". Available: ${Object.keys(config.profiles).join(', ') || '(none)'}`);
  }
  config.activeProfile = name;
  config.defaults = {
    ...config.defaults,
    target: profile.defaultTarget || config.defaults.target,
    simulatorName: profile.defaultSimulatorName || config.defaults.simulatorName,
    simulatorId: profile.defaultSimulatorId || config.defaults.simulatorId,
    deviceName: profile.defaultDeviceName || config.defaults.deviceName,
    deviceId: profile.defaultDeviceId || config.defaults.deviceId,
    buildMode: profile.defaultBuildMode || config.defaults.buildMode,
    platform: profile.defaultPlatform || config.defaults.platform,
    streaming: profile.streaming ?? config.defaults.streaming,
  };
  return { ...config.defaults };
}

export function getProfiles(): Record<string, ProfileConfig> {
  if (!configLoaded) {
    loadConfigFile();
    configLoaded = true;
  }
  return { ...config.profiles };
}

export function getActiveProfile(): string | undefined {
  return config.activeProfile;
}

function loadConfigFile(): void {
  const searchPaths = [
    ...CONFIG_FILE_NAMES.map((name) => join(config.workspacePath, CONFIG_DIR, name)),
    ...CONFIG_FILE_NAMES.map((name) => join(homedir(), CONFIG_DIR, name)),
  ];

  for (const filePath of searchPaths) {
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf8');
        const fileConfig = parseConfigYaml(content);
        applyFileConfig(fileConfig, filePath);
        return;
      } catch {
        // skip unreadable config
      }
    }
  }
}

function applyFileConfig(fileConfig: FileConfig, filePath: string): void {
  config.configFilePath = filePath;

  if (fileConfig.workspacePath && !process.env.BAZEL_IOS_WORKSPACE) {
    config.workspacePath = resolvePath(fileConfig.workspacePath);
  }
  if (fileConfig.bazelPath && !process.env.BAZEL_PATH && !process.env.MCP_BAZEL_PATH) {
    config.bazelPath = expandTilde(fileConfig.bazelPath);
  }
  if (fileConfig.maxOutput && !process.env.BAZEL_IOS_MCP_MAX_OUTPUT) {
    config.maxOutput = fileConfig.maxOutput;
  }
  if (fileConfig.defaultSimulatorName) {
    config.defaults.simulatorName = config.defaults.simulatorName || fileConfig.defaultSimulatorName;
  }
  if (fileConfig.defaultDeviceName) {
    config.defaults.deviceName = config.defaults.deviceName || fileConfig.defaultDeviceName;
  }
  if (fileConfig.defaultDeviceId) {
    config.defaults.deviceId = config.defaults.deviceId || fileConfig.defaultDeviceId;
  }
  if (fileConfig.defaultPlatform) {
    config.defaults.platform = config.defaults.platform || fileConfig.defaultPlatform;
  }
  if (fileConfig.defaultBuildMode) {
    config.defaults.buildMode = config.defaults.buildMode || fileConfig.defaultBuildMode;
  }
  if (fileConfig.defaultTarget) {
    config.defaults.target = config.defaults.target || fileConfig.defaultTarget;
  }
  if (fileConfig.defaultStreaming !== undefined && config.defaults.streaming === undefined) {
    config.defaults.streaming = fileConfig.defaultStreaming;
  }
  if (fileConfig.profiles) {
    config.profiles = { ...config.profiles, ...fileConfig.profiles };
  }
  if (fileConfig.enabledWorkflows) {
    config.enabledWorkflows = fileConfig.enabledWorkflows;
  }
}

export function getEnabledWorkflows(): string[] | undefined {
  return getConfig().enabledWorkflows;
}

export function setEnabledWorkflows(workflows: string[] | undefined): void {
  config = { ...config, enabledWorkflows: workflows };
}

export function parseConfigYaml(content: string): FileConfig {
  const result: Record<string, unknown> = {};
  const profiles: Record<string, ProfileConfig> = {};
  let currentProfileName: string | null = null;
  let currentProfile: Record<string, string | number | boolean> = {};
  let inProfiles = false;

  for (const line of content.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();
    const colonSpaceIndex = trimmed.indexOf(': ');
    const colonIndex = colonSpaceIndex >= 1 ? colonSpaceIndex : trimmed.indexOf(':');
    if (colonIndex < 1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    const rawValue = trimmed.slice(colonIndex + (colonSpaceIndex >= 1 ? 2 : 1)).trim();

    if (indent === 0) {
      // flush previous profile
      if (currentProfileName) {
        profiles[currentProfileName] = currentProfile as unknown as ProfileConfig;
        currentProfileName = null;
        currentProfile = {};
      }

      if (key === 'profiles') {
        inProfiles = true;
        continue;
      }
      inProfiles = false;
      if (key === 'enabledWorkflows' && rawValue) {
        result[key] = rawValue.split(',').map((s) => s.trim()).filter(Boolean);
      } else {
        result[key] = parseValue(rawValue, key);
      }
    } else if (inProfiles && indent === 2 && !rawValue) {
      // profile name line like "  myapp:"
      if (currentProfileName) {
        profiles[currentProfileName] = currentProfile as unknown as ProfileConfig;
      }
      currentProfileName = key;
      currentProfile = {};
    } else if (inProfiles && indent >= 4 && currentProfileName) {
      currentProfile[key] = parseValue(rawValue, key);
    }
  }

  if (currentProfileName) {
    profiles[currentProfileName] = currentProfile as unknown as ProfileConfig;
  }

  if (Object.keys(profiles).length > 0) {
    result.profiles = profiles;
  }

  return result as unknown as FileConfig;
}

/**
 * Config keys that are always strings. Without this, a value like
 * `defaultSimulatorName: 16` would be coerced to the number 16 and fail the
 * later string-typed lookups (e.g. simulator name match).
 */
const STRING_VALUED_KEYS = new Set([
  'workspacePath', 'bazelPath',
  'defaultTarget', 'defaultSimulatorName', 'defaultSimulatorId',
  'defaultDeviceName', 'defaultDeviceId', 'defaultPlatform', 'defaultBuildMode',
]);

function parseValue(raw: string, key?: string): string | number | boolean {
  const unquoted =
    (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) ||
    (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2)
      ? raw.slice(1, -1)
      : raw;
  if (key && STRING_VALUED_KEYS.has(key)) return unquoted;
  if (unquoted === 'true') return true;
  if (unquoted === 'false') return false;
  // Only coerce to number when the original token was unquoted.
  if (unquoted === raw && /^\d+(\.\d+)?$/.test(unquoted)) return Number(unquoted);
  return unquoted;
}
