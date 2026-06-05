import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult } from '../types/index.js';

const mockRunCommand = vi.hoisted(() => vi.fn());
const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock('../utils/process.js', () => ({
  runCommand: mockRunCommand,
}));

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
  spawnSync: vi.fn(),
}));

class MockChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

let tempDir: string;

async function devices() {
  vi.resetModules();
  return import('./devices.js');
}

type DevicesModule = Awaited<ReturnType<typeof devices>>;
let countSigningIdentities: DevicesModule['countSigningIdentities'];
let deviceInfo: DevicesModule['deviceInfo'];
let findPymobiledevice3: DevicesModule['findPymobiledevice3'];
let formatDeviceError: DevicesModule['formatDeviceError'];
let installAppOnDevice: DevicesModule['installAppOnDevice'];
let launchAppOnDevice: DevicesModule['launchAppOnDevice'];
let listDevicePairs: DevicesModule['listDevicePairs'];
let listDevices: DevicesModule['listDevices'];
let pairDevice: DevicesModule['pairDevice'];
let resolveDevice: DevicesModule['resolveDevice'];
let screenshotDevice: DevicesModule['screenshotDevice'];
let startDeviceLogCapture: DevicesModule['startDeviceLogCapture'];
let terminateAppOnDevice: DevicesModule['terminateAppOnDevice'];
let unpairDevice: DevicesModule['unpairDevice'];

const mockSuccess: CommandResult = {
  command: 'xcrun',
  args: [],
  exitCode: 0,
  output: '',
  durationMs: 10,
  truncated: false,
};

