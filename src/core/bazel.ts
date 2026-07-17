import { randomUUID } from 'node:crypto';
import { getConfig } from '../runtime/config.js';
import type { BuildArgs, BuildMode, BuildPlatform, CommandResult, TargetKind } from '../types/index.js';
import { runCommand, runCommandStreaming, type StreamChunk } from '../utils/process.js';
import { logCommand } from './command-log.js';
import { assertBazelWorkspace } from './workspace.js';

let lastCommand: CommandResult | null = null;

/**
 * Split a shell-like string into argv tokens, honoring single/double quotes so
 * a startup arg containing spaces (e.g. `--output_base="/path with space"`)
 * survives as one token. Falls back to whitespace splitting for unquoted input.
 */
export function tokenizeArgs(input: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let hasToken = false;
  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true; // even an empty "" is a token
    } else if (/\s/.test(ch)) {
      if (hasToken) { tokens.push(cur); cur = ''; hasToken = false; }
    } else {
      cur += ch;
      hasToken = true;
    }
  }
  if (hasToken) tokens.push(cur);
  return tokens;
}

function resolveStartupArgs(startupArgs: string[]): { envStartupArgs: string[]; all: string[] } {
  const envStartupArgs = process.env.BAZEL_IOS_STARTUP_ARGS
    ? tokenizeArgs(process.env.BAZEL_IOS_STARTUP_ARGS)
    : [];
  return { envStartupArgs, all: [...envStartupArgs, ...startupArgs] };
}

/**
 * iOS simulator CPU token. Defaults to the host architecture (`sim_arm64` on
 * Apple silicon, `x86_64` on Intel) so simulator builds work on both. Override
 * with `BAZEL_IOS_SIMULATOR_CPU`.
 */
export function iosSimulatorCpu(): string {
  const override = process.env.BAZEL_IOS_SIMULATOR_CPU?.trim();
  if (override) return override;
  return process.arch === 'x64' ? 'x86_64' : 'sim_arm64';
}

/** `--ios_multi_cpus=<cpu>` for simulator builds/tests, host-arch aware. */
export function iosSimulatorCpuArg(): string {
  return `--ios_multi_cpus=${iosSimulatorCpu()}`;
}

/**
 * Attach resolved-config context (surfaced on failure) and record the
 * invocation to the persistent command log with a correlation id.
 */
function finalizeBazelResult(
  result: CommandResult,
  ctx: { id: string; bazelPath: string; workspacePath: string; allStartupArgs: string[] },
): CommandResult {
  result.context = {
    bazel: ctx.bazelPath,
    workspace: ctx.workspacePath,
    startupArgs: ctx.allStartupArgs.length ? ctx.allStartupArgs.join(' ') : '(none)',
  };
  logCommand({
    id: ctx.id,
    timestamp: Date.now(),
    argv: [ctx.bazelPath, ...result.args],
    cwd: ctx.workspacePath,
    envOverrides: ctx.allStartupArgs.length ? ctx.allStartupArgs : undefined,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    truncated: result.truncated || undefined,
    failureKind: result.failureKind,
    timedOut: result.timedOut,
    bytesDropped: result.bytesDropped,
  });
  lastCommand = result;
  return result;
}

export function getLastCommand(): CommandResult | null {
  return lastCommand;
}

export function asStringArray(value: unknown, name: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${name} must be an array of strings.`);
  }
  return value;
}

export function requireLabel(value: unknown, name = 'target'): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  if (!/^(@{1,2}[\w.+~-]*)?\/\/[A-Za-z0-9_.\-/$+]*(?::[A-Za-z0-9_.\-$%+=~]+|\.\.\.)?$/.test(value)) {
    throw new Error(`${name} must be a Bazel label or package pattern, got: ${value}`);
  }
  return value;
}

export function sanitizeQueryExpression(expression: unknown): string {
  if (typeof expression !== 'string' || expression.trim().length === 0) {
    throw new Error('expression is required.');
  }
  if (/[;&|`$<>]/.test(expression)) {
    throw new Error('expression contains shell-like control characters (none of ; & | ` $ < > are valid in a bazel query).');
  }
  return expression;
}

export function simulatorArgs(args: { simulatorName?: unknown; simulatorVersion?: unknown }): string[] {
  const values: string[] = [];
  if (typeof args.simulatorName === 'string' && args.simulatorName.trim()) {
    values.push(`--ios_simulator_device=${args.simulatorName.trim()}`);
  }
  if (typeof args.simulatorVersion === 'string' && args.simulatorVersion.trim()) {
    values.push(`--ios_simulator_version=${args.simulatorVersion.trim()}`);
  }
  return values;
}

