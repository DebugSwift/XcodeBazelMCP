import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult } from '../types/index.js';
import { runCommand } from '../utils/process.js';
import {
  assertLogFilter,
  buildLogPredicate,
  bootSimulator,
  bootSimulatorIfNeeded,
  clearStatusBar,
  deleteSimulator,
  eraseSimulator,
  findAppBundle,
  getSimulatorUiState,
  installApp,
  launchApp,
  listSimulators,
  openSimulatorApp,
  openUrl,
  readBundleId,
  readInfoPlistValue,
  resolveSimulator,
  runtimeVersion,
  sendPushNotification,
  setPrivacy,
  setSimulatorAppearance,
  setSimulatorLocation,
  setStatusBar,
  shutdownAllSimulators,
  shutdownSimulator,
  startVideoRecording,
  takeScreenshot,
  terminateApp,
} from './simulators.js';

vi.mock('../utils/process.js', () => ({
  runCommand: vi.fn(),
}));

const mockRunCommand = vi.mocked(runCommand);

const fixtureDir = join(import.meta.dirname, '..', '..', '.test-fixtures');
const fakeWorkspace = join(fixtureDir, 'workspace');
const bazelBin = join(fakeWorkspace, 'bazel-bin');

beforeAll(() => {
  mkdirSync(join(bazelBin, 'BazelApp.app'), { recursive: true });
  writeFileSync(
    join(bazelBin, 'BazelApp.app', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.example.BazelApp</string>
</dict>
</plist>`,
  );

  mkdirSync(join(bazelBin, 'Apps', 'MyApp', 'MyApp.app'), { recursive: true });
  writeFileSync(
    join(bazelBin, 'Apps', 'MyApp', 'MyApp.app', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.example.MyApp</string>
</dict>
</plist>`,
  );

  // macOS layout: Info.plist lives under Contents/
  mkdirSync(join(bazelBin, 'mac', 'MacApp.app', 'Contents'), { recursive: true });
  writeFileSync(
    join(bazelBin, 'mac', 'MacApp.app', 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.example.MacApp</string>
  <key>CFBundleExecutable</key>
  <string>MacApp</string>
</dict>
</plist>`,
  );

  mkdirSync(join(bazelBin, 'app', 'app_archive-root', 'Payload', 'SwiftUIApp.app'), { recursive: true });
  writeFileSync(
    join(bazelBin, 'app', 'app_archive-root', 'Payload', 'SwiftUIApp.app', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.example.SwiftUIApp</string>
</dict>
</plist>`,
  );
});

afterAll(() => {
  if (existsSync(fixtureDir)) {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  vi.clearAllMocks();
});

const mockSuccess: CommandResult = {
  command: 'xcrun',
  args: [],
  exitCode: 0,
  output: '',
  durationMs: 10,
  truncated: false,
};

describe('assertLogFilter / buildLogPredicate', () => {
  it('accepts dotted identifiers', () => {
    expect(assertLogFilter('com.example.MyApp', 'subsystem')).toBe('com.example.MyApp');
    expect(assertLogFilter('MyApp', 'processName')).toBe('MyApp');
  });

  it('rejects values with quotes, spaces, or predicate operators (security)', () => {
    expect(() => assertLogFilter('com.x" OR 1==1', 'subsystem')).toThrow('Invalid subsystem');
    expect(() => assertLogFilter('My App', 'processName')).toThrow('Invalid processName');
    expect(() => assertLogFilter('*', 'subsystem')).toThrow('Invalid subsystem');
    expect(() => assertLogFilter('', 'processName')).toThrow('Invalid processName');
  });

  it('builds an AND predicate from both filters', () => {
    expect(buildLogPredicate({ processName: 'MyApp', subsystem: 'com.example.MyApp' })).toBe(
      'process == "MyApp" AND subsystem == "com.example.MyApp"',
    );
  });

  it('returns undefined with no filters', () => {
    expect(buildLogPredicate({})).toBeUndefined();
  });

  it('rejects an injection attempt in buildLogPredicate', () => {
    expect(() => buildLogPredicate({ subsystem: 'a" OR process == "b' })).toThrow('Invalid subsystem');
  });
});

describe('findAppBundle', () => {
  it('finds an app at the root of bazel-bin for //:Target', () => {
    const result = findAppBundle(fakeWorkspace, '//:BazelApp');
    expect(result).toBe(join(bazelBin, 'BazelApp.app'));
  });

  it('finds an app in a package subdirectory for //Apps/MyApp:MyApp', () => {
    const result = findAppBundle(fakeWorkspace, '//Apps/MyApp:MyApp');
    expect(result).toBe(join(bazelBin, 'Apps', 'MyApp', 'MyApp.app'));
  });

  it('returns null for a target with no .app output', () => {
    const result = findAppBundle(fakeWorkspace, '//:NonExistent');
    expect(result).toBeNull();
  });

  it('returns null when bazel-bin does not exist', () => {
    const result = findAppBundle('/tmp/no-such-workspace', '//:Anything');
    expect(result).toBeNull();
  });

  it('returns null for malformed labels', () => {
    const result = findAppBundle(fakeWorkspace, 'not-a-label');
    expect(result).toBeNull();
  });

  it('finds an app inside _archive-root/Payload/ (rules_apple layout)', () => {
    const result = findAppBundle(fakeWorkspace, '//app:app');
    expect(result).toBe(join(bazelBin, 'app', 'app_archive-root', 'Payload', 'SwiftUIApp.app'));
  });
});

describe('readBundleId', () => {
  it('reads CFBundleIdentifier from an Info.plist', () => {
    const appPath = join(bazelBin, 'BazelApp.app');
    expect(readBundleId(appPath)).toBe('com.example.BazelApp');
  });

  it('reads bundle ID from a nested package app', () => {
    const appPath = join(bazelBin, 'Apps', 'MyApp', 'MyApp.app');
    expect(readBundleId(appPath)).toBe('com.example.MyApp');
  });

  it('reads CFBundleIdentifier from a macOS Contents/Info.plist layout (regression)', () => {
    const appPath = join(bazelBin, 'mac', 'MacApp.app');
    expect(readBundleId(appPath)).toBe('com.example.MacApp');
  });

  it('reads arbitrary Info.plist keys via readInfoPlistValue', () => {
    const appPath = join(bazelBin, 'mac', 'MacApp.app');
    expect(readInfoPlistValue(appPath, 'CFBundleExecutable')).toBe('MacApp');
    expect(readInfoPlistValue(appPath, 'NoSuchKey')).toBeUndefined();
  });

  it('throws when Info.plist is missing', () => {
    expect(() => readBundleId('/tmp/no-such-app.app')).toThrow('Info.plist not found');
  });
});

describe('runtimeVersion', () => {
  it('parses iOS runtime ids into comparable numbers', () => {
    expect(runtimeVersion('com.apple.CoreSimulator.SimRuntime.iOS-26-3')).toBeGreaterThan(
      runtimeVersion('com.apple.CoreSimulator.SimRuntime.iOS-17-5'),
    );
    expect(runtimeVersion('garbage')).toBe(0);
  });
});

describe('listSimulators', () => {
  it('parses available simulators from xcrun simctl list', async () => {
    const jsonOutput = JSON.stringify({
      devices: {
        'iOS 17.0': [
          { name: 'iPhone 15', udid: 'ABC-123', state: 'Booted', isAvailable: true },
          { name: 'iPhone 14', udid: 'DEF-456', state: 'Shutdown', isAvailable: true },
        ],
      },
    });
    mockRunCommand.mockResolvedValue({ ...mockSuccess, output: jsonOutput });

    const result = await listSimulators();

    expect(mockRunCommand).toHaveBeenCalledWith('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], {
      cwd: process.cwd(),
      timeoutSeconds: 30,
      maxOutput: 200_000,
    });
    expect(result.devices).toHaveLength(2);
    expect(result.devices[0]).toMatchObject({ name: 'iPhone 15', udid: 'ABC-123', runtime: 'iOS 17.0', state: 'Booted' });
  });

  it('filters to only booted simulators when onlyBooted=true', async () => {
    const jsonOutput = JSON.stringify({
      devices: {
        'iOS 17.0': [
          { name: 'iPhone 15', udid: 'ABC-123', state: 'Booted', isAvailable: true },
          { name: 'iPhone 14', udid: 'DEF-456', state: 'Shutdown', isAvailable: true },
        ],
      },
    });
    mockRunCommand.mockResolvedValue({ ...mockSuccess, output: jsonOutput });

    const result = await listSimulators(true);

    expect(result.devices).toHaveLength(1);
    expect(result.devices[0].name).toBe('iPhone 15');
  });

  it('prefers stdout over combined output so stderr noise cannot break parsing (regression)', async () => {
    const jsonOutput = JSON.stringify({
      devices: { 'iOS 17.0': [{ name: 'iPhone 15', udid: 'ABC-123', state: 'Booted', isAvailable: true }] },
    });
    mockRunCommand.mockResolvedValue({
      ...mockSuccess,
      stdout: jsonOutput,
      output: `WARNING: deprecated runtime\n${jsonOutput}`,
    });

    const result = await listSimulators();

    expect(result.devices).toHaveLength(1);
    expect(result.devices[0].udid).toBe('ABC-123');
  });

  it('returns empty array on parse error', async () => {
    mockRunCommand.mockResolvedValue({ ...mockSuccess, output: 'not json' });
    const result = await listSimulators();
    expect(result.devices).toEqual([]);
  });
});

describe('resolveSimulator', () => {
  const devices = [
    { name: 'iPhone 15', udid: 'ABC-123', runtime: 'iOS 17.0', state: 'Booted', isAvailable: true },
    { name: 'iPhone 14', udid: 'DEF-456', runtime: 'iOS 17.0', state: 'Shutdown', isAvailable: true },
    { name: 'iPad Pro', udid: 'GHI-789', runtime: 'iOS 17.0', state: 'Booted', isAvailable: true },
  ];

  beforeEach(() => {
    mockRunCommand.mockResolvedValue({
      ...mockSuccess,
      output: JSON.stringify({ devices: { 'iOS 17.0': devices } }),
    });
  });

  it('resolves by simulatorId', async () => {
    const result = await resolveSimulator({ simulatorId: 'ABC-123' });
    expect(result.device.name).toBe('iPhone 15');
  });

  it('throws when simulatorId not found', async () => {
    await expect(resolveSimulator({ simulatorId: 'UNKNOWN' })).rejects.toThrow('Simulator with UDID UNKNOWN not found');
  });

  it('resolves by simulatorName (case insensitive)', async () => {
    const result = await resolveSimulator({ simulatorName: 'iphone 15' });
    expect(result.device.udid).toBe('ABC-123');
  });

  it('throws when simulatorName not found', async () => {
    await expect(resolveSimulator({ simulatorName: 'Unknown' })).rejects.toThrow('Simulator "Unknown" not found');
  });

  it('returns first booted device with warning when multiple booted', async () => {
    const result = await resolveSimulator({});
    expect(result.device.name).toBe('iPhone 15');
    expect(result.warning).toContain('Multiple simulators booted');
    expect(result.warning).toContain('iPad Pro');
  });

  it('returns single booted device without warning', async () => {
    mockRunCommand.mockResolvedValue({
      ...mockSuccess,
      output: JSON.stringify({ devices: { 'iOS 17.0': [devices[0], devices[1]] } }),
    });
    const result = await resolveSimulator({});
    expect(result.device.name).toBe('iPhone 15');
    expect(result.warning).toBeUndefined();
  });

  it('falls back to first iPhone when none booted', async () => {
    mockRunCommand.mockResolvedValue({
      ...mockSuccess,
      output: JSON.stringify({
        devices: { 'iOS 17.0': [{ ...devices[1], state: 'Shutdown' }, { ...devices[2], state: 'Shutdown' }] },
      }),
    });
    const result = await resolveSimulator({});
    expect(result.device.name).toBe('iPhone 14');
  });

  it('prefers the iPhone on the newest runtime when none booted', async () => {
    mockRunCommand.mockResolvedValue({
      ...mockSuccess,
      output: JSON.stringify({
        devices: {
          'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [
            { name: 'iPhone 15', udid: 'OLD', state: 'Shutdown', isAvailable: true },
          ],
          'com.apple.CoreSimulator.SimRuntime.iOS-26-3': [
            { name: 'iPhone 16', udid: 'NEW', state: 'Shutdown', isAvailable: true },
          ],
        },
      }),
    });
    const result = await resolveSimulator({});
    expect(result.device.udid).toBe('NEW');
  });

  it('returns first available device when no iPhones', async () => {
    mockRunCommand.mockResolvedValue({
      ...mockSuccess,
      output: JSON.stringify({
        devices: { 'iOS 17.0': [{ ...devices[2], state: 'Shutdown' }] },
      }),
    });
    const result = await resolveSimulator({});
    expect(result.device.name).toBe('iPad Pro');
  });

  it('throws when no simulators available', async () => {
    mockRunCommand.mockResolvedValue({ ...mockSuccess, output: JSON.stringify({ devices: {} }) });
    await expect(resolveSimulator({})).rejects.toThrow('No simulators available');
  });
});

describe('bootSimulatorIfNeeded', () => {
  it('returns null if device already booted', async () => {
    const device = { name: 'iPhone 15', udid: 'ABC-123', runtime: 'iOS 17.0', state: 'Booted', isAvailable: true };
    const result = await bootSimulatorIfNeeded(device);
    expect(result).toBeNull();
    expect(mockRunCommand).not.toHaveBeenCalled();
  });

  it('boots the device if not booted', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);
    const device = { name: 'iPhone 15', udid: 'ABC-123', runtime: 'iOS 17.0', state: 'Shutdown', isAvailable: true };
    await bootSimulatorIfNeeded(device);
    expect(mockRunCommand).toHaveBeenCalledWith('xcrun', ['simctl', 'boot', 'ABC-123'], {
      cwd: process.cwd(),
      timeoutSeconds: 60,
      maxOutput: 50_000,
    });
  });
});

