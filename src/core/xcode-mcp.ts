import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandResult } from '../types/index.js';
import { runCommand } from '../utils/process.js';

/**
 * Apple's native Xcode MCP integration (Xcode 26.3+):
 *   - `xcrun mcpbridge`            STDIO MCP bridge to a running Xcode's tool service.
 *   - `xcrun mcpbridge run-agent`  Launch a coding agent wired to Xcode tools.
 *   - `xcrun agent skills export`  Export Xcode's globally available SKILL.md bundles.
 *   - `lldb-mcp`                   LLDB MCP server (Xcode-beta / Xcode 27 only).
 *   - DeviceHub.app                GUI device manager (Xcode-beta / Xcode 27 only).
 *
 * This module only *detects and wraps* the Apple tooling. It never replaces the
 * existing Bazel/simctl/devicectl flows, so older Xcodes keep working unchanged.
 */

export interface XcodeInstall {
  appPath: string;
  developerDir: string;
  isBeta: boolean;
  /** `<dev>/usr/bin/mcpbridge` present (Xcode 26.3+). */
  hasMcpBridge: boolean;
  /** `<dev>/usr/bin/lldb-mcp` present (Xcode-beta / 27+). */
  hasLldbMcp: boolean;
  /** Absolute path to DeviceHub.app if bundled (Xcode-beta / 27+), else null. */
  deviceHubPath: string | null;
}

export interface BridgeInvocation {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export function developerDirForApp(appPath: string): string {
  return join(appPath, 'Contents', 'Developer');
}

export function deviceHubPathForApp(appPath: string): string | null {
  const candidate = join(appPath, 'Contents', 'Applications', 'DeviceHub.app');
  return existsSync(candidate) ? candidate : null;
}

export function inspectXcodeApp(appPath: string): XcodeInstall {
  const developerDir = developerDirForApp(appPath);
  const bin = join(developerDir, 'usr', 'bin');
  return {
    appPath,
    developerDir,
    isBeta: /beta/i.test(appPath),
    hasMcpBridge: existsSync(join(bin, 'mcpbridge')),
    hasLldbMcp: existsSync(join(bin, 'lldb-mcp')),
    deviceHubPath: deviceHubPathForApp(appPath),
  };
}

/** Discover installed Xcode apps (e.g. /Applications/Xcode.app, Xcode-beta.app). */
export function findXcodeApps(appsRoot = '/Applications'): string[] {
  try {
    return readdirSync(appsRoot)
      // Match Xcode.app / Xcode-beta.app / Xcode-15.4.app, but not e.g. XcodeBackup.app.
      .filter((name) => /^Xcode(-[A-Za-z0-9._]+)?\.app$/i.test(name))
      .map((name) => join(appsRoot, name))
      .sort();
  } catch {
    return [];
  }
}

/** The MCP bridge invocation. Pins DEVELOPER_DIR when a specific Xcode is requested. */
export function mcpBridgeInvocation(developerDir?: string): BridgeInvocation {
  return {
    command: 'xcrun',
    args: ['mcpbridge'],
    env: developerDir ? { DEVELOPER_DIR: developerDir } : undefined,
  };
}

/** MCP client config snippet (Cursor/Claude/Codex) to expose Xcode's native tools. */
export function xcodeMcpClientConfig(developerDir?: string): Record<string, unknown> {
  const { command, args, env } = mcpBridgeInvocation(developerDir);
  const server: Record<string, unknown> = { command, args };
  if (env) server.env = env;
  return { mcpServers: { 'xcode-native': server } };
}

export async function activeDeveloperDir(): Promise<string | null> {
  if (process.env.DEVELOPER_DIR) return process.env.DEVELOPER_DIR;
  const result = await runCommand('xcode-select', ['-p'], {
    cwd: process.cwd(),
    timeoutSeconds: 5,
    maxOutput: 2_000,
  });
  return result.exitCode === 0 && result.output.trim() ? result.output.trim() : null;
}

export async function runningXcodeProcessIds(): Promise<number[]> {
  const result = await runCommand('pgrep', ['-x', 'Xcode'], {
    cwd: process.cwd(),
    timeoutSeconds: 5,
    maxOutput: 5_000,
  });
  if (result.exitCode !== 0) return [];
  return result.output
    .split('\n')
    .map((line) => parseInt(line.trim(), 10))
    .filter((pid) => Number.isFinite(pid) && pid > 0);
}

export interface XcodeMcpStatus {
  installs: XcodeInstall[];
  activeDeveloperDir: string | null;
  runningXcodePids: number[];
  bridgeAvailable: boolean;
  deviceHub: XcodeInstall | null;
  lldbMcp: XcodeInstall | null;
}

export async function detectXcodeNativeMcp(appsRoot = '/Applications'): Promise<XcodeMcpStatus> {
  const installs = findXcodeApps(appsRoot).map(inspectXcodeApp);
  const [active, pids] = await Promise.all([activeDeveloperDir(), runningXcodeProcessIds()]);
  return {
    installs,
    activeDeveloperDir: active,
    runningXcodePids: pids,
    bridgeAvailable: installs.some((i) => i.hasMcpBridge),
    deviceHub: installs.find((i) => i.deviceHubPath) ?? null,
    lldbMcp: installs.find((i) => i.hasLldbMcp) ?? null,
  };
}

/** Open the GUI DeviceHub.app (Xcode-beta / 27+) for direct device interaction. */
export async function openDeviceHub(deviceHubPath: string): Promise<CommandResult> {
  return runCommand('open', [deviceHubPath], {
    cwd: process.cwd(),
    timeoutSeconds: 15,
    maxOutput: 10_000,
  });
}

export interface ExportSkillsOptions {
  outputDir?: string;
  replaceExisting?: boolean;
  developerDir?: string;
}

/**
 * Export Xcode's globally available agent skills via
 * `xcrun mcpbridge run-agent skills export`. Requires a running Xcode instance.
 */
export async function exportXcodeSkills(options: ExportSkillsOptions): Promise<CommandResult> {
  const args = ['mcpbridge', 'run-agent', 'skills', 'export'];
  if (options.outputDir) args.push('--output-dir', options.outputDir);
  if (options.replaceExisting) args.push('--replace-existing');
  const env = { ...process.env };
  if (options.developerDir) env.DEVELOPER_DIR = options.developerDir;
  return runCommand('xcrun', args, {
    cwd: process.cwd(),
    timeoutSeconds: 60,
    maxOutput: 200_000,
    env,
  });
}