export function modeArgs(buildMode?: BuildMode): string[] {
  const mode = buildMode || 'none';
  switch (mode) {
    case 'none':
      return [];
    case 'debug':
      return ['--config=debug'];
    case 'release':
      return ['--config=ios_release'];
    case 'release_with_symbols':
      return ['--config=ios_release', '--config=generate_dsym'];
    default: {
      const _exhaustive: never = mode;
      throw new Error(`Unknown build mode: ${_exhaustive}`);
    }
  }
}

export function platformArgs(platform?: BuildPlatform): string[] {
  const p = platform || 'none';
  switch (p) {
    case 'none':
      return [];
    case 'simulator': {
      const cpu = iosSimulatorCpu();
      const platformName = cpu === 'sim_arm64' ? 'ios_sim_arm64' : `ios_${cpu}`;
      return [`--platforms=@build_bazel_apple_support//platforms:${platformName}`, `--ios_multi_cpus=${cpu}`];
    }
    case 'device':
      return ['--platforms=@build_bazel_apple_support//platforms:ios_arm64', '--ios_multi_cpus=arm64'];
    case 'macos':
      return ['--platforms=@build_bazel_apple_support//platforms:darwin_arm64'];
    case 'tvos':
      return ['--platforms=@build_bazel_apple_support//platforms:tvos_sim_arm64', '--tvos_cpus=sim_arm64'];
    case 'watchos':
      return ['--platforms=@build_bazel_apple_support//platforms:watchos_arm64', '--watchos_cpus=arm64'];
    case 'visionos':
      return ['--platforms=@build_bazel_apple_support//platforms:visionos_sim_arm64', '--visionos_cpus=sim_arm64'];
    default: {
      const _exhaustive: never = p;
      throw new Error(`Unknown platform: ${_exhaustive}`);
    }
  }
}

export function testFilterArgs(testFilter: unknown): string[] {
  if (typeof testFilter !== 'string' || !testFilter.trim()) return [];
  const trimmed = testFilter.trim();
  if (trimmed.includes('|')) {
    const joined = trimmed.split('|').map(p => p.trim()).filter(Boolean).join(',');
    return [`--test_filter=${joined}`];
  }
  return [`--test_filter=${trimmed}`];
}

/** Bazel configs that require `BITRISE_BUILD_CACHE_AUTH_TOKEN` (DoorDash ios `.bazelrc`). */
export const BITRISE_AUTH_CONFIGS = ['bitrise', 'remote_linux'] as const;

export type BitriseAuthConfig = (typeof BITRISE_AUTH_CONFIGS)[number];

export function bitriseAuthAvailable(): boolean {
  return Boolean(process.env.BITRISE_BUILD_CACHE_AUTH_TOKEN?.trim());
}

function isBitriseAuthConfig(name: string): name is BitriseAuthConfig {
  return (BITRISE_AUTH_CONFIGS as readonly string[]).includes(name);
}

/** Drop Bitrise RBE configs from a `configs` array when the auth token is missing. */
export function withoutBitriseAuthConfigs(configs: string[]): string[] {
  if (bitriseAuthAvailable()) return configs;
  return configs.filter((config) => !isBitriseAuthConfig(config));
}

/**
 * Remove `--config=bitrise` / `--config=remote_linux` from a Bazel argv when
 * `BITRISE_BUILD_CACHE_AUTH_TOKEN` is unset so local builds/tests still run.
 */
export function stripBitriseAuthFlags(args: string[]): string[] {
  if (bitriseAuthAvailable()) return args;

  const stripped: string[] = [];
  const kept = args.filter((arg) => {
    const match = /^--config=(.+)$/.exec(arg);
    if (match && isBitriseAuthConfig(match[1])) {
      stripped.push(arg);
      return false;
    }
    return true;
  });

  if (stripped.length > 0) {
    process.stderr.write(
      `[XcodeBazelMCP] Skipping Bitrise RBE config(s) ${stripped.join(', ')} — `
        + 'BITRISE_BUILD_CACHE_AUTH_TOKEN is not set; using local execution.\n',
    );
  }

  return kept;
}

export function configArgs(value: unknown): string[] {
  return withoutBitriseAuthConfigs(asStringArray(value, 'configs')).map((config) => {
    if (!/^[A-Za-z0-9_.-]+$/.test(config)) {
      throw new Error(`Invalid config value: ${config}`);
    }
    return `--config=${config}`;
  });
}

/**
 * Extract Bazel target labels from `bazel query` output. Bazel writes
 * progress/INFO/WARNING/DEBUG lines to stderr which `runCommand` merges into the
 * combined output, so we keep only lines that look like a bare label/pattern.
 */
export function parseTargetLabels(output: string): string[] {
  const seen = new Set<string>();
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.includes(' ') || line.includes('\t')) continue;
    if (!line.includes('//')) continue;
    if (line.startsWith('//') || line.startsWith('@')) seen.add(line);
  }
  return [...seen].sort();
}

