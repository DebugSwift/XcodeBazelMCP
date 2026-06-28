import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult } from '../types/index.js';
import { runCommand } from '../utils/process.js';
import {
  checkForUpdate,
  compareVersions,
  detectInstallMethod,
  getCurrentVersion,
  performUpgrade,
  upgradeHint,
  type InstallMethod,
} from './upgrade.js';

vi.mock('../utils/process.js', () => ({
  runCommand: vi.fn(),
}));

const mockRunCommand = vi.mocked(runCommand);

const mockSuccess: CommandResult = {
  command: 'npm',
  args: [],
  exitCode: 0,
  output: '',
  durationMs: 10,
  truncated: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('returns 1 when first is newer', () => {
    expect(compareVersions('2.0.0', '1.0.0')).toBe(1);
    expect(compareVersions('1.1.0', '1.0.0')).toBe(1);
    expect(compareVersions('1.0.1', '1.0.0')).toBe(1);
  });

  it('returns -1 when first is older', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
    expect(compareVersions('0.9.0', '1.0.0')).toBe(-1);
  });

  it('handles different segment counts', () => {
    expect(compareVersions('1.0.0', '1.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.0')).toBe(1);
  });
});

describe('detectInstallMethod', () => {
  it('returns a known install method', () => {
    const method = detectInstallMethod();
    expect(['npm-global', 'npm-local', 'homebrew', 'source', 'unknown']).toContain(method);
  });
});

