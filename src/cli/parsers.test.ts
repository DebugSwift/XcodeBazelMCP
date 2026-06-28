import { describe, it, expect } from 'vitest';
import {
  parseLaunch,
  parseDeviceLaunch,
  parseDeviceBuildAndRun,
  parseBuild,
  parseBuildAndRun,
  parseTest,
  parseQuery,
  parseDeps,
  parseSwipe,
  parseSimAppearance,
  parseSpmBuild,
  parseSpmTest,
  parseSpmRun,
  parsePrivacy,
  parseScaffold,
  parseDeviceTest,
  parseStatusBar,
  parseLldbAttach,
  parseLldbBreakpoint,
} from './parsers.js';

describe('parseLaunch', () => {
  it('parses bundleId positional', () => {
    expect(parseLaunch(['com.example.App'])).toEqual({ bundleId: 'com.example.App' });
  });

  it('supports --simulator-name (regression: previously ignored)', () => {
    expect(parseLaunch(['com.example.App', '--simulator-name', 'iPhone 16 Pro'])).toEqual({
      bundleId: 'com.example.App',
      simulatorName: 'iPhone 16 Pro',
    });
  });

  it('supports --simulator-id and --launch-arg', () => {
    expect(parseLaunch(['com.x', '--simulator-id', 'UDID', '--launch-arg', '-a', '--launch-arg', '-b'])).toEqual({
      bundleId: 'com.x',
      simulatorId: 'UDID',
      launchArgs: ['-a', '-b'],
    });
  });

  it('parses --launch-env KEY=VAL into launchEnv object', () => {
    expect(parseLaunch(['com.x', '--launch-env', 'FOO=bar', '--launch-env', 'BAZ=qux'])).toEqual({
      bundleId: 'com.x',
      launchEnv: { FOO: 'bar', BAZ: 'qux' },
    });
  });

  it('keeps "=" in launch-env values', () => {
    expect(parseLaunch(['com.x', '--launch-env', 'URL=a=b'])).toEqual({
      bundleId: 'com.x',
      launchEnv: { URL: 'a=b' },
    });
  });
});

describe('parseDeviceLaunch', () => {
  it('parses --launch-env for device parity', () => {
    expect(parseDeviceLaunch(['com.x', '--device-id', 'D1', '--launch-env', 'FOO=bar'])).toEqual({
      bundleId: 'com.x',
      deviceId: 'D1',
      launchEnv: { FOO: 'bar' },
    });
  });
});

describe('parseDeviceBuildAndRun', () => {
  it('forces device platform and parses launch-env', () => {
    expect(parseDeviceBuildAndRun(['//a', '--launch-env', 'A=1'])).toMatchObject({
      target: '//a',
      platform: 'device',
      launchEnv: { A: '1' },
    });
  });
});

describe('parseBuild', () => {
  it('defaults buildMode/platform to none', () => {
    expect(parseBuild(['//app:app'])).toEqual({ target: '//app:app', buildMode: 'none', platform: 'none' });
  });

  it('parses --release and --device', () => {
    const out = parseBuild(['//app:app', '--release', '--device']);
    expect(out.buildMode).toBe('release');
    expect(out.platform).toBe('device');
  });

  it('parses --stream into streaming flag', () => {
    expect(parseBuild(['//a', '--stream'])).toMatchObject({ streaming: true });
  });
});

describe('parseBuildAndRun', () => {
  it('defaults platform to simulator', () => {
    expect(parseBuildAndRun(['//app:app'])).toMatchObject({ platform: 'simulator', buildMode: 'none' });
  });

  it('collects repeated --config and --launch-arg', () => {
    const out = parseBuildAndRun(['//a', '--config', 'foo', '--config', 'bar', '--launch-arg', 'x']);
    expect(out.configs).toEqual(['foo', 'bar']);
    expect(out.launchArgs).toEqual(['x']);
  });
});

describe('parseTest', () => {
  it('parses filter and simulator flags', () => {
    expect(parseTest(['//t', '--filter', 'MyTest', '--minimize-simulator'])).toMatchObject({
      target: '//t',
      testFilter: 'MyTest',
      minimizeSimulator: true,
    });
  });
});

describe('parseQuery', () => {
  it('joins expression parts', () => {
    expect(parseQuery(['deps(//a)', '+', 'deps(//b)']).expression).toBe('deps(//a) + deps(//b)');
  });

  it('extracts --output without polluting expression', () => {
    const out = parseQuery(['kind(x,//...)', '--output', 'label']);
    expect(out.output).toBe('label');
    expect(out.expression).toBe('kind(x,//...)');
  });
});

describe('parseDeps', () => {
  it('parses --depth as number', () => {
    expect(parseDeps(['//a', '--depth', '3'])).toMatchObject({ target: '//a', depth: 3 });
  });
});

describe('parseSwipe', () => {
  it('reads positional direction', () => {
    expect(parseSwipe(['up'])).toMatchObject({ direction: 'up' });
  });

  it('explicit --direction overrides positional', () => {
    expect(parseSwipe(['up', '--direction', 'down'])).toMatchObject({ direction: 'down' });
  });
});

