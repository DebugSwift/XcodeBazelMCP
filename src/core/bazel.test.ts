import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult } from '../types/index.js';
import { runCommand, runCommandStreaming } from '../utils/process.js';
import {
  asStringArray,
  buildCommandArgs,
  configArgs,
  discoverExpression,
  defaultDiscoverScope,
  iosSimulatorCpu,
  iosSimulatorCpuArg,
  modeArgs,
  parseTargetLabels,
  platformArgs,
  requireLabel,
  sanitizeQueryExpression,
  simulatorArgs,
  testFilterArgs,
  tokenizeArgs,
  runBazel,
  runBazelStreaming,
  getLastCommand,
} from './bazel.js';
import {
  parseConfigYaml,
  activateProfile,
  setEnabledWorkflows,
  getEnabledWorkflows,
  setWorkspace,
  clearDefaults,
} from '../runtime/config.js';

vi.mock('../utils/process.js', () => ({
  runCommand: vi.fn(),
  runCommandStreaming: vi.fn(),
}));

vi.mock('./workspace.js', () => ({
  assertBazelWorkspace: vi.fn(),
}));

const mockRunCommand = vi.mocked(runCommand);
const mockRunCommandStreaming = vi.mocked(runCommandStreaming);

describe('parseTargetLabels', () => {
  it('keeps only label-like lines and drops bazel noise', () => {
    const output = [
      'INFO: Invocation ID: abc',
      'Loading: 0 packages loaded',
      'DEBUG: /Users/x/foo.bzl:34:18: unknown handled dep @swiftpkg_foo//:Bar',
      'WARNING: something happened',
      '//Apps/Consumer/ConsumerApp:DoorDash',
      '//Apps/Consumer/ConsumerApp:Caviar',
      '@rules_swift//swift:foo',
      '',
    ].join('\n');
    expect(parseTargetLabels(output)).toEqual([
      '//Apps/Consumer/ConsumerApp:Caviar',
      '//Apps/Consumer/ConsumerApp:DoorDash',
      '@rules_swift//swift:foo',
    ]);
  });

  it('dedupes and sorts labels', () => {
    expect(parseTargetLabels('//b:b\n//a:a\n//b:b\n')).toEqual(['//a:a', '//b:b']);
  });

  it('returns empty array for no labels', () => {
    expect(parseTargetLabels('INFO: Empty results\nLoading: 0 packages loaded')).toEqual([]);
  });
});

let tempDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  tempDir = join(tmpdir(), `bazel-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });
  writeFileSync(join(tempDir, 'WORKSPACE'), '');
  setWorkspace(tempDir);
});

afterEach(() => {
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

const mockSuccess: CommandResult = {
  command: 'bazel',
  args: [],
  exitCode: 0,
  output: '',
  durationMs: 10,
  truncated: false,
};

describe('Bazel argument helpers', () => {
  it('accepts normal Bazel labels and package patterns', () => {
    expect(requireLabel('//:MyApp')).toBe('//:MyApp');
    expect(requireLabel('//Apps/SampleApp/...')).toBe('//Apps/SampleApp/...');
    expect(requireLabel('@some_repo//pkg/subpkg:Target.name')).toBe('@some_repo//pkg/subpkg:Target.name');
    expect(requireLabel('@rules_swift~override//swift:swift')).toBe('@rules_swift~override//swift:swift');
    expect(requireLabel('@@rules_foo//pkg:target')).toBe('@@rules_foo//pkg:target');
    expect(requireLabel('@//pkg:target')).toBe('@//pkg:target');
    expect(requireLabel('//my-pkg:my-target')).toBe('//my-pkg:my-target');
  });

  it('rejects missing or shell-like target values', () => {
    expect(() => requireLabel(undefined)).toThrow('target is required');
    expect(() => requireLabel('//Apps/Foo:Bar; rm -rf /')).toThrow('must be a Bazel label');
    expect(() => requireLabel('Apps/Foo:Bar')).toThrow('must be a Bazel label');
  });

  it('validates string arrays used for Bazel args', () => {
    expect(asStringArray(undefined, 'extraArgs')).toEqual([]);
    expect(asStringArray(['--nobuild'], 'extraArgs')).toEqual(['--nobuild']);
    expect(() => asStringArray(['--nobuild', 1], 'extraArgs')).toThrow(
      'extraArgs must be an array of strings.',
    );
  });

  it('rejects unsafe query expressions', () => {
    expect(sanitizeQueryExpression('kind("ios_unit_test rule", //Apps/SampleApp/...)')).toBe(
      'kind("ios_unit_test rule", //Apps/SampleApp/...)',
    );
    expect(() => sanitizeQueryExpression('')).toThrow('expression is required');
    expect(() => sanitizeQueryExpression('//Apps/...; rm -rf /')).toThrow(
      'shell-like control characters',
    );
  });

  it('builds discovery expressions for apps, tests, and all iOS targets', () => {
    expect(discoverExpression('apps', '//Apps/SampleApp/...')).toBe(
      'kind("ios_application rule", //Apps/SampleApp/...)',
    );
    expect(discoverExpression('tests', '//Apps/SampleApp/...')).toContain('ios_unit_test rule');
    expect(discoverExpression('tests', '//Apps/SampleApp/...')).toContain('ios_ui_test rule');
    expect(discoverExpression('tests', '//Apps/SampleApp/...')).toContain('ios_build_test rule');
    expect(discoverExpression('all')).toContain('//Apps/... union //Packages/...');
  });

  it('builds discovery expressions for macOS targets', () => {
    expect(discoverExpression('macos_apps', '//mac/...')).toBe(
      'kind("macos_application rule", //mac/...)',
    );
    expect(discoverExpression('macos_tests', '//mac/...')).toBe(
      'kind("macos_unit_test rule", //mac/...)',
    );
    expect(discoverExpression('macos_all', '//mac/...')).toContain('macos_application rule');
    expect(discoverExpression('macos_all', '//mac/...')).toContain('macos_unit_test rule');
  });

  it('builds discovery expressions for tvOS targets', () => {
    expect(discoverExpression('tvos_apps', '//tvos/...')).toBe('kind("tvos_application rule", //tvos/...)');
    expect(discoverExpression('tvos_tests', '//tvos/...')).toBe('kind("tvos_unit_test rule", //tvos/...)');
    expect(discoverExpression('tvos_all', '//tvos/...')).toContain('tvos_application rule');
    expect(discoverExpression('tvos_all', '//tvos/...')).toContain('tvos_unit_test rule');
  });

  it('builds discovery expressions for watchOS targets', () => {
    expect(discoverExpression('watchos_apps', '//watch/...')).toBe('kind("watchos_application rule", //watch/...)');
    expect(discoverExpression('watchos_tests', '//watch/...')).toBe('kind("watchos_unit_test rule", //watch/...)');
    expect(discoverExpression('watchos_all', '//watch/...')).toContain('watchos_application rule');
    expect(discoverExpression('watchos_all', '//watch/...')).toContain('watchos_unit_test rule');
  });

  it('builds discovery expressions for visionOS targets', () => {
    expect(discoverExpression('visionos_apps', '//vision/...')).toBe('kind("visionos_application rule", //vision/...)');
    expect(discoverExpression('visionos_tests', '//vision/...')).toBe('kind("visionos_unit_test rule", //vision/...)');
    expect(discoverExpression('visionos_all', '//vision/...')).toContain('visionos_application rule');
    expect(discoverExpression('visionos_all', '//vision/...')).toContain('visionos_unit_test rule');
  });

  it('maps build mode and platform options to Bazel flags', () => {
    expect(modeArgs('none')).toEqual([]);
    expect(modeArgs('debug')).toEqual(['--config=debug']);
    expect(modeArgs('release')).toEqual(['--config=ios_release']);
    expect(modeArgs('release_with_symbols')).toEqual(['--config=ios_release', '--config=generate_dsym']);

    expect(platformArgs('none')).toEqual([]);
    expect(platformArgs('simulator')).toEqual(['--platforms=@build_bazel_apple_support//platforms:ios_sim_arm64', '--ios_multi_cpus=sim_arm64']);
    expect(platformArgs('device')).toEqual(['--platforms=@build_bazel_apple_support//platforms:ios_arm64', '--ios_multi_cpus=arm64']);
    expect(platformArgs('macos')).toEqual(['--platforms=@build_bazel_apple_support//platforms:darwin_arm64']);
    expect(platformArgs('tvos')).toEqual(['--platforms=@build_bazel_apple_support//platforms:tvos_sim_arm64', '--tvos_cpus=sim_arm64']);
    expect(platformArgs('watchos')).toEqual(['--platforms=@build_bazel_apple_support//platforms:watchos_arm64', '--watchos_cpus=arm64']);
    expect(platformArgs('visionos')).toEqual(['--platforms=@build_bazel_apple_support//platforms:visionos_sim_arm64', '--visionos_cpus=sim_arm64']);
  });

  it('tokenizeArgs splits on whitespace and honors quotes', () => {
    expect(tokenizeArgs('--batch --noautodetect_server_javabase')).toEqual(['--batch', '--noautodetect_server_javabase']);
    expect(tokenizeArgs('--output_base="/path with space" --batch')).toEqual(['--output_base=/path with space', '--batch']);
    expect(tokenizeArgs("--x='a b'")).toEqual(['--x=a b']);
    expect(tokenizeArgs('   ')).toEqual([]);
  });

  it('iosSimulatorCpu defaults to host arch and respects BAZEL_IOS_SIMULATOR_CPU', () => {
    const expected = process.arch === 'x64' ? 'x86_64' : 'sim_arm64';
    expect(iosSimulatorCpu()).toBe(expected);
    expect(iosSimulatorCpuArg()).toBe(`--ios_multi_cpus=${expected}`);

    process.env.BAZEL_IOS_SIMULATOR_CPU = 'x86_64';
    expect(iosSimulatorCpu()).toBe('x86_64');
    expect(platformArgs('simulator')).toEqual(['--platforms=@build_bazel_apple_support//platforms:ios_x86_64', '--ios_multi_cpus=x86_64']);
    delete process.env.BAZEL_IOS_SIMULATOR_CPU;
  });

  it('defaultDiscoverScope is overridable via BAZEL_IOS_DISCOVER_SCOPE', () => {
    expect(defaultDiscoverScope()).toBe('(//Apps/... union //Packages/...)');
    process.env.BAZEL_IOS_DISCOVER_SCOPE = '//...';
    expect(defaultDiscoverScope()).toBe('//...');
    expect(discoverExpression('apps')).toBe('kind("ios_application rule", //...)');
    delete process.env.BAZEL_IOS_DISCOVER_SCOPE;
  });

  it('maps simulator and config options to Bazel flags', () => {
    expect(
      simulatorArgs({
        simulatorName: 'iPhone 16 Pro',
        simulatorVersion: '18.4',
      }),
    ).toEqual(['--ios_simulator_device=iPhone 16 Pro', '--ios_simulator_version=18.4']);

    expect(configArgs(['test', 'debug.local'])).toEqual(['--config=test', '--config=debug.local']);
    expect(() => configArgs(['bad;config'])).toThrow('Invalid config value');
  });

  it('testFilterArgs returns single --test_filter for simple string', () => {
    expect(testFilterArgs('MyTestSuite')).toEqual(['--test_filter=MyTestSuite']);
  });

  it('testFilterArgs joins pipe-separated values with commas for rules_apple', () => {
    expect(testFilterArgs('SuiteA|SuiteB')).toEqual([
      '--test_filter=SuiteA,SuiteB',
    ]);
  });

  it('testFilterArgs handles whitespace around pipes', () => {
    expect(testFilterArgs(' A | B | C ')).toEqual([
      '--test_filter=A,B,C',
    ]);
  });

  it('testFilterArgs returns empty array for falsy values', () => {
    expect(testFilterArgs(undefined)).toEqual([]);
    expect(testFilterArgs('')).toEqual([]);
    expect(testFilterArgs('  ')).toEqual([]);
    expect(testFilterArgs(null)).toEqual([]);
  });

  it('builds a simulator build command with stable flag ordering', () => {
    expect(
      buildCommandArgs({
        target: '//:MyApp',
        buildMode: 'debug',
        platform: 'simulator',
        simulatorName: 'iPhone 16 Pro',
        configs: ['local'],
        extraArgs: ['--nobuild', '--verbose_failures'],
      }),
    ).toEqual([
      'build',
      '--config=debug',
      '--platforms=@build_bazel_apple_support//platforms:ios_sim_arm64',
      '--ios_multi_cpus=sim_arm64',
      '--ios_simulator_device=iPhone 16 Pro',
      '--config=local',
      '--nobuild',
      '--verbose_failures',
      '//:MyApp',
    ]);
  });

  it('excludes simulator flags when platform is device', () => {
    expect(
      buildCommandArgs({
        target: '//:MyApp',
        buildMode: 'release',
        platform: 'device',
        simulatorName: 'iPhone 16 Pro',
        simulatorVersion: '18.0',
      }),
    ).toEqual([
      'build',
      '--config=ios_release',
      '--platforms=@build_bazel_apple_support//platforms:ios_arm64',
      '--ios_multi_cpus=arm64',
      '//:MyApp',
    ]);
  });
});

describe('Config file parser', () => {
  it('parses simple key-value YAML', () => {
    const config = parseConfigYaml(`
workspacePath: /path/to/workspace
bazelPath: /opt/homebrew/bin/bazel
defaultSimulatorName: iPhone 16 Pro
maxOutput: 500000
    `);
    expect(config.workspacePath).toBe('/path/to/workspace');
    expect(config.bazelPath).toBe('/opt/homebrew/bin/bazel');
    expect(config.defaultSimulatorName).toBe('iPhone 16 Pro');
    expect(config.maxOutput).toBe(500000);
  });

  it('ignores comments and blank lines', () => {
    const config = parseConfigYaml(`
# This is a comment
workspacePath: /path

# Another comment
bazelPath: bazel
    `);
    expect(config.workspacePath).toBe('/path');
    expect(config.bazelPath).toBe('bazel');
  });

  it('handles boolean values', () => {
    const config = parseConfigYaml(`someFlag: true\nanotherFlag: false`);
    expect((config as Record<string, unknown>).someFlag).toBe(true);
    expect((config as Record<string, unknown>).anotherFlag).toBe(false);
  });

  it('handles decimal number values', () => {
    const config = parseConfigYaml(`maxOutput: 200000\ntimeout: 1.5`);
    expect(config.maxOutput).toBe(200000);
    expect((config as Record<string, unknown>).timeout).toBe(1.5);
  });

  it('parses named profiles from config', () => {
    const config = parseConfigYaml(`
workspacePath: /path/to/workspace
bazelPath: bazel
profiles:
  mainapp:
    defaultTarget: //Apps/MainApp:MainApp
    defaultSimulatorName: iPhone 16 Pro
    defaultBuildMode: debug
  liteapp:
    defaultTarget: //Apps/LiteApp:LiteApp
    defaultPlatform: simulator
    `);
    expect(config.workspacePath).toBe('/path/to/workspace');
    expect(config.profiles).toBeDefined();
    expect(Object.keys(config.profiles!)).toEqual(['mainapp', 'liteapp']);
    expect(config.profiles!.mainapp.defaultTarget).toBe('//Apps/MainApp:MainApp');
    expect(config.profiles!.mainapp.defaultSimulatorName).toBe('iPhone 16 Pro');
    expect(config.profiles!.mainapp.defaultBuildMode).toBe('debug');
    expect(config.profiles!.liteapp.defaultTarget).toBe('//Apps/LiteApp:LiteApp');
    expect(config.profiles!.liteapp.defaultPlatform).toBe('simulator');
  });

  it('returns empty profiles when none defined', () => {
    const config = parseConfigYaml(`workspacePath: /path`);
    expect(config.profiles).toBeUndefined();
  });

  it('preserves colons inside values', () => {
    const config = parseConfigYaml(`bazelPath: /usr/local/bin:bazel\nworkspacePath: C:\\Users\\foo`);
    expect(config.bazelPath).toBe('/usr/local/bin:bazel');
  });

  it('parses enabledWorkflows as comma-separated list', () => {
    const config = parseConfigYaml(`enabledWorkflows: build, test, query`);
    expect(config.enabledWorkflows).toEqual(['build', 'test', 'query']);
  });

  it('parses enabledWorkflows single value', () => {
    const config = parseConfigYaml(`enabledWorkflows: build`);
    expect(config.enabledWorkflows).toEqual(['build']);
  });

  it('handles enabledWorkflows with extra commas/spaces', () => {
    const config = parseConfigYaml(`enabledWorkflows: build,,test, , run`);
    expect(config.enabledWorkflows).toEqual(['build', 'test', 'run']);
  });

  it('flushes previous profile when encountering a new indent-0 key', () => {
    const config = parseConfigYaml(`
profiles:
  first:
    defaultTarget: //Apps/First:First
maxOutput: 100000
    `);
    expect(config.profiles).toBeDefined();
    expect(config.profiles!.first.defaultTarget).toBe('//Apps/First:First');
    expect(config.maxOutput).toBe(100000);
  });

  it('parses multiple profiles in sequence correctly', () => {
    const config = parseConfigYaml(`
profiles:
  alpha:
    defaultTarget: //Apps/Alpha:Alpha
    defaultBuildMode: debug
  beta:
    defaultTarget: //Apps/Beta:Beta
    defaultPlatform: device
  gamma:
    defaultTarget: //Apps/Gamma:Gamma
    defaultSimulatorName: iPhone 15
    `);
    expect(Object.keys(config.profiles!)).toEqual(['alpha', 'beta', 'gamma']);
    expect(config.profiles!.alpha.defaultBuildMode).toBe('debug');
    expect(config.profiles!.beta.defaultPlatform).toBe('device');
    expect(config.profiles!.gamma.defaultSimulatorName).toBe('iPhone 15');
  });

  it('parses boolean and numeric values inside profiles', () => {
    const config = parseConfigYaml(`
profiles:
  myapp:
    defaultTarget: //Apps/MyApp:MyApp
    someFlag: true
    anotherFlag: false
    timeout: 30
    `);
    const profile = config.profiles!.myapp as unknown as Record<string, unknown>;
    expect(profile.someFlag).toBe(true);
    expect(profile.anotherFlag).toBe(false);
    expect(profile.timeout).toBe(30);
  });

  it('skips lines with no valid colon separator', () => {
    const config = parseConfigYaml(`
workspacePath: /path
invalidline
: alsoInvalid
bazelPath: bazel
    `);
    expect(config.workspacePath).toBe('/path');
    expect(config.bazelPath).toBe('bazel');
  });

  it('handles empty content', () => {
    const config = parseConfigYaml('');
    expect(config).toEqual({});
  });

  it('handles content with only comments and blank lines', () => {
    const config = parseConfigYaml(`
# just a comment

# another one
    `);
    expect(config).toEqual({});
  });

  it('handles profile with no properties (empty profile)', () => {
    const config = parseConfigYaml(`
profiles:
  emptyprofile:
workspacePath: /path
    `);
    expect(config.profiles).toBeDefined();
    expect(config.profiles!.emptyprofile).toEqual({});
    expect(config.workspacePath).toBe('/path');
  });

  it('handles trailing profile at end of file (no newline flush)', () => {
    const config = parseConfigYaml(`profiles:
  trailing:
    defaultTarget: //Apps/Trailing:Trailing`);
    expect(config.profiles!.trailing.defaultTarget).toBe('//Apps/Trailing:Trailing');
  });

  it('parses key with colon but no space (bare colon)', () => {
    const config = parseConfigYaml(`profiles:\n  myapp:\n    defaultTarget://Foo:Bar`);
    const profile = config.profiles!.myapp as unknown as Record<string, unknown>;
    expect(profile.defaultTarget).toBe('//Foo:Bar');
  });

  it('parseValue handles float values at top-level', () => {
    const config = parseConfigYaml(`ratio: 3.14`);
    expect((config as Record<string, unknown>).ratio).toBe(3.14);
  });

  it('parseValue treats non-numeric strings as strings', () => {
    const config = parseConfigYaml(`name: hello-world`);
    expect((config as Record<string, unknown>).name).toBe('hello-world');
  });
});