describe('installApp', () => {
  it('calls xcrun simctl install', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);
    await installApp('ABC-123', join(bazelBin, 'BazelApp.app'));
    expect(mockRunCommand).toHaveBeenCalledWith('xcrun', ['simctl', 'install', 'ABC-123', join(bazelBin, 'BazelApp.app')], {
      cwd: process.cwd(),
      timeoutSeconds: 120,
      maxOutput: 50_000,
    });
  });

  it('throws when app bundle does not exist', async () => {
    await expect(installApp('ABC-123', '/nonexistent.app')).rejects.toThrow('App bundle not found');
  });
});

describe('launchApp', () => {
  it('calls xcrun simctl launch with bundle ID', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);
    await launchApp('ABC-123', 'com.example.App');
    expect(mockRunCommand).toHaveBeenCalledWith('xcrun', ['simctl', 'launch', 'ABC-123', 'com.example.App'], {
      cwd: process.cwd(),
      timeoutSeconds: 30,
      maxOutput: 50_000,
      env: expect.any(Object),
    });
  });

  it('passes launch args', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);
    await launchApp('ABC-123', 'com.example.App', ['--arg1', 'value1']);
    expect(mockRunCommand).toHaveBeenCalledWith('xcrun', ['simctl', 'launch', 'ABC-123', 'com.example.App', '--arg1', 'value1'], {
      cwd: process.cwd(),
      timeoutSeconds: 30,
      maxOutput: 50_000,
      env: expect.any(Object),
    });
  });

  it('passes launch env vars with SIMCTL_CHILD_ prefix', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);
    await launchApp('ABC-123', 'com.example.App', [], { MY_VAR: 'value' });
    expect(mockRunCommand).toHaveBeenCalledWith(
      'xcrun',
      ['simctl', 'launch', 'ABC-123', 'com.example.App'],
      expect.objectContaining({
        env: expect.objectContaining({ SIMCTL_CHILD_MY_VAR: 'value' }),
      }),
    );
  });
});