/**
 * Default bazel query scope for target discovery. Overridable via
 * `BAZEL_IOS_DISCOVER_SCOPE` so non-monorepo workspaces (without //Apps and
 * //Packages) can point discovery at e.g. `//...`.
 */
export function defaultDiscoverScope(): string {
  return process.env.BAZEL_IOS_DISCOVER_SCOPE?.trim() || '(//Apps/... union //Packages/...)';
}

export function discoverExpression(kind: TargetKind = 'all', scope?: string): string {
  const queryScope = scope || defaultDiscoverScope();
  switch (kind) {
    case 'apps':
      return `kind("ios_application rule", ${queryScope})`;
    case 'tests':
      return `(kind("ios_unit_test rule", ${queryScope}) union kind("ios_ui_test rule", ${queryScope}) union kind("ios_build_test rule", ${queryScope}))`;
    case 'all':
      return `(kind("ios_application rule", ${queryScope}) union kind("ios_unit_test rule", ${queryScope}) union kind("ios_ui_test rule", ${queryScope}) union kind("ios_build_test rule", ${queryScope}))`;
    case 'macos_apps':
      return `kind("macos_application rule", ${queryScope})`;
    case 'macos_tests':
      return `kind("macos_unit_test rule", ${queryScope})`;
    case 'macos_all':
      return `(kind("macos_application rule", ${queryScope}) union kind("macos_unit_test rule", ${queryScope}))`;
    case 'tvos_apps':
      return `kind("tvos_application rule", ${queryScope})`;
    case 'tvos_tests':
      return `kind("tvos_unit_test rule", ${queryScope})`;
    case 'tvos_all':
      return `(kind("tvos_application rule", ${queryScope}) union kind("tvos_unit_test rule", ${queryScope}))`;
    case 'watchos_apps':
      return `kind("watchos_application rule", ${queryScope})`;
    case 'watchos_tests':
      return `kind("watchos_unit_test rule", ${queryScope})`;
    case 'watchos_all':
      return `(kind("watchos_application rule", ${queryScope}) union kind("watchos_unit_test rule", ${queryScope}))`;
    case 'visionos_apps':
      return `kind("visionos_application rule", ${queryScope})`;
    case 'visionos_tests':
      return `kind("visionos_unit_test rule", ${queryScope})`;
    case 'visionos_all':
      return `(kind("visionos_application rule", ${queryScope}) union kind("visionos_unit_test rule", ${queryScope}))`;
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unknown target kind: ${_exhaustive}`);
    }
  }
}

export async function runBazel(
  args: string[],
  timeoutSeconds?: number,
  startupArgs: string[] = [],
): Promise<CommandResult> {
  const config = getConfig();
  assertBazelWorkspace(config.workspacePath);
  const { all: allStartupArgs } = resolveStartupArgs(startupArgs);
  const id = randomUUID().slice(0, 8);
  const sanitizedArgs = stripBitriseAuthFlags(args);
  const result = await runCommand(config.bazelPath, [...allStartupArgs, ...sanitizedArgs], {
    cwd: config.workspacePath,
    timeoutSeconds,
    maxOutput: config.maxOutput,
    id,
  });
  return finalizeBazelResult(result, {
    id,
    bazelPath: config.bazelPath,
    workspacePath: config.workspacePath,
    allStartupArgs,
  });
}

export async function* runBazelStreaming(
  args: string[],
  timeoutSeconds?: number,
  startupArgs: string[] = [],
): AsyncGenerator<StreamChunk | CommandResult> {
  const config = getConfig();
  assertBazelWorkspace(config.workspacePath);
  const { all: allStartupArgs } = resolveStartupArgs(startupArgs);
  const id = randomUUID().slice(0, 8);

  const sanitizedArgs = stripBitriseAuthFlags(args);
  for await (const chunk of runCommandStreaming(
    config.bazelPath,
    [...allStartupArgs, ...sanitizedArgs],
    {
      cwd: config.workspacePath,
      timeoutSeconds,
      maxOutput: config.maxOutput,
      id,
    },
  )) {
    if ('stream' in chunk) {
      yield chunk;
    } else {
      yield finalizeBazelResult(chunk, {
        id,
        bazelPath: config.bazelPath,
        workspacePath: config.workspacePath,
        allStartupArgs,
      });
    }
  }
}

export function buildCommandArgs(args: BuildArgs): string[] {
  const target = requireLabel(args.target);
  const isDevice = args.platform === 'device';
  return [
    'build',
    ...modeArgs(args.buildMode),
    ...platformArgs(args.platform),
    ...(isDevice ? [] : simulatorArgs(args)),
    ...configArgs(args.configs),
    ...stripBitriseAuthFlags(asStringArray(args.extraArgs, 'extraArgs')),
    target,
  ];
}