describe('activateProfile', () => {
  it('parses profile configuration', () => {
    setWorkspace('/tmp/test-workspace');
    clearDefaults();

    const config = parseConfigYaml(`
profiles:
  myapp:
    defaultTarget: //Apps/MyApp:MyApp
    defaultSimulatorName: iPhone 16 Pro
    defaultBuildMode: debug
    `);
    expect(config.profiles!.myapp.defaultTarget).toBe('//Apps/MyApp:MyApp');
  });

  it('throws on unknown profile name', () => {
    setWorkspace('/tmp/nonexistent-workspace');
    clearDefaults();
    expect(() => activateProfile('nonexistent')).toThrow('Unknown profile "nonexistent"');
  });
});

describe('setEnabledWorkflows / getEnabledWorkflows', () => {
  it('sets and gets enabled workflows', () => {
    setEnabledWorkflows(['build', 'test']);
    expect(getEnabledWorkflows()).toEqual(['build', 'test']);
  });

  it('clears workflows when set to undefined', () => {
    setEnabledWorkflows(['build']);
    setEnabledWorkflows(undefined);
    expect(getEnabledWorkflows()).toBeUndefined();
  });
});

describe('getLastCommand', () => {
  it('returns null when no command has been run', () => {
    expect(getLastCommand()).toBeNull();
  });

  it('returns the last command result after runBazel', async () => {
    mockRunCommand.mockResolvedValue({ ...mockSuccess, output: 'build output' });
    await runBazel(['build', '//:MyApp']);
    const last = getLastCommand();
    expect(last).not.toBeNull();
    expect(last!.output).toBe('build output');
  });
});