describe('bootSimulator', () => {
  it('calls xcrun simctl boot', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);
    await bootSimulator('ABC-123');
    expect(mockRunCommand).toHaveBeenCalledWith('xcrun', ['simctl', 'boot', 'ABC-123'], {
      cwd: process.cwd(),
      timeoutSeconds: 60,
      maxOutput: 50_000,
    });
  });
});

describe('shutdownSimulator', () => {
  it('calls xcrun simctl shutdown', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);
    await shutdownSimulator('ABC-123');
    expect(mockRunCommand).toHaveBeenCalledWith('xcrun', ['simctl', 'shutdown', 'ABC-123'], {
      cwd: process.cwd(),
      timeoutSeconds: 30,
      maxOutput: 50_000,
    });
  });
});

describe('shutdownAllSimulators', () => {
  it('calls xcrun simctl shutdown all', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);
    await shutdownAllSimulators();
    expect(mockRunCommand).toHaveBeenCalledWith('xcrun', ['simctl', 'shutdown', 'all'], {
      cwd: process.cwd(),
      timeoutSeconds: 60,
      maxOutput: 50_000,
    });
  });
});

describe('deleteSimulator', () => {
  it('calls xcrun simctl delete', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);
    await deleteSimulator('ABC-123');
    expect(mockRunCommand).toHaveBeenCalledWith('xcrun', ['simctl', 'delete', 'ABC-123'], {
      cwd: process.cwd(),
      timeoutSeconds: 30,
      maxOutput: 50_000,
    });
  });
});

