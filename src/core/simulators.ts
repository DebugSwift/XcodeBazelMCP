import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CommandResult } from '../types/index.js';
import { runCommand } from '../utils/process.js';

export interface SimulatorDevice {
  runtime: string;
  name: string;
  udid: string;
  state: string;
  isAvailable: boolean;
}

/**
 * Allowlist for os_log predicate filter values (process name / subsystem).
 * Prevents a crafted value from breaking out of the quoted predicate and
 * broadening the log stream to other apps or Apple system subsystems.
 */
const LOG_FILTER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function assertLogFilter(value: string, name: string): string {
  if (!LOG_FILTER_RE.test(value)) {
    throw new Error(
      `Invalid ${name} "${value}". Use letters, numbers, dots, dashes, and underscores only (e.g. com.example.MyApp).`,
    );
  }
  return value;
}

/**
 * Build a safe `log stream --predicate` value from optional process/subsystem
 * filters. Filters are validated against an allowlist and combined with AND so
 * they narrow (intersect) the stream rather than broaden it.
 */
export function buildLogPredicate(opts: { processName?: string; subsystem?: string }): string | undefined {
  const predicates: string[] = [];
  if (opts.processName) predicates.push(`process == "${assertLogFilter(opts.processName, 'processName')}"`);
  if (opts.subsystem) predicates.push(`subsystem == "${assertLogFilter(opts.subsystem, 'subsystem')}"`);
  return predicates.length > 0 ? predicates.join(' AND ') : undefined;
}

export async function listSimulators(onlyBooted = false): Promise<{
  command: CommandResult;
  devices: SimulatorDevice[];
}> {
  const command = await runCommand('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], {
    cwd: process.cwd(),
    timeoutSeconds: 30,
    maxOutput: 200_000,
  });

  if (command.exitCode !== 0) {
    return { command, devices: [] };
  }

  let parsed: { devices?: Record<string, Array<Omit<SimulatorDevice, 'runtime'>>> };
  try {
    // simctl writes JSON to stdout; prefer it so stderr warnings (e.g. runtime
    // deprecation notices merged into `output`) can't break JSON.parse.
    parsed = JSON.parse(command.stdout || command.output);
  } catch {
    return { command, devices: [] };
  }
  const devices = Object.entries(parsed.devices || {}).flatMap(([runtime, runtimeDevices]) =>
    runtimeDevices
      .filter((device) => !onlyBooted || device.state === 'Booted')
      .map((device) => ({
        runtime,
        name: device.name,
        udid: device.udid,
        state: device.state,
        isAvailable: device.isAvailable,
      })),
  );

  return { command, devices };
}

interface ResolvedSimulator {
  device: SimulatorDevice;
  warning?: string;
}

/**
 * Turn a runtime id like `com.apple.CoreSimulator.SimRuntime.iOS-26-3` into a
 * comparable number (26.3 → 26003) so the newest runtime sorts highest.
 */
export function runtimeVersion(runtime: string): number {
  const match = runtime.match(/(\d+)-(\d+)(?:-(\d+))?$/);
  if (!match) return 0;
  const [, major, minor, patch] = match;
  return Number(major) * 1_000_000 + Number(minor) * 1_000 + Number(patch || 0);
}

