import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { CommandResult } from '../types/index.js';
import { runCommand } from '../utils/process.js';
import { readBundleId } from './simulators.js';

/**
 * Create a JSON output path inside a fresh private temp directory (0700 via
 * mkdtemp). Avoids predictable `/tmp/...-<Date.now()>.json` names that are prone
 * to symlink/TOCTOU races (CWE-377).
 */
function makeTempJsonPath(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'xcodebazelmcp-'));
  return join(dir, `${tag}.json`);
}

function cleanupTempJson(path: string): void {
  try {
    rmSync(dirname(path), { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

interface PhysicalDevice {
  udid: string;
  name: string;
  state: 'connected' | 'disconnected' | 'unavailable';
  connectionType: string;
  osVersion: string;
  platform: string;
  /** CoreDevice identifier (UUID) — used by LLDB `device select` */
  coreDeviceIdentifier?: string;
}

export async function listDevices(): Promise<{
  command: CommandResult;
  devices: PhysicalDevice[];
}> {
  const jsonOutputPath = makeTempJsonPath('devices');
  const command = await runCommand(
    'xcrun',
    ['devicectl', 'list', 'devices', '--json-output', jsonOutputPath],
    { cwd: process.cwd(), timeoutSeconds: 30, maxOutput: 200_000 },
  );

  const devices: PhysicalDevice[] = [];
  try {
    if (command.exitCode === 0) {
      const { readFileSync } = await import('node:fs');
      const raw = readFileSync(jsonOutputPath, 'utf8');
      const parsed = JSON.parse(raw) as {
        result?: {
          devices?: Array<{
            identifier?: string;
            hardwareProperties?: { udid?: string; platform?: string };
            deviceProperties?: { name?: string; osVersionNumber?: string };
            connectionProperties?: { transportType?: string; tunnelState?: string; pairingState?: string };
            visibilityClass?: string;
          }>;
        };
      };
      for (const d of parsed.result?.devices || []) {
        const udid =
          d.hardwareProperties?.udid || d.identifier || '';
        const name = d.deviceProperties?.name || '(unknown)';
        const osVersion = d.deviceProperties?.osVersionNumber || '';
        const connectionType = d.connectionProperties?.transportType || 'unknown';
        const platform = d.hardwareProperties?.platform || 'iOS';
        const tunnelState = d.connectionProperties?.tunnelState || '';
        const isPaired = d.connectionProperties?.pairingState === 'paired';
        const coreDeviceIdentifier = d.identifier || undefined;
        const state: PhysicalDevice['state'] =
          tunnelState === 'connected' ? 'connected'
          : (isPaired && d.visibilityClass === 'default') ? 'connected'
          : 'disconnected';
        if (udid) {
          devices.push({ udid, name, state, connectionType, osVersion, platform, coreDeviceIdentifier });
        }
      }
    }
  } catch {
    // JSON parse or read failed — return empty list with the command result
  } finally {
    cleanupTempJson(jsonOutputPath);
  }

  return { command, devices };
}

export async function resolveDevice(options: {
  deviceId?: string;
  deviceName?: string;
}): Promise<PhysicalDevice> {
  const { devices } = await listDevices();
  const connected = devices.filter((d) => d.state === 'connected');

  if (options.deviceId) {
    const match = connected.find((d) => d.udid === options.deviceId);
    if (!match) {
      const all = devices.find((d) => d.udid === options.deviceId);
      if (all) throw new Error(`Device ${options.deviceId} found but not connected (state: ${all.state}).`);
      throw new Error(`Device with UDID ${options.deviceId} not found.`);
    }
    return match;
  }

  if (options.deviceName) {
    const normalize = (s: string) =>
      s.trim().toLowerCase().replace(/[\u2018\u2019\u201A\u201B]/g, "'").replace(/[\u201C\u201D\u201E\u201F]/g, '"');
    const needle = normalize(options.deviceName);
    const match = connected.find(
      (d) => normalize(d.name) === needle,
    );
    if (!match) throw new Error(`Device "${options.deviceName}" not found among connected devices.`);
    return match;
  }

  if (connected.length === 0) {
    throw new Error(
      'No connected devices found. Connect a device via USB or Wi-Fi and ensure it is trusted.',
    );
  }

  return connected[0];
}

export async function installAppOnDevice(
  deviceId: string,
  appPath: string,
): Promise<CommandResult> {
  if (!existsSync(appPath)) {
    throw new Error(`App bundle not found: ${appPath}`);
  }

  return runCommand(
    'xcrun',
    ['devicectl', 'device', 'install', 'app', '--device', deviceId, appPath],
    { cwd: process.cwd(), timeoutSeconds: 300, maxOutput: 100_000 },
  );
}

export async function launchAppOnDevice(
  deviceId: string,
  bundleId: string,
  launchArgs: string[] = [],
  launchEnv: Record<string, string> = {},
): Promise<CommandResult> {
  const args = [
    'devicectl',
    'device',
    'process',
    'launch',
    '--device',
    deviceId,
  ];

  if (Object.keys(launchEnv).length > 0) {
    args.push('--environment-variables', JSON.stringify(launchEnv));
  }

  args.push(bundleId, ...launchArgs);

  return runCommand('xcrun', args, {
    cwd: process.cwd(),
    timeoutSeconds: 60,
    maxOutput: 100_000,
  });
}

export async function terminateAppOnDevice(
  deviceId: string,
  bundleId: string,
): Promise<CommandResult> {
  // First try to find PID via `devicectl device info apps`
  const appsJsonPath = makeTempJsonPath('apps');
  const appsResult = await runCommand(
    'xcrun',
    ['devicectl', 'device', 'info', 'apps', '--device', deviceId, '--json-output', appsJsonPath],
    { cwd: process.cwd(), timeoutSeconds: 30, maxOutput: 500_000 },
  );

  let executableName: string | undefined;
  try {
    const { readFileSync } = await import('node:fs');
    if (appsResult.exitCode === 0) {
      const raw = readFileSync(appsJsonPath, 'utf8');
      const parsed = JSON.parse(raw) as {
        result?: {
          apps?: Array<{
            bundleIdentifier?: string;
            url?: string;
            executableName?: string;
          }>;
        };
      };
      const app = parsed.result?.apps?.find(a => a.bundleIdentifier === bundleId);
      if (app) {
        executableName = app.executableName;
        if (!executableName && app.url) {
          const urlPath = decodeURIComponent(app.url.replace(/^file:\/\//, ''));
          const appDir = urlPath.split('/').filter(Boolean).pop();
          const appName = appDir?.replace(/\.app$/, '');
          if (appName) executableName = appName;
        }
      }
    }
    cleanupTempJson(appsJsonPath);
  } catch {
    cleanupTempJson(appsJsonPath);
  }

  // Now get process list and match
  const jsonPath = makeTempJsonPath('procs');
  const listResult = await runCommand(
    'xcrun',
    ['devicectl', 'device', 'info', 'processes', '--device', deviceId, '--json-output', jsonPath],
    { cwd: process.cwd(), timeoutSeconds: 30, maxOutput: 500_000 },
  );

  if (listResult.exitCode !== 0) {
    return listResult;
  }

  let pid: number | undefined;
  try {
    const { readFileSync } = await import('node:fs');
    const raw = readFileSync(jsonPath, 'utf8');
    cleanupTempJson(jsonPath);
    const parsed = JSON.parse(raw) as {
      result?: {
        runningProcesses?: Array<{
          processIdentifier?: number;
          executable?: string;
          bundleIdentifier?: string;
        }>;
      };
    };
    const procs = parsed.result?.runningProcesses || [];

    // Try bundleIdentifier first (works on some iOS versions)
    let proc = procs.find(p => p.bundleIdentifier === bundleId);

    // Fall back to matching executable URL against known executable name or bundle ID
    if (!proc) {
      const lastSegment = bundleId.split('.').pop()?.toLowerCase();
      proc = procs.find(p => {
        const exe = typeof p.executable === 'string' ? p.executable : '';
        // executable is a URL like "file:///path/to/App.app/AppName"
        const exeName = decodeURIComponent(exe.split('/').pop() || '').toLowerCase();
        if (executableName && exeName === executableName.toLowerCase()) return true;
        if (lastSegment && exeName === lastSegment) return true;
        return false;
      });
    }

    pid = proc?.processIdentifier;
  } catch {
    cleanupTempJson(jsonPath);
  }

  if (!pid) {
    return {
      command: 'devicectl device process terminate',
      args: [],
      output: `No running process found for bundle ID: ${bundleId}`,
      exitCode: 1,
      durationMs: 0,
      truncated: false,
      failureKind: 'nonzero-exit',
    };
  }

  return runCommand(
    'xcrun',
    ['devicectl', 'device', 'process', 'terminate', '--device', deviceId, '--pid', String(pid)],
    { cwd: process.cwd(), timeoutSeconds: 30, maxOutput: 50_000 },
  );
}

export async function uninstallAppOnDevice(
  deviceId: string,
  bundleId: string,
): Promise<CommandResult> {
  return runCommand(
    'xcrun',
    ['devicectl', 'device', 'uninstall', 'app', '--device', deviceId, bundleId],
    { cwd: process.cwd(), timeoutSeconds: 120, maxOutput: 100_000 },
  );
}

export async function listAppsOnDevice(
  deviceId: string,
): Promise<CommandResult> {
  return runCommand(
    'xcrun',
    ['devicectl', 'device', 'info', 'apps', '--device', deviceId],
    { cwd: process.cwd(), timeoutSeconds: 60, maxOutput: 500_000 },
  );
}

export async function screenshotDevice(
  deviceId: string,
  outputPath: string,
): Promise<CommandResult> {
  // Try pymobiledevice3 first — works with CoreDevice tunnel on macOS 15+ / iOS 17+
  const pymResult = await findPymobiledevice3();
  if (pymResult) {
    const result = await runCommand(
      pymResult,
      ['developer', 'dvt', 'screenshot', outputPath, '--udid', deviceId],
      { cwd: process.cwd(), timeoutSeconds: 30, maxOutput: 50_000 },
    );
    const { existsSync: fileExists } = await import('node:fs');
    if (result.exitCode === 0 && fileExists(outputPath)) return result;
  }

  // Try idevicescreenshot with network flag (needed for CoreDevice/network-connected devices)
  let result = await runCommand(
    'idevicescreenshot',
    ['-u', deviceId, '-n', outputPath],
    { cwd: process.cwd(), timeoutSeconds: 15, maxOutput: 50_000 },
  );

  // Fall back to USB-only mode
  if (result.exitCode !== 0) {
    result = await runCommand(
      'idevicescreenshot',
      ['-u', deviceId, outputPath],
      { cwd: process.cwd(), timeoutSeconds: 15, maxOutput: 50_000 },
    );
  }

  if (result.exitCode !== 0) {
    const hints: string[] = [];
    if (result.output.includes('No device found')) {
      hints.push(
        'idevicescreenshot could not find the device. On macOS 15+ with iOS 17+, ' +
        'network-connected devices require a tunnel that libimobiledevice cannot access. ' +
        'Connect the device via USB cable, or run `sudo pymobiledevice3 remote tunneld` in a separate terminal ' +
        'then retry (install: pip3 install pymobiledevice3).',
      );
    }
    if (result.output.includes('screenshotr')) {
      hints.push(
        'The Developer Disk Image may not be mounted. ' +
        'Open Xcode with the device connected to mount it automatically.',
      );
    }
    if (hints.length > 0) {
      result.output += '\n\nHint: ' + hints.join('\n');
    }
  }

  return result;
}

/** Keep at most this many chars of streamed device-log output (sliding tail). */
const DEVICE_LOG_MAX = 500_000;

interface DeviceLogCapture {
  child: ChildProcess;
  getCaptured: () => string;
  tool: 'pymobiledevice3' | 'idevicesyslog';
}

/**
 * Start streaming device logs. Tries pymobiledevice3 first (works on iOS 17+
 * via CoreDevice tunnel), then falls back to idevicesyslog for older devices.
 * Returns the spawned child + a getter for accumulated output so far.
 */
export async function startDeviceLogCapture(
  deviceId: string,
  processName?: string,
): Promise<DeviceLogCapture> {
  const pymPath = await findPymobiledevice3();
  if (pymPath) {
    const pymArgs = ['syslog', 'live', '--udid', deviceId];
    if (processName) pymArgs.push('--process-name', processName);
    const child = spawn(pymPath, pymArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

    let captured = '';
    let stderrBuf = '';
    const appendCapped = (text: string) => {
      captured += text;
      if (captured.length > DEVICE_LOG_MAX) captured = captured.slice(-DEVICE_LOG_MAX);
    };
    child.stdout?.on('data', (chunk: Buffer) => appendCapped(chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderrBuf += text;
      appendCapped(text);
    });

    // Wait briefly to detect fast failures (no tunneld, device not found, etc.)
    const earlyExit = await Promise.race([
      new Promise<number | null>((resolve) => child.on('exit', resolve)),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 1500)),
    ]);

    const hasError = stderrBuf.includes('ERROR') || stderrBuf.includes('error');
    if (earlyExit !== 'timeout' || hasError) {
      // pymobiledevice3 failed — kill if still alive and fall through
      if (earlyExit === 'timeout') child.kill('SIGTERM');
    } else {
      return { child, getCaptured: () => captured, tool: 'pymobiledevice3' };
    }
  }

  // Fallback: idevicesyslog (works on pre-iOS 17 or USB with legacy stack)
  const logArgs = ['-u', deviceId, '-n'];
  if (processName) logArgs.push('-p', processName);
  const child = spawn('idevicesyslog', logArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  let captured = '';
  const appendCapped = (text: string) => {
    captured += text;
    if (captured.length > DEVICE_LOG_MAX) captured = captured.slice(-DEVICE_LOG_MAX);
  };
  child.stdout?.on('data', (chunk: Buffer) => appendCapped(chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => appendCapped(chunk.toString()));

  return { child, getCaptured: () => captured, tool: 'idevicesyslog' };
}

let _pymobiledevice3Path: string | null | undefined;

export async function findPymobiledevice3(): Promise<string | null> {
  if (_pymobiledevice3Path !== undefined) return _pymobiledevice3Path;
  try {
    const result = await runCommand('which', ['pymobiledevice3'], { cwd: process.cwd(), timeoutSeconds: 5, maxOutput: 1000 });
    _pymobiledevice3Path = result.exitCode === 0 ? result.output.trim() : null;
  } catch {
    _pymobiledevice3Path = null;
  }
  return _pymobiledevice3Path;
}

export async function deviceInfo(
  deviceId: string,
): Promise<CommandResult> {
  return runCommand(
    'xcrun',
    ['devicectl', 'device', 'info', 'details', '--device', deviceId],
    { cwd: process.cwd(), timeoutSeconds: 30, maxOutput: 200_000 },
  );
}

export async function listDevicePairs(): Promise<CommandResult> {
  return runCommand(
    'xcrun',
    ['devicectl', 'list', 'devices'],
    { cwd: process.cwd(), timeoutSeconds: 30, maxOutput: 100_000 },
  );
}

export async function pairDevice(deviceId: string): Promise<CommandResult> {
  return runCommand(
    'xcrun',
    ['devicectl', 'manage', 'pair', '--device', deviceId],
    { cwd: process.cwd(), timeoutSeconds: 60, maxOutput: 50_000 },
  );
}

export async function unpairDevice(deviceId: string): Promise<CommandResult> {
  return runCommand(
    'xcrun',
    ['devicectl', 'manage', 'unpair', '--device', deviceId],
    { cwd: process.cwd(), timeoutSeconds: 30, maxOutput: 50_000 },
  );
}

export function formatDeviceError(output: string): string | undefined {
  const lower = output.toLowerCase();
  if (
    lower.includes('devicelocked')
    || lower.includes('imagemounterdevicelocked')
    || lower.includes('0xe80000e2')
    || lower.includes('12040')
  ) {
    return 'Device is locked. Unlock your iPhone and keep the screen on, then retry with bazel_ios_device_install_app.';
  }
  if (lower.includes('nottrusted') || (lower.includes('pairing') && lower.includes('required'))) {
    return 'Device does not trust this computer. Unlock the device, tap "Trust", then retry.';
  }
  if (lower.includes('developer mode') || lower.includes('developermode')) {
    return 'Enable Developer Mode on the device: Settings → Privacy & Security → Developer Mode.';
  }
  if (lower.includes('provisioning') || lower.includes('mobileprovision') || lower.includes('signing')) {
    return 'Code signing issue. Ensure a valid development certificate and provisioning profile are installed.';
  }
  return undefined;
}

export async function countSigningIdentities(): Promise<{ count: number; command: CommandResult }> {
  const command = await runCommand(
    'security',
    ['find-identity', '-v', '-p', 'codesigning'],
    { cwd: process.cwd(), timeoutSeconds: 15, maxOutput: 50_000 },
  );
  const match = command.output.match(/(\d+) valid identities found/);
  if (match) return { count: parseInt(match[1], 10), command };
  // Fallback for `security` phrasings without the summary line: count the
  // enumerated `  1) <hash> "<name>"` identity lines.
  const lineCount = (command.output.match(/^\s*\d+\)\s+[0-9A-F]{20,}/gim) || []).length;
  return { count: lineCount, command };
}

export { readBundleId };