describe('eraseSimulator', () => {
  it('calls xcrun simctl erase', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);
    await eraseSimulator('ABC-123');
    expect(mockRunCommand).toHaveBeenCalledWith('xcrun', ['simctl', 'erase', 'ABC-123'], {
      cwd: process.cwd(),
      timeoutSeconds: 60,
      maxOutput: 50_000,
    });
  });
});

describe('setSimulatorLocation', () => {
  it('calls xcrun simctl location set', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);
    await setSimulatorLocation('ABC-123', 37.7749, -122.4194);
    expect(mockRunCommand).toHaveBeenCalledWith('xcrun', ['simctl', 'location', 'ABC-123', 'set', '37.7749,-122.4194'], {
      cwd: process.cwd(),
      timeoutSeconds: 10,
      maxOutput: 50_000,
    });
  });
});

describe('setSimulatorAppearance', () => {
  it('calls xcrun simctl ui appearance', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);
    await setSimulatorAppearance('ABC-123', 'dark');
    expect(mockRunCommand).toHaveBeenCalledWith('xcrun', ['simctl', 'ui', 'ABC-123', 'appearance', 'dark'], {
      cwd: process.cwd(),
      timeoutSeconds: 10,
      maxOutput: 50_000,
    });
  });
});

describe('openSimulatorApp', () => {
  it('calls open Simulator.app without udid', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);
    await openSimulatorApp();
    expect(mockRunCommand).toHaveBeenCalledWith('open', ['-a', 'Simulator'], {
      cwd: process.cwd(),
      timeoutSeconds: 10,
      maxOutput: 50_000,
    });
  });

  it('calls open Simulator.app with udid', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);
    await openSimulatorApp('ABC-123');
    expect(mockRunCommand).toHaveBeenCalledWith('open', ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', 'ABC-123'], {
      cwd: process.cwd(),
      timeoutSeconds: 10,
      maxOutput: 50_000,
    });
  });
});