describe('runBazel', () => {
  it('calls runCommand with bazel and workspace path', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);

    await runBazel(['build', '//:MyApp']);

    expect(mockRunCommand).toHaveBeenCalledWith('bazel', ['build', '//:MyApp'], {
      cwd: tempDir,
      timeoutSeconds: undefined,
      maxOutput: expect.any(Number),
      id: expect.any(String),
    });
  });

  it('passes startup args', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);

    await runBazel(['build', '//:MyApp'], undefined, ['--host_jvm_args=-Xmx4g']);

    expect(mockRunCommand).toHaveBeenCalledWith('bazel', ['--host_jvm_args=-Xmx4g', 'build', '//:MyApp'], expect.any(Object));
  });

  it('passes timeout', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);

    await runBazel(['build', '//:MyApp'], 300);

    expect(mockRunCommand).toHaveBeenCalledWith('bazel', ['build', '//:MyApp'], expect.objectContaining({ timeoutSeconds: 300 }));
  });

  it('respects BAZEL_IOS_STARTUP_ARGS env var', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);
    process.env.BAZEL_IOS_STARTUP_ARGS = '--batch --noautodetect_server_javabase';

    await runBazel(['build', '//:MyApp']);

    expect(mockRunCommand).toHaveBeenCalledWith('bazel', ['--batch', '--noautodetect_server_javabase', 'build', '//:MyApp'], expect.any(Object));

    delete process.env.BAZEL_IOS_STARTUP_ARGS;
  });

  it('stores result in lastCommand', async () => {
    mockRunCommand.mockResolvedValue({ ...mockSuccess, output: 'built successfully' });

    await runBazel(['build', '//:MyApp']);

    const last = getLastCommand();
    expect(last).not.toBeNull();
    expect(last!.output).toBe('built successfully');
  });
});