export async function resolveSimulator(options: {
  simulatorId?: string;
  simulatorName?: string;
}): Promise<ResolvedSimulator> {
  const { devices } = await listSimulators();

  if (options.simulatorId) {
    const match = devices.find((d) => d.udid === options.simulatorId);
    if (!match) throw new Error(`Simulator with UDID ${options.simulatorId} not found.`);
    return { device: match };
  }

  if (options.simulatorName) {
    const match = devices.find(
      (d) => d.name.toLowerCase() === options.simulatorName!.toLowerCase(),
    );
    if (!match) throw new Error(`Simulator "${options.simulatorName}" not found.`);
    return { device: match };
  }

  const bootedDevices = devices.filter((d) => d.state === 'Booted');

  if (bootedDevices.length > 1) {
    const chosen = bootedDevices[0];
    const others = bootedDevices.slice(1).map((d) => `${d.name} (${d.udid})`).join(', ');
    return {
      device: chosen,
      warning: `⚠️ Multiple simulators booted. Targeting ${chosen.name} (${chosen.udid}). ` +
        `Also booted: ${others}. Use an explicit simulatorId or simulatorName to avoid ambiguity.`,
    };
  }

  if (bootedDevices.length === 1) return { device: bootedDevices[0] };

  // No booted sim: pick a deterministic, sensible default — the available
  // iPhone on the newest runtime (rather than whatever simctl happens to list
  // first, which is often an old model).
  const iphones = devices
    .filter((d) => d.name.startsWith('iPhone') && d.isAvailable)
    .sort((a, b) => runtimeVersion(b.runtime) - runtimeVersion(a.runtime) || a.name.localeCompare(b.name));
  if (iphones.length > 0) return { device: iphones[0] };

  if (devices.length > 0) return { device: devices[0] };

  throw new Error('No simulators available. Install a simulator runtime in Xcode.');
}

export async function bootSimulatorIfNeeded(device: SimulatorDevice): Promise<CommandResult | null> {
  if (device.state === 'Booted') return null;

  return runCommand('xcrun', ['simctl', 'boot', device.udid], {
    cwd: process.cwd(),
    timeoutSeconds: 60,
    maxOutput: 50_000,
  });
}

export async function installApp(
  simulatorUdid: string,
  appPath: string,
): Promise<CommandResult> {
  if (!existsSync(appPath)) {
    throw new Error(`App bundle not found: ${appPath}`);
  }

  return runCommand('xcrun', ['simctl', 'install', simulatorUdid, appPath], {
    cwd: process.cwd(),
    timeoutSeconds: 120,
    maxOutput: 50_000,
  });
}

export async function uninstallApp(
  simulatorUdid: string,
  bundleId: string,
): Promise<CommandResult> {
  return runCommand('xcrun', ['simctl', 'uninstall', simulatorUdid, bundleId], {
    cwd: process.cwd(),
    timeoutSeconds: 30,
    maxOutput: 50_000,
  });
}

export async function launchApp(
  simulatorUdid: string,
  bundleId: string,
  launchArgs: string[] = [],
  launchEnv: Record<string, string> = {},
): Promise<CommandResult> {
  const args = ['simctl', 'launch', simulatorUdid, bundleId, ...launchArgs];

  const env = { ...process.env };
  for (const [key, value] of Object.entries(launchEnv)) {
    env[`SIMCTL_CHILD_${key}`] = value;
  }

  return runCommand('xcrun', args, {
    cwd: process.cwd(),
    timeoutSeconds: 30,
    maxOutput: 50_000,
    env,
  });
}

/**
 * Locate the Info.plist for an .app bundle, handling both the iOS layout
 * (`<app>/Info.plist`) and the macOS layout (`<app>/Contents/Info.plist`).
 */
export function findInfoPlist(appPath: string): string | null {
  const iosPlist = join(appPath, 'Info.plist');
  if (existsSync(iosPlist)) return iosPlist;
  const macPlist = join(appPath, 'Contents', 'Info.plist');
  if (existsSync(macPlist)) return macPlist;
  return null;
}