describe('terminateApp', () => {
  it('calls xcrun simctl terminate', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);
    await terminateApp('ABC-123', 'com.example.App');
    expect(mockRunCommand).toHaveBeenCalledWith('xcrun', ['simctl', 'terminate', 'ABC-123', 'com.example.App'], {
      cwd: process.cwd(),
      timeoutSeconds: 10,
      maxOutput: 50_000,
    });
  });
});

describe('takeScreenshot', () => {
  it('calls xcrun simctl io screenshot', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);
    await takeScreenshot('ABC-123', '/tmp/screenshot.png');
    expect(mockRunCommand).toHaveBeenCalledWith('xcrun', ['simctl', 'io', 'ABC-123', 'screenshot', '--mask', 'ignored', '/tmp/screenshot.png'], {
      cwd: process.cwd(),
      timeoutSeconds: 15,
      maxOutput: 50_000,
    });
  });

  it('passes mask parameter', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);
    await takeScreenshot('ABC-123', '/tmp/screenshot.png', 'alpha');
    expect(mockRunCommand).toHaveBeenCalledWith('xcrun', ['simctl', 'io', 'ABC-123', 'screenshot', '--mask', 'alpha', '/tmp/screenshot.png'], {
      cwd: process.cwd(),
      timeoutSeconds: 15,
      maxOutput: 50_000,
    });
  });
});