describe('parseSimAppearance', () => {
  it('reads positional dark/light', () => {
    expect(parseSimAppearance(['dark'])).toMatchObject({ appearance: 'dark' });
  });
  it('reads --appearance flag', () => {
    expect(parseSimAppearance(['--appearance', 'light'])).toMatchObject({ appearance: 'light' });
  });
});

describe('parseSpmBuild', () => {
  it('handles --release', () => {
    expect(parseSpmBuild(['--release'])).toMatchObject({ configuration: 'release' });
  });
  it('handles -c release', () => {
    expect(parseSpmBuild(['-c', 'release'])).toMatchObject({ configuration: 'release' });
  });
  it('handles -c debug (regression)', () => {
    expect(parseSpmBuild(['-c', 'debug'])).toMatchObject({ configuration: 'debug' });
  });
});

describe('parseSpmTest', () => {
  it('handles --release, -c release, and -c debug for parity with build', () => {
    expect(parseSpmTest(['--release'])).toMatchObject({ configuration: 'release' });
    expect(parseSpmTest(['-c', 'release'])).toMatchObject({ configuration: 'release' });
    expect(parseSpmTest(['-c', 'debug'])).toMatchObject({ configuration: 'debug' });
    expect(parseSpmTest(['--debug'])).toMatchObject({ configuration: 'debug' });
  });
  it('still parses --filter and --path', () => {
    expect(parseSpmTest(['--filter', 'MyTests', '--path', '/pkg'])).toMatchObject({
      filter: 'MyTests',
      packagePath: '/pkg',
    });
  });
});

describe('parseSpmRun', () => {
  it('reads the executable without mistaking -c values for it', () => {
    expect(parseSpmRun(['MyTool', '-c', 'release'])).toMatchObject({
      executable: 'MyTool',
      configuration: 'release',
    });
  });
  it('handles -c release with no executable', () => {
    expect(parseSpmRun(['-c', 'release'])).toMatchObject({ configuration: 'release' });
    expect(parseSpmRun(['-c', 'release']).executable).toBeUndefined();
  });
  it('forwards --run-arg and --stream', () => {
    expect(parseSpmRun(['MyTool', '--run-arg', '--verbose', '--stream'])).toMatchObject({
      executable: 'MyTool',
      runArgs: ['--verbose'],
      streaming: true,
    });
  });
});

describe('parsePrivacy', () => {
  it('reads positional action/service/bundleId', () => {
    expect(parsePrivacy(['grant', 'photos', 'com.x'])).toMatchObject({
      action: 'grant',
      service: 'photos',
      bundleId: 'com.x',
    });
  });
});

describe('parseScaffold', () => {
  it('defaults outputPath to name', () => {
    expect(parseScaffold(['ios_app', 'MyApp'])).toMatchObject({
      template: 'ios_app',
      name: 'MyApp',
      outputPath: 'MyApp',
    });
  });
  it('respects explicit -o', () => {
    expect(parseScaffold(['ios_app', 'MyApp', '-o', 'out'])).toMatchObject({ outputPath: 'out' });
  });
  it('parses --bazel-version', () => {
    expect(parseScaffold(['ios_app', 'MyApp', '--bazel-version', '8.0.0'])).toMatchObject({ bazelVersion: '8.0.0' });
  });
});

describe('parseDeviceTest', () => {
  it('parses --timeout as number', () => {
    expect(parseDeviceTest(['//t', '--timeout', '120'])).toMatchObject({ timeoutSeconds: 120 });
  });
});

describe('parseStatusBar', () => {
  it('parses --clear', () => {
    expect(parseStatusBar(['--clear'])).toMatchObject({ clear: true });
  });
  it('parses numeric battery level', () => {
    expect(parseStatusBar(['--battery-level', '80'])).toMatchObject({ batteryLevel: 80 });
  });
  it('parses --operator (carrier name)', () => {
    expect(parseStatusBar(['--operator', 'Carrier'])).toMatchObject({ operatorName: 'Carrier' });
  });
});

describe('parseLldbAttach', () => {
  it('treats bare number as pid', () => {
    expect(parseLldbAttach(['1234'])).toMatchObject({ pid: 1234 });
  });
  it('treats bare string as processName', () => {
    expect(parseLldbAttach(['MyApp'])).toMatchObject({ processName: 'MyApp' });
  });
  it('--device sets device target', () => {
    expect(parseLldbAttach(['MyApp', '--device'])).toMatchObject({ target: 'device' });
  });
});

describe('parseLldbBreakpoint', () => {
  it('parses set with file+line', () => {
    expect(parseLldbBreakpoint(['set', '--session', 's1', '--file', 'A.swift', '--line', '42'])).toMatchObject({
      action: 'set',
      sessionId: 's1',
      file: 'A.swift',
      line: 42,
    });
  });
});