describe('runBazelStreaming', () => {
  it('calls runCommandStreaming and yields chunks', async () => {
    mockRunCommandStreaming.mockImplementation(async function* () {
      yield { stream: 'stdout' as const, data: 'Building...' };
      yield mockSuccess;
    });

    const chunks = [];
    for await (const chunk of runBazelStreaming(['build', '//:MyApp'])) {
      chunks.push(chunk);
    }

    expect(mockRunCommandStreaming).toHaveBeenCalledWith('bazel', ['build', '//:MyApp'], {
      cwd: tempDir,
      timeoutSeconds: undefined,
      maxOutput: expect.any(Number),
      id: expect.any(String),
    });
    expect(chunks).toHaveLength(2);
  });

  it('passes startup args', async () => {
    mockRunCommandStreaming.mockImplementation(async function* () {
      yield mockSuccess;
    });

    const chunks = [];
    for await (const chunk of runBazelStreaming(['test', '//:Tests'], undefined, ['--batch'])) {
      chunks.push(chunk);
    }

    expect(mockRunCommandStreaming).toHaveBeenCalledWith('bazel', ['--batch', 'test', '//:Tests'], expect.any(Object));
  });

  it('stores final result in lastCommand', async () => {
    mockRunCommandStreaming.mockImplementation(async function* () {
      yield { stream: 'stdout' as const, data: 'Building...' };
      yield { ...mockSuccess, output: 'test passed' };
    });

    const chunks = [];
    for await (const chunk of runBazelStreaming(['test', '//:Tests'])) {
      chunks.push(chunk);
    }

    const last = getLastCommand();
    expect(last).not.toBeNull();
    expect(last!.output).toBe('test passed');
  });
});