describe('startVideoRecording', () => {
  it('spawns xcrun simctl recordVideo', async () => {
    const child = await startVideoRecording('ABC-123', '/tmp/video.mp4');
    expect(child).toBeDefined();
    child.kill();
  });
});

describe('setStatusBar', () => {
  it('calls xcrun simctl status_bar override', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);
    await setStatusBar('ABC-123', { time: '9:41', battery: '100' });
    expect(mockRunCommand).toHaveBeenCalledWith('xcrun', ['simctl', 'status_bar', 'ABC-123', 'override', '--time', '9:41', '--battery', '100'], {
      cwd: process.cwd(),
      timeoutSeconds: 10,
      maxOutput: 50_000,
    });
  });
});

describe('clearStatusBar', () => {
  it('calls xcrun simctl status_bar clear', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);
    await clearStatusBar('ABC-123');
    expect(mockRunCommand).toHaveBeenCalledWith('xcrun', ['simctl', 'status_bar', 'ABC-123', 'clear'], {
      cwd: process.cwd(),
      timeoutSeconds: 10,
      maxOutput: 50_000,
    });
  });
});

describe('setPrivacy', () => {
  it('calls xcrun simctl privacy', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);
    await setPrivacy('ABC-123', 'grant', 'location', 'com.example.App');
    expect(mockRunCommand).toHaveBeenCalledWith('xcrun', ['simctl', 'privacy', 'ABC-123', 'grant', 'location', 'com.example.App'], {
      cwd: process.cwd(),
      timeoutSeconds: 10,
      maxOutput: 50_000,
    });
  });

  it('omits bundleId when not provided', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);
    await setPrivacy('ABC-123', 'reset', 'all');
    expect(mockRunCommand).toHaveBeenCalledWith('xcrun', ['simctl', 'privacy', 'ABC-123', 'reset', 'all'], {
      cwd: process.cwd(),
      timeoutSeconds: 10,
      maxOutput: 50_000,
    });
  });
});

describe('sendPushNotification', () => {
  it('calls xcrun simctl push', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);
    await sendPushNotification('ABC-123', 'com.example.App', '/tmp/payload.json');
    expect(mockRunCommand).toHaveBeenCalledWith('xcrun', ['simctl', 'push', 'ABC-123', 'com.example.App', '/tmp/payload.json'], {
      cwd: process.cwd(),
      timeoutSeconds: 10,
      maxOutput: 50_000,
    });
  });
});

describe('openUrl', () => {
  it('calls xcrun simctl openurl', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);
    await openUrl('ABC-123', 'https://example.com');
    expect(mockRunCommand).toHaveBeenCalledWith('xcrun', ['simctl', 'openurl', 'ABC-123', 'https://example.com'], {
      cwd: process.cwd(),
      timeoutSeconds: 10,
      maxOutput: 50_000,
    });
  });
});

describe('getSimulatorUiState', () => {
  it('calls xcrun simctl ui for appearance and increaseContrast', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);
    await getSimulatorUiState('ABC-123');
    expect(mockRunCommand).toHaveBeenCalledTimes(2);
    expect(mockRunCommand).toHaveBeenNthCalledWith(1, 'xcrun', ['simctl', 'ui', 'ABC-123', 'appearance'], {
      cwd: process.cwd(),
      timeoutSeconds: 10,
      maxOutput: 50_000,
    });
    expect(mockRunCommand).toHaveBeenNthCalledWith(2, 'xcrun', ['simctl', 'ui', 'ABC-123', 'increase_contrast'], {
      cwd: process.cwd(),
      timeoutSeconds: 10,
      maxOutput: 50_000,
    });
  });
});