beforeEach(async () => {
  tempDir = join(tmpdir(), `devices-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });
  vi.clearAllMocks();
  mockSpawn.mockImplementation(() => new MockChild());
  ({
    countSigningIdentities,
    deviceInfo,
    findPymobiledevice3,
    formatDeviceError,
    installAppOnDevice,
    launchAppOnDevice,
    listDevicePairs,
    listDevices,
    pairDevice,
    resolveDevice,
    screenshotDevice,
    startDeviceLogCapture,
    terminateAppOnDevice,
    unpairDevice,
  } = await devices());
});

afterEach(() => {
  vi.useRealTimers();
  if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
});

function writeJsonOutput(args: string[], body: unknown): void {
  const outIndex = args.indexOf('--json-output');
  if (outIndex >= 0) writeFileSync(args[outIndex + 1], JSON.stringify(body));
}

function mockDeviceList(): void {
  mockRunCommand.mockImplementation(async (_command: string, args: string[]) => {
    writeJsonOutput(args, {
      result: {
        devices: [
          {
            identifier: 'CORE-ABC',
            hardwareProperties: { udid: 'ABC-123', platform: 'iOS' },
            deviceProperties: { name: 'iPhone 15', osVersionNumber: '17.0' },
            connectionProperties: { transportType: 'usb', tunnelState: 'connected', pairingState: 'paired' },
            visibilityClass: 'default',
          },
          {
            identifier: 'CORE-DEF',
            hardwareProperties: { udid: 'DEF-456', platform: 'iOS' },
            deviceProperties: { name: 'iPad Pro', osVersionNumber: '17.0' },
            connectionProperties: { transportType: 'wifi', tunnelState: 'connected', pairingState: 'paired' },
            visibilityClass: 'default',
          },
        ],
      },
    });
    return mockSuccess;
  });
}

describe('listDevices', () => {
  it('parses device list from xcrun devicectl', async () => {
    mockDeviceList();

    const result = await listDevices();

    expect(mockRunCommand).toHaveBeenCalledWith('xcrun', ['devicectl', 'list', 'devices', '--json-output', expect.any(String)], expect.any(Object));
    expect(result.devices).toHaveLength(2);
    expect(result.devices[0]).toMatchObject({ udid: 'ABC-123', name: 'iPhone 15', connectionType: 'usb', state: 'connected' });
    expect(result.devices[1]).toMatchObject({ udid: 'DEF-456', name: 'iPad Pro', connectionType: 'wifi', state: 'connected' });
  });

  it('returns empty array on command failure', async () => {
    mockRunCommand.mockResolvedValue({ ...mockSuccess, exitCode: 1 });
    const result = await listDevices();
    expect(result.devices).toEqual([]);
  });

  it('returns empty array on JSON parse error', async () => {
    mockRunCommand.mockResolvedValue({ ...mockSuccess, output: 'not json' });
    const result = await listDevices();
    expect(result.devices).toEqual([]);
  });
});

describe('resolveDevice', () => {
  beforeEach(() => {
    mockDeviceList();
  });

  it('resolves by deviceId', async () => {
    const device = await resolveDevice({ deviceId: 'ABC-123' });
    expect(device.name).toBe('iPhone 15');
  });

  it('throws when deviceId not found', async () => {
    await expect(resolveDevice({ deviceId: 'UNKNOWN' })).rejects.toThrow('Device with UDID UNKNOWN not found');
  });

  it('resolves by deviceName', async () => {
    const device = await resolveDevice({ deviceName: 'iPad Pro' });
    expect(device.udid).toBe('DEF-456');
  });

  it('throws when deviceName not found', async () => {
    await expect(resolveDevice({ deviceName: 'Unknown Device' })).rejects.toThrow('Device "Unknown Device" not found');
  });

  it('returns first connected device when neither deviceId nor deviceName provided', async () => {
    const device = await resolveDevice({});
    expect(device.udid).toBe('ABC-123');
  });

  it('throws when no devices available', async () => {
    mockRunCommand.mockImplementation(async (_command: string, args: string[]) => {
      writeJsonOutput(args, { result: { devices: [] } });
      return mockSuccess;
    });
    await expect(resolveDevice({})).rejects.toThrow('No connected devices found');
  });
});

describe('installAppOnDevice', () => {
  it('calls xcrun devicectl device install app', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);
    const appPath = join(tempDir, 'App.app');
    mkdirSync(appPath);

    await installAppOnDevice('ABC-123', appPath);

    expect(mockRunCommand).toHaveBeenCalledWith('xcrun', ['devicectl', 'device', 'install', 'app', '--device', 'ABC-123', appPath], {
      cwd: process.cwd(),
      timeoutSeconds: 300,
      maxOutput: 100_000,
    });
  });
});

describe('launchAppOnDevice', () => {
  it('calls xcrun devicectl device process launch', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);

    await launchAppOnDevice('ABC-123', 'com.example.App');

    expect(mockRunCommand).toHaveBeenCalledWith('xcrun', ['devicectl', 'device', 'process', 'launch', '--device', 'ABC-123', 'com.example.App'], {
      cwd: process.cwd(),
      timeoutSeconds: 60,
      maxOutput: 100_000,
    });
  });
});

describe('terminateAppOnDevice', () => {
  it('lists processes and terminates matching bundle ID', async () => {
    mockRunCommand.mockImplementation(async (_command: string, args: string[]) => {
      if (args.includes('apps')) {
        writeJsonOutput(args, { result: { apps: [{ bundleIdentifier: 'com.example.App', executableName: 'MyApp' }] } });
      } else if (args.includes('processes')) {
        writeJsonOutput(args, {
          result: {
            runningProcesses: [
              { processIdentifier: 1234, executable: 'file:///private/var/containers/Bundle/Application/MyApp.app/MyApp' },
              { processIdentifier: 5678, bundleIdentifier: 'com.apple.mobilesafari' },
            ],
          },
        });
      }
      return mockSuccess;
    });

    await terminateAppOnDevice('ABC-123', 'com.example.App');

    expect(mockRunCommand).toHaveBeenNthCalledWith(1, 'xcrun', ['devicectl', 'device', 'info', 'apps', '--device', 'ABC-123', '--json-output', expect.any(String)], expect.any(Object));
    expect(mockRunCommand).toHaveBeenNthCalledWith(2, 'xcrun', ['devicectl', 'device', 'info', 'processes', '--device', 'ABC-123', '--json-output', expect.any(String)], expect.any(Object));
    expect(mockRunCommand).toHaveBeenNthCalledWith(3, 'xcrun', ['devicectl', 'device', 'process', 'terminate', '--device', 'ABC-123', '--pid', '1234'], expect.any(Object));
  });

  it('returns without terminating when app not running', async () => {
    mockRunCommand.mockImplementation(async (_command: string, args: string[]) => {
      if (args.includes('apps')) {
        writeJsonOutput(args, { result: { apps: [] } });
      } else if (args.includes('processes')) {
        writeJsonOutput(args, { result: { runningProcesses: [{ processIdentifier: 5678, bundleIdentifier: 'com.apple.mobilesafari' }] } });
      }
      return mockSuccess;
    });

    const result = await terminateAppOnDevice('ABC-123', 'com.example.NotRunning');

    expect(mockRunCommand).toHaveBeenCalledTimes(2);
    expect(result.output).toContain('No running process found');
  });
});

describe('screenshotDevice', () => {
  it('uses pymobiledevice3 when available', async () => {
    mockRunCommand.mockResolvedValueOnce({ ...mockSuccess, command: 'which', output: '/usr/local/bin/pymobiledevice3' });
    mockRunCommand.mockImplementationOnce(async () => ({ ...mockSuccess, command: 'which', output: '/usr/local/bin/pymobiledevice3' }));
    mockRunCommand.mockImplementationOnce(async (_command: string, args: string[]) => {
      writeFileSync(args[3], '');
      return mockSuccess;
    });

    const outputPath = join(tempDir, 'screenshot.png');
    await screenshotDevice('ABC-123', outputPath);

    expect(mockRunCommand).toHaveBeenCalledWith('which', ['pymobiledevice3'], expect.any(Object));
    expect(mockRunCommand).toHaveBeenCalledWith('/usr/local/bin/pymobiledevice3', ['developer', 'dvt', 'screenshot', outputPath, '--udid', 'ABC-123'], expect.any(Object));
  });

  it('falls back to idevicescreenshot when pymobiledevice3 not available', async () => {
    mockRunCommand.mockResolvedValueOnce({ ...mockSuccess, command: 'which', exitCode: 1 });
    mockRunCommand.mockResolvedValueOnce(mockSuccess);

    const outputPath = join(tempDir, 'screenshot.png');
    await screenshotDevice('ABC-123', outputPath);

    expect(mockRunCommand).toHaveBeenCalledWith('idevicescreenshot', ['-u', 'ABC-123', '-n', outputPath], expect.any(Object));
  });

  it('falls back to USB-only idevicescreenshot when network mode fails', async () => {
    mockRunCommand.mockResolvedValueOnce({ ...mockSuccess, command: 'which', exitCode: 1 });
    mockRunCommand.mockResolvedValueOnce({ ...mockSuccess, command: 'idevicescreenshot', exitCode: 1 });
    mockRunCommand.mockResolvedValueOnce({ ...mockSuccess, command: 'idevicescreenshot' });

    const outputPath = join(tempDir, 'screenshot.png');
    await screenshotDevice('ABC-123', outputPath);

    expect(mockRunCommand).toHaveBeenCalledWith('idevicescreenshot', ['-u', 'ABC-123', outputPath], expect.any(Object));
  });
});

describe('startDeviceLogCapture', () => {
  it('spawns pymobiledevice3 syslog when available', async () => {
    vi.useFakeTimers();
    mockRunCommand.mockResolvedValueOnce({ ...mockSuccess, command: 'which', output: '/usr/local/bin/pymobiledevice3' });

    const promise = startDeviceLogCapture('ABC-123');
    await vi.advanceTimersByTimeAsync(1500);
    const result = await promise;

    expect(result.child).toBeDefined();
    expect(result.tool).toBe('pymobiledevice3');
    expect(mockSpawn).toHaveBeenCalledWith('/usr/local/bin/pymobiledevice3', ['syslog', 'live', '--udid', 'ABC-123'], expect.any(Object));
    result.child.kill();
  });

  it('spawns idevicesyslog when pymobiledevice3 not available', async () => {
    mockRunCommand.mockResolvedValueOnce({ ...mockSuccess, command: 'which', exitCode: 1 });

    const result = await startDeviceLogCapture('ABC-123');

    expect(result.child).toBeDefined();
    expect(result.tool).toBe('idevicesyslog');
    expect(mockSpawn).toHaveBeenCalledWith('idevicesyslog', ['-u', 'ABC-123', '-n'], expect.any(Object));
    result.child.kill();
  });
});

describe('findPymobiledevice3', () => {
  it('finds pymobiledevice3 in PATH', async () => {
    mockRunCommand.mockResolvedValue({ ...mockSuccess, output: '/usr/local/bin/pymobiledevice3' });

    const path = await findPymobiledevice3();

    expect(path).toBe('/usr/local/bin/pymobiledevice3');
  });

  it('returns null when not found', async () => {
    mockRunCommand.mockResolvedValue({ ...mockSuccess, exitCode: 1 });

    const path = await findPymobiledevice3();

    expect(path).toBeNull();
  });
});

describe('deviceInfo', () => {
  it('calls xcrun devicectl device info', async () => {
    const infoOutput = JSON.stringify({
      result: {
        deviceProperties: { osVersionNumber: '17.0', name: 'iPhone 15' },
        hardwareProperties: { platform: 'iPhone', udid: 'ABC-123' },
      },
    });
    mockRunCommand.mockResolvedValue({ ...mockSuccess, output: infoOutput });

    const result = await deviceInfo('ABC-123');

    expect(mockRunCommand).toHaveBeenCalledWith('xcrun', ['devicectl', 'device', 'info', 'details', '--device', 'ABC-123'], expect.any(Object));
    expect(result.output).toBe(infoOutput);
  });

  it('returns undefined info on command failure', async () => {
    mockRunCommand.mockResolvedValue({ ...mockSuccess, exitCode: 1 });

    const result = await deviceInfo('ABC-123');

    expect(result.exitCode).toBe(1);
  });
});

describe('listDevicePairs', () => {
  it('calls xcrun devicectl list devices', async () => {
    mockRunCommand.mockResolvedValueOnce({ ...mockSuccess, output: 'devices' });

    await listDevicePairs();

    expect(mockRunCommand).toHaveBeenCalledWith('xcrun', ['devicectl', 'list', 'devices'], expect.any(Object));
  });
});

describe('pairDevice', () => {
  it('calls xcrun devicectl manage pair', async () => {
    mockRunCommand.mockResolvedValueOnce(mockSuccess);

    await pairDevice('ABC-123');

    expect(mockRunCommand).toHaveBeenCalledWith('xcrun', ['devicectl', 'manage', 'pair', '--device', 'ABC-123'], expect.any(Object));
  });
});

describe('unpairDevice', () => {
  it('calls xcrun devicectl manage unpair', async () => {
    mockRunCommand.mockResolvedValueOnce(mockSuccess);

    await unpairDevice('ABC-123');

    expect(mockRunCommand).toHaveBeenCalledWith('xcrun', ['devicectl', 'manage', 'unpair', '--device', 'ABC-123'], expect.any(Object));
  });
});

describe('formatDeviceError', () => {
  it('maps locked device errors', () => {
    expect(formatDeviceError('kAMDMobileImageMounterDeviceLocked')).toMatch(/locked/i);
    expect(formatDeviceError('CoreDeviceError 12040')).toMatch(/locked/i);
  });

  it('returns undefined for unknown errors', () => {
    expect(formatDeviceError('something else entirely')).toBeUndefined();
  });
});

describe('countSigningIdentities', () => {
  it('parses valid identity count from security output', async () => {
    mockRunCommand.mockResolvedValueOnce({
      ...mockSuccess,
      output: '  1) ABC "Apple Development: Me"\n  2 valid identities found\n',
    });

    const result = await countSigningIdentities();

    expect(result.count).toBe(2);
    expect(mockRunCommand).toHaveBeenCalledWith('security', ['find-identity', '-v', '-p', 'codesigning'], expect.any(Object));
  });
});