describe('getCurrentVersion', () => {
  it('returns a semver string', () => {
    const version = getCurrentVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('upgradeHint', () => {
  it('returns npm command for npm-global', () => {
    expect(upgradeHint('npm-global')).toContain('npm install -g');
  });

  it('returns brew command for homebrew', () => {
    expect(upgradeHint('homebrew')).toContain('brew upgrade');
  });

  it('returns git pull for source', () => {
    expect(upgradeHint('source')).toContain('git pull');
  });

  it('returns npm update for npm-local', () => {
    expect(upgradeHint('npm-local')).toContain('npm update');
  });

  it('returns npm install command for unknown method', () => {
    expect(upgradeHint('unknown')).toBe('npm install -g xcodebazelmcp@latest');
  });

  it('falls back to npm install for any unrecognized method', () => {
    expect(upgradeHint('something-else' as unknown as InstallMethod)).toBe('npm install -g xcodebazelmcp@latest');
  });
});

describe('compareVersions – edge cases', () => {
  it('treats empty string segments as 0', () => {
    expect(compareVersions('', '')).toBe(0);
    expect(compareVersions('1', '')).toBe(1);
    expect(compareVersions('', '1')).toBe(-1);
  });

  it('handles single-segment versions', () => {
    expect(compareVersions('3', '2')).toBe(1);
    expect(compareVersions('2', '3')).toBe(-1);
    expect(compareVersions('5', '5')).toBe(0);
  });

  it('compares versions with many segments', () => {
    expect(compareVersions('1.2.3.4', '1.2.3.3')).toBe(1);
    expect(compareVersions('1.2.3.4', '1.2.3.4')).toBe(0);
    expect(compareVersions('1.2.3', '1.2.3.1')).toBe(-1);
  });

  it('handles mismatched segment lengths with trailing zeros', () => {
    expect(compareVersions('1.0.0.0.0', '1')).toBe(0);
    expect(compareVersions('1.0.0.0.1', '1')).toBe(1);
  });

  it('treats a prerelease as lower precedence than the release', () => {
    expect(compareVersions('2.5.0', '2.5.0-beta.1')).toBe(1);
    expect(compareVersions('2.5.0-beta.1', '2.5.0')).toBe(-1);
  });

  it('orders prerelease identifiers', () => {
    expect(compareVersions('2.5.0-beta.1', '2.5.0-beta.2')).toBe(-1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-alpha')).toBe(1);
    expect(compareVersions('2.6.0-beta.1', '2.6.0-beta.1')).toBe(0);
  });

  it('strips build metadata', () => {
    expect(compareVersions('1.0.0+build5', '1.0.0+build9')).toBe(0);
  });
});

describe('detectInstallMethod – value check', () => {
  it('returns one of the valid InstallMethod values', () => {
    const valid = ['npm-global', 'npm-local', 'homebrew', 'source', 'unknown'];
    expect(valid).toContain(detectInstallMethod());
  });

  it('returns the same value on repeated calls', () => {
    const first = detectInstallMethod();
    const second = detectInstallMethod();
    expect(first).toBe(second);
  });
});

describe('checkForUpdate', () => {
  it('returns update info when newer version available', async () => {
    mockRunCommand.mockResolvedValue({ ...mockSuccess, output: '2.0.0' });

    const info = await checkForUpdate();

    expect(mockRunCommand).toHaveBeenCalledWith('npm', ['view', 'xcodebazelmcp', 'version'], expect.any(Object));
    expect(info.latest).toBe('2.0.0');
    expect(info.current).toBeDefined();
    expect(info.installMethod).toBeDefined();
  });

  it('sets updateAvailable to true when latest is newer', async () => {
    mockRunCommand.mockResolvedValue({ ...mockSuccess, output: '999.0.0' });

    const info = await checkForUpdate();

    expect(info.updateAvailable).toBe(true);
  });

  it('sets updateAvailable to false when current is same or newer', async () => {
    const currentVersion = getCurrentVersion();
    mockRunCommand.mockResolvedValue({ ...mockSuccess, output: currentVersion });

    const info = await checkForUpdate();

    expect(info.updateAvailable).toBe(false);
  });

  it('returns null for latest when npm command fails', async () => {
    mockRunCommand.mockResolvedValue({ ...mockSuccess, exitCode: 1, output: 'error' });

    const info = await checkForUpdate();

    expect(info.latest).toBeNull();
    expect(info.updateAvailable).toBe(false);
  });

  it('returns null for latest when npm returns empty output', async () => {
    mockRunCommand.mockResolvedValue({ ...mockSuccess, output: '' });

    const info = await checkForUpdate();

    expect(info.latest).toBeNull();
  });
});

describe('performUpgrade', () => {
  it('runs npm install -g for npm-global', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);

    await performUpgrade('npm-global');

    expect(mockRunCommand).toHaveBeenCalledWith('npm', ['install', '-g', 'xcodebazelmcp@latest'], expect.any(Object));
  });

  it('runs npm update for npm-local', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);

    await performUpgrade('npm-local');

    expect(mockRunCommand).toHaveBeenCalledWith('npm', ['update', 'xcodebazelmcp'], expect.any(Object));
  });

  it('runs brew upgrade for homebrew', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);

    await performUpgrade('homebrew');

    expect(mockRunCommand).toHaveBeenCalledWith('brew', ['upgrade', 'xcodebazelmcp'], expect.any(Object));
  });

  it('runs git pull, npm install, npm run build for source', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);

    await performUpgrade('source');

    expect(mockRunCommand).toHaveBeenCalledTimes(3);
    expect(mockRunCommand).toHaveBeenNthCalledWith(1, 'git', ['pull', '--rebase', '--autostash'], expect.any(Object));
    expect(mockRunCommand).toHaveBeenNthCalledWith(2, 'npm', ['install'], expect.any(Object));
    expect(mockRunCommand).toHaveBeenNthCalledWith(3, 'npm', ['run', 'build'], expect.any(Object));
  });

  it('stops on git pull failure for source install', async () => {
    mockRunCommand.mockResolvedValueOnce({ ...mockSuccess, exitCode: 1 });

    const result = await performUpgrade('source');

    expect(result.exitCode).toBe(1);
    expect(mockRunCommand).toHaveBeenCalledTimes(1);
  });

  it('stops on npm install failure for source install', async () => {
    mockRunCommand.mockResolvedValueOnce(mockSuccess);
    mockRunCommand.mockResolvedValueOnce({ ...mockSuccess, exitCode: 1 });

    const result = await performUpgrade('source');

    expect(result.exitCode).toBe(1);
    expect(mockRunCommand).toHaveBeenCalledTimes(2);
  });

  it('returns error message for unknown install method', async () => {
    const result = await performUpgrade('unknown');

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('Cannot determine install method');
    expect(mockRunCommand).not.toHaveBeenCalled();
  });

  it('detects install method when not provided', async () => {
    mockRunCommand.mockResolvedValue(mockSuccess);

    await performUpgrade();

    expect(mockRunCommand).toHaveBeenCalled();
  });
});