/** Read a single string value out of an .app bundle's Info.plist. */
export function readInfoPlistValue(appPath: string, key: string): string | undefined {
  const plistPath = findInfoPlist(appPath);
  if (!plistPath) {
    throw new Error(`Info.plist not found in ${appPath}`);
  }
  const result = spawnSync('plutil', ['-convert', 'json', '-o', '-', plistPath], {
    encoding: 'utf-8',
    timeout: 5_000,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`plutil failed with exit code ${result.status}: ${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
  const value = parsed[key];
  return typeof value === 'string' ? value : undefined;
}

export function readBundleId(appPath: string): string {
  const bundleId = readInfoPlistValue(appPath, 'CFBundleIdentifier');
  if (!bundleId) {
    throw new Error(`CFBundleIdentifier not found in ${appPath}`);
  }
  return bundleId;
}

export async function bootSimulator(udid: string): Promise<CommandResult> {
  return runCommand('xcrun', ['simctl', 'boot', udid], {
    cwd: process.cwd(),
    timeoutSeconds: 60,
    maxOutput: 50_000,
  });
}

export async function shutdownSimulator(udid: string): Promise<CommandResult> {
  return runCommand('xcrun', ['simctl', 'shutdown', udid], {
    cwd: process.cwd(),
    timeoutSeconds: 30,
    maxOutput: 50_000,
  });
}

export async function shutdownAllSimulators(): Promise<CommandResult> {
  return runCommand('xcrun', ['simctl', 'shutdown', 'all'], {
    cwd: process.cwd(),
    timeoutSeconds: 60,
    maxOutput: 50_000,
  });
}

export async function deleteSimulator(udid: string): Promise<CommandResult> {
  return runCommand('xcrun', ['simctl', 'delete', udid], {
    cwd: process.cwd(),
    timeoutSeconds: 30,
    maxOutput: 50_000,
  });
}

export async function eraseSimulator(udid: string): Promise<CommandResult> {
  return runCommand('xcrun', ['simctl', 'erase', udid], {
    cwd: process.cwd(),
    timeoutSeconds: 60,
    maxOutput: 50_000,
  });
}

export async function setSimulatorLocation(
  udid: string,
  latitude: number,
  longitude: number,
): Promise<CommandResult> {
  return runCommand('xcrun', ['simctl', 'location', udid, 'set', `${latitude},${longitude}`], {
    cwd: process.cwd(),
    timeoutSeconds: 10,
    maxOutput: 50_000,
  });
}

export async function setSimulatorAppearance(
  udid: string,
  appearance: 'light' | 'dark',
): Promise<CommandResult> {
  return runCommand('xcrun', ['simctl', 'ui', udid, 'appearance', appearance], {
    cwd: process.cwd(),
    timeoutSeconds: 10,
    maxOutput: 50_000,
  });
}

export async function openSimulatorApp(udid?: string): Promise<CommandResult> {
  return runCommand('open', ['-a', 'Simulator', ...(udid ? ['--args', '-CurrentDeviceUDID', udid] : [])], {
    cwd: process.cwd(),
    timeoutSeconds: 10,
    maxOutput: 50_000,
  });
}

export async function terminateApp(
  simulatorUdid: string,
  bundleId: string,
): Promise<CommandResult> {
  return runCommand('xcrun', ['simctl', 'terminate', simulatorUdid, bundleId], {
    cwd: process.cwd(),
    timeoutSeconds: 10,
    maxOutput: 50_000,
  });
}

export async function takeScreenshot(
  simulatorUdid: string,
  outputPath: string,
  mask: 'alpha' | 'black' | 'ignored' = 'ignored',
): Promise<CommandResult> {
  return runCommand('xcrun', ['simctl', 'io', simulatorUdid, 'screenshot', '--mask', mask, outputPath], {
    cwd: process.cwd(),
    timeoutSeconds: 15,
    maxOutput: 50_000,
  });
}

export async function startVideoRecording(
  simulatorUdid: string,
  outputPath: string,
): Promise<ReturnType<typeof import('node:child_process').spawn>> {
  const { spawn } = await import('node:child_process');
  const child = spawn('xcrun', ['simctl', 'io', simulatorUdid, 'recordVideo', '-f', outputPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return child;
}

export async function setStatusBar(
  simulatorUdid: string,
  overrides: Record<string, string>,
): Promise<CommandResult> {
  const args = ['simctl', 'status_bar', simulatorUdid, 'override'];
  for (const [key, value] of Object.entries(overrides)) {
    args.push(`--${key}`, value);
  }
  return runCommand('xcrun', args, {
    cwd: process.cwd(),
    timeoutSeconds: 10,
    maxOutput: 50_000,
  });
}

export async function clearStatusBar(simulatorUdid: string): Promise<CommandResult> {
  return runCommand('xcrun', ['simctl', 'status_bar', simulatorUdid, 'clear'], {
    cwd: process.cwd(),
    timeoutSeconds: 10,
    maxOutput: 50_000,
  });
}

export async function setPrivacy(
  simulatorUdid: string,
  action: 'grant' | 'revoke' | 'reset',
  service: string,
  bundleId?: string,
): Promise<CommandResult> {
  const args = ['simctl', 'privacy', simulatorUdid, action, service];
  if (bundleId) args.push(bundleId);
  return runCommand('xcrun', args, {
    cwd: process.cwd(),
    timeoutSeconds: 10,
    maxOutput: 50_000,
  });
}

export async function sendPushNotification(
  simulatorUdid: string,
  bundleId: string,
  payloadPath: string,
): Promise<CommandResult> {
  return runCommand('xcrun', ['simctl', 'push', simulatorUdid, bundleId, payloadPath], {
    cwd: process.cwd(),
    timeoutSeconds: 10,
    maxOutput: 50_000,
  });
}

export async function openUrl(
  simulatorUdid: string,
  url: string,
): Promise<CommandResult> {
  return runCommand('xcrun', ['simctl', 'openurl', simulatorUdid, url], {
    cwd: process.cwd(),
    timeoutSeconds: 10,
    maxOutput: 50_000,
  });
}

export async function addMedia(
  simulatorUdid: string,
  paths: string[],
): Promise<CommandResult> {
  return runCommand('xcrun', ['simctl', 'addmedia', simulatorUdid, ...paths], {
    cwd: process.cwd(),
    timeoutSeconds: 60,
    maxOutput: 50_000,
  });
}

export async function getAppContainer(
  simulatorUdid: string,
  bundleId: string,
  kind: 'app' | 'data' | 'groups' = 'data',
): Promise<CommandResult> {
  return runCommand('xcrun', ['simctl', 'get_app_container', simulatorUdid, bundleId, kind], {
    cwd: process.cwd(),
    timeoutSeconds: 15,
    maxOutput: 50_000,
  });
}

export async function getSimulatorUiState(
  simulatorUdid: string,
): Promise<{ appearance: CommandResult; increaseContrast: CommandResult }> {
  const appearance = await runCommand('xcrun', ['simctl', 'ui', simulatorUdid, 'appearance'], {
    cwd: process.cwd(),
    timeoutSeconds: 10,
    maxOutput: 50_000,
  });
  const increaseContrast = await runCommand('xcrun', ['simctl', 'ui', simulatorUdid, 'increase_contrast'], {
    cwd: process.cwd(),
    timeoutSeconds: 10,
    maxOutput: 50_000,
  });
  return { appearance, increaseContrast };
}

export function findAppBundle(workspacePath: string, target: string): string | null {
  const bazelBin = join(workspacePath, 'bazel-bin');
  if (!existsSync(bazelBin)) return null;

  const explicit = target.match(/^\/\/([^:]*):(.+)$/);
  const implicit = !explicit ? target.match(/^\/\/(.+)$/) : null;
  if (!explicit && !implicit) return null;

  const pkg = explicit ? explicit[1] : implicit![1];
  const name = explicit ? explicit[2] : pkg.split('/').pop()!;
  const searchDir = pkg ? join(bazelBin, pkg) : bazelBin;
  if (!existsSync(searchDir)) return null;

  // rules_apple puts the .app inside <target>_archive-root/Payload/
  const archivePayload = join(searchDir, `${name}_archive-root`, 'Payload');
  if (existsSync(archivePayload)) {
    const app = findFirstApp(archivePayload);
    if (app) return app;
  }

  // Direct <target>.app in the output directory
  const direct = join(searchDir, `${name}.app`);
  if (existsSync(direct)) return direct;

  return searchForApp(searchDir, name);
}

function findFirstApp(dir: string): string | null {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.endsWith('.app') && entry.isDirectory()) {
        return join(dir, entry.name);
      }
    }
  } catch {
    // directory not readable
  }
  return null;
}

function searchForApp(dir: string, targetName: string, depth = 8): string | null {
  const appName = `${targetName}.app`;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === appName && entry.isDirectory()) {
        return join(dir, entry.name);
      }
    }
    if (depth <= 0) return null; // bound recursion on deep bazel-bin trees
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const found = searchForApp(join(dir, entry.name), targetName, depth - 1);
        if (found) return found;
      }
    }
  } catch {
    // directory not readable
  }
  return null;
}
