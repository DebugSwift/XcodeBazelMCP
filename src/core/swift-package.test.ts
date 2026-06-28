import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult } from '../types/index.js';
import { runCommand, runCommandStreaming, type StreamChunk } from '../utils/process.js';
import {
  assertSwiftPackage,
  detectSwiftPackage,
  swiftBuild,
  swiftBuildStreaming,
  swiftPackageClean,
  swiftPackageDump,
  swiftPackageResolve,
  swiftRun,
  swiftTest,
  swiftTestStreaming,
} from './swift-package.js';

vi.mock('../utils/process.js', () => ({
  runCommand: vi.fn(),
  runCommandStreaming: vi.fn(),
}));

const mockRunCommand = vi.mocked(runCommand);
const mockRunCommandStreaming = vi.mocked(runCommandStreaming);

let tempDir: string;

beforeEach(() => {
  tempDir = join(tmpdir(), `swiftpm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });
  vi.clearAllMocks();
});

afterEach(() => {
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

const mockSuccess: CommandResult = {
  command: 'swift',
  args: [],
  exitCode: 0,
  output: '',
  durationMs: 10,
  truncated: false,
};

describe('detectSwiftPackage', () => {
  it('detects a valid Swift package', () => {
    writeFileSync(join(tempDir, 'Package.swift'), '// swift-tools-version:5.5');
    const info = detectSwiftPackage(tempDir);
    expect(info.hasPackageSwift).toBe(true);
    expect(info.hasPackageResolved).toBe(false);
  });

  it('detects missing Package.swift', () => {
    const info = detectSwiftPackage(tempDir);
    expect(info.hasPackageSwift).toBe(false);
  });
});

describe('assertSwiftPackage', () => {
  it('throws when Package.swift is missing', () => {
    expect(() => assertSwiftPackage(tempDir)).toThrow('No Package.swift found');
  });

  it('returns the resolved path when Package.swift exists', () => {
    writeFileSync(join(tempDir, 'Package.swift'), '// swift-tools-version:5.5');
    const resolved = assertSwiftPackage(tempDir);
    expect(resolved).toBe(tempDir);
  });
});

describe('swiftBuild', () => {
  beforeEach(() => {
    writeFileSync(join(tempDir, 'Package.swift'), '// swift-tools-version:5.5');
  });

  it('calls swift build with default options', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);

    await swiftBuild({ packagePath: tempDir });

    expect(mockRunCommand).toHaveBeenCalledWith('swift', ['build'], {
      cwd: tempDir,
      timeoutSeconds: 600,
      maxOutput: 500_000,
    });
  });

  it('passes configuration option', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);

    await swiftBuild({ packagePath: tempDir, configuration: 'release' });

    expect(mockRunCommand).toHaveBeenCalledWith('swift', ['build', '-c', 'release'], expect.any(Object));
  });

  it('passes target option', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);

    await swiftBuild({ packagePath: tempDir, target: 'MyTarget' });

    expect(mockRunCommand).toHaveBeenCalledWith('swift', ['build', '--target', 'MyTarget'], expect.any(Object));
  });

  it('passes extra args', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);

    await swiftBuild({ packagePath: tempDir, extraArgs: ['--verbose', '--static-swift-stdlib'] });

    expect(mockRunCommand).toHaveBeenCalledWith('swift', ['build', '--verbose', '--static-swift-stdlib'], expect.any(Object));
  });

  it('respects custom timeout', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);

    await swiftBuild({ packagePath: tempDir, timeoutSeconds: 300 });

    expect(mockRunCommand).toHaveBeenCalledWith('swift', ['build'], expect.objectContaining({ timeoutSeconds: 300 }));
  });
});

describe('swiftBuildStreaming', () => {
  beforeEach(() => {
    writeFileSync(join(tempDir, 'Package.swift'), '// swift-tools-version:5.5');
  });

  it('calls swift build with streaming', async () => {
    const mockChunk: StreamChunk = { stream: 'stdout', data: 'Building...' };
    mockRunCommandStreaming.mockImplementation(async function* () {
      yield mockChunk;
      yield mockSuccess;
    });

    const chunks = [];
    for await (const chunk of swiftBuildStreaming({ packagePath: tempDir })) {
      chunks.push(chunk);
    }

    expect(mockRunCommandStreaming).toHaveBeenCalledWith('swift', ['build'], {
      cwd: tempDir,
      timeoutSeconds: 600,
      maxOutput: 500_000,
    });
    expect(chunks).toHaveLength(2);
  });

  it('passes all options to streaming', async () => {
    mockRunCommandStreaming.mockImplementation(async function* () {
      yield mockSuccess;
    });

    const chunks = [];
    for await (const chunk of swiftBuildStreaming({ packagePath: tempDir, configuration: 'debug', target: 'MyTarget' })) {
      chunks.push(chunk);
    }

    expect(mockRunCommandStreaming).toHaveBeenCalledWith('swift', ['build', '-c', 'debug', '--target', 'MyTarget'], expect.any(Object));
  });
});

describe('swiftTest', () => {
  beforeEach(() => {
    writeFileSync(join(tempDir, 'Package.swift'), '// swift-tools-version:5.5');
  });

  it('calls swift test with default options', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);

    await swiftTest({ packagePath: tempDir });

    expect(mockRunCommand).toHaveBeenCalledWith('swift', ['test'], {
      cwd: tempDir,
      timeoutSeconds: 1_200,
      maxOutput: 500_000,
    });
  });

  it('passes filter option', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);

    await swiftTest({ packagePath: tempDir, filter: 'MyTests' });

    expect(mockRunCommand).toHaveBeenCalledWith('swift', ['test', '--filter', 'MyTests'], expect.any(Object));
  });

  it('passes configuration option', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);

    await swiftTest({ packagePath: tempDir, configuration: 'release' });

    expect(mockRunCommand).toHaveBeenCalledWith('swift', ['test', '-c', 'release'], expect.any(Object));
  });

  it('passes extra args', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);

    await swiftTest({ packagePath: tempDir, extraArgs: ['--parallel', '--enable-code-coverage'] });

    expect(mockRunCommand).toHaveBeenCalledWith('swift', ['test', '--parallel', '--enable-code-coverage'], expect.any(Object));
  });
});

describe('swiftTestStreaming', () => {
  beforeEach(() => {
    writeFileSync(join(tempDir, 'Package.swift'), '// swift-tools-version:5.5');
  });

  it('calls swift test with streaming', async () => {
    const mockChunk: StreamChunk = { stream: 'stdout', data: 'Test Suite started' };
    mockRunCommandStreaming.mockImplementation(async function* () {
      yield mockChunk;
      yield mockSuccess;
    });

    const chunks = [];
    for await (const chunk of swiftTestStreaming({ packagePath: tempDir })) {
      chunks.push(chunk);
    }

    expect(mockRunCommandStreaming).toHaveBeenCalledWith('swift', ['test'], expect.any(Object));
    expect(chunks).toHaveLength(2);
  });
});

describe('swiftRun', () => {
  beforeEach(() => {
    writeFileSync(join(tempDir, 'Package.swift'), '// swift-tools-version:5.5');
  });

  it('calls swift run with default options', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);

    await swiftRun({ packagePath: tempDir });

    expect(mockRunCommand).toHaveBeenCalledWith('swift', ['run'], {
      cwd: tempDir,
      timeoutSeconds: 300,
      maxOutput: 500_000,
    });
  });

  it('passes executable name', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);

    await swiftRun({ packagePath: tempDir, executable: 'myapp' });

    expect(mockRunCommand).toHaveBeenCalledWith('swift', ['run', 'myapp'], expect.any(Object));
  });

  it('passes configuration option', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);

    await swiftRun({ packagePath: tempDir, configuration: 'release' });

    expect(mockRunCommand).toHaveBeenCalledWith('swift', ['run', '-c', 'release'], expect.any(Object));
  });

  it('passes extra args', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);

    await swiftRun({ packagePath: tempDir, extraArgs: ['--skip-build'] });

    expect(mockRunCommand).toHaveBeenCalledWith('swift', ['run', '--skip-build'], expect.any(Object));
  });

  it('passes run args with -- separator', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);

    await swiftRun({ packagePath: tempDir, executable: 'myapp', runArgs: ['arg1', 'arg2'] });

    expect(mockRunCommand).toHaveBeenCalledWith('swift', ['run', 'myapp', '--', 'arg1', 'arg2'], expect.any(Object));
  });
});

describe('swiftPackageClean', () => {
  beforeEach(() => {
    writeFileSync(join(tempDir, 'Package.swift'), '// swift-tools-version:5.5');
  });

  it('calls swift package clean', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);

    await swiftPackageClean({ packagePath: tempDir });

    expect(mockRunCommand).toHaveBeenCalledWith('swift', ['package', 'clean'], {
      cwd: tempDir,
      timeoutSeconds: 60,
      maxOutput: 100_000,
    });
  });
});

describe('swiftPackageResolve', () => {
  beforeEach(() => {
    writeFileSync(join(tempDir, 'Package.swift'), '// swift-tools-version:5.5');
  });

  it('calls swift package resolve', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);

    await swiftPackageResolve({ packagePath: tempDir });

    expect(mockRunCommand).toHaveBeenCalledWith('swift', ['package', 'resolve'], {
      cwd: tempDir,
      timeoutSeconds: 300,
      maxOutput: 200_000,
    });
  });

  it('respects custom timeout', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);

    await swiftPackageResolve({ packagePath: tempDir, timeoutSeconds: 120 });

    expect(mockRunCommand).toHaveBeenCalledWith('swift', ['package', 'resolve'], expect.objectContaining({ timeoutSeconds: 120 }));
  });
});

describe('swiftPackageDump', () => {
  beforeEach(() => {
    writeFileSync(join(tempDir, 'Package.swift'), '// swift-tools-version:5.5');
  });

  it('calls swift package dump-package and parses JSON', async () => {
    const manifestJson = JSON.stringify({ name: 'MyPackage', platforms: [] });
    mockRunCommand.mockResolvedValue({ ...mockSuccess, output: manifestJson });

    const result = await swiftPackageDump({ packagePath: tempDir });

    expect(mockRunCommand).toHaveBeenCalledWith('swift', ['package', 'dump-package'], {
      cwd: tempDir,
      timeoutSeconds: 60,
      maxOutput: 500_000,
    });
    expect(result.manifest).toEqual({ name: 'MyPackage', platforms: [] });
  });

  it('parses stdout JSON even when stderr warnings land in combined output (regression)', async () => {
    const manifestJson = JSON.stringify({ name: 'MyPackage', platforms: [] });
    // `swift` may emit warnings to stderr which the combined `output` prepends.
    mockRunCommand.mockResolvedValue({
      ...mockSuccess,
      stdout: manifestJson,
      output: `warning: 'foo' is deprecated\n${manifestJson}`,
    });

    const result = await swiftPackageDump({ packagePath: tempDir });

    expect(result.manifest).toEqual({ name: 'MyPackage', platforms: [] });
  });

  it('returns undefined manifest on parse error', async () => {
    mockRunCommand.mockResolvedValue({ ...mockSuccess, output: 'not json' });

    const result = await swiftPackageDump({ packagePath: tempDir });

    expect(result.manifest).toBeUndefined();
  });

  it('returns undefined manifest on command failure', async () => {
    mockRunCommand.mockResolvedValue({ ...mockSuccess, exitCode: 1, output: 'error' });

    const result = await swiftPackageDump({ packagePath: tempDir });

    expect(result.manifest).toBeUndefined();
  });
});
