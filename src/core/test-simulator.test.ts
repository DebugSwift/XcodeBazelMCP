import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult } from '../types/index.js';
import { runCommand } from '../utils/process.js';
import * as simulators from './simulators.js';
import {
  cleanupSimulatorsAfterTest,
  formatSimulatorTestCleanup,
  isTestSimulatorFlagEnabled,
  withTestSimulatorHooks,
} from './test-simulator.js';

vi.mock('../utils/process.js', () => ({
  runCommand: vi.fn(),
}));

vi.mock('./simulators.js', () => ({
  listSimulators: vi.fn(),
  shutdownSimulator: vi.fn(),
  deleteSimulator: vi.fn(),
}));

const mockRunCommand = vi.mocked(runCommand);
const mockListSimulators = vi.mocked(simulators.listSimulators);
const mockShutdownSimulator = vi.mocked(simulators.shutdownSimulator);
const mockDeleteSimulator = vi.mocked(simulators.deleteSimulator);

const mockSuccess: CommandResult = { exitCode: 0, output: '', command: 'xcrun simctl' };

describe('isTestSimulatorFlagEnabled', () => {
  it('accepts boolean and string truthy values', () => {
    expect(isTestSimulatorFlagEnabled(true)).toBe(true);
    expect(isTestSimulatorFlagEnabled('true')).toBe(true);
    expect(isTestSimulatorFlagEnabled(1)).toBe(true);
  });

  it('rejects falsy values', () => {
    expect(isTestSimulatorFlagEnabled(false)).toBe(false);
    expect(isTestSimulatorFlagEnabled(undefined)).toBe(false);
  });
});

describe('cleanupSimulatorsAfterTest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShutdownSimulator.mockResolvedValue(mockSuccess);
    mockDeleteSimulator.mockResolvedValue(mockSuccess);
    mockRunCommand.mockResolvedValue(mockSuccess);
  });

  it('shuts down newly booted simulators and deletes BAZEL_TEST simulators', async () => {
    mockListSimulators
      .mockResolvedValueOnce({
        command: mockSuccess,
        devices: [
          {
            udid: 'NEW-1',
            name: 'BAZEL_TEST_iPhone 11_26.3_abc',
            state: 'Booted',
            runtime: 'iOS 26.3',
            isAvailable: true,
          },
          {
            udid: 'OLD-1',
            name: 'iPhone 15',
            state: 'Booted',
            runtime: 'iOS 18.0',
            isAvailable: true,
          },
        ],
      })
      .mockResolvedValueOnce({ command: mockSuccess, devices: [] });

    const result = await cleanupSimulatorsAfterTest(new Set(['OLD-1']));

    expect(mockShutdownSimulator).toHaveBeenCalledWith('NEW-1');
    expect(mockDeleteSimulator).toHaveBeenCalledWith('NEW-1');
    expect(mockShutdownSimulator).not.toHaveBeenCalledWith('OLD-1');
    expect(result.shutDown).toHaveLength(1);
    expect(result.deleted).toHaveLength(1);
    expect(result.quitSimulatorApp).toBe(true);
  });

  it('leaves pre-booted non-BAZEL simulators alone', async () => {
    mockListSimulators
      .mockResolvedValueOnce({
        command: mockSuccess,
        devices: [
          {
            udid: 'OLD-1',
            name: 'iPhone 15',
            state: 'Booted',
            runtime: 'iOS 18.0',
            isAvailable: true,
          },
        ],
      })
      .mockResolvedValueOnce({
        command: mockSuccess,
        devices: [
          {
            udid: 'OLD-1',
            name: 'iPhone 15',
            state: 'Booted',
            runtime: 'iOS 18.0',
            isAvailable: true,
          },
        ],
      });

    const result = await cleanupSimulatorsAfterTest(new Set(['OLD-1']));

    expect(mockShutdownSimulator).not.toHaveBeenCalled();
    expect(result.shutDown).toHaveLength(0);
    expect(result.quitSimulatorApp).toBe(false);
  });
});

describe('formatSimulatorTestCleanup', () => {
  it('describes shutdown and delete actions', () => {
    const text = formatSimulatorTestCleanup({
      shutDown: ['BAZEL_TEST_iPhone 11 (NEW-1)'],
      deleted: ['BAZEL_TEST_iPhone 11 (NEW-1)'],
      quitSimulatorApp: true,
    });
    expect(text).toContain('Simulator shutdown');
    expect(text).toContain('Simulator deleted');
    expect(text).toContain('Simulator.app quit');
  });
});

describe('withTestSimulatorHooks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockListSimulators.mockResolvedValue({ command: mockSuccess, devices: [] });
    mockRunCommand.mockResolvedValue(mockSuccess);
    mockShutdownSimulator.mockResolvedValue(mockSuccess);
    mockDeleteSimulator.mockResolvedValue(mockSuccess);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs cleanup after the wrapped command when shutdown is enabled', async () => {
    mockListSimulators
      .mockResolvedValueOnce({ command: mockSuccess, devices: [] })
      .mockResolvedValueOnce({
        command: mockSuccess,
        devices: [
          {
            udid: 'NEW-1',
            name: 'BAZEL_TEST_iPhone 11_26.3_abc',
            state: 'Booted',
            runtime: 'iOS 26.3',
            isAvailable: true,
          },
        ],
      })
      .mockResolvedValueOnce({ command: mockSuccess, devices: [] });

    const wrapped = withTestSimulatorHooks(
      { shutdownSimulatorAfterTest: true },
      async () => 'done',
    );

    await expect(wrapped).resolves.toEqual({
      result: 'done',
      cleanupSummary: expect.stringContaining('Simulator shutdown'),
    });
    expect(mockShutdownSimulator).toHaveBeenCalledWith('NEW-1');
  });

  it('polls minimize while the wrapped command runs', async () => {
    let resolveRun: (value: string) => void = () => undefined;
    const runPromise = new Promise<string>((resolve) => {
      resolveRun = resolve;
    });

    const wrapped = withTestSimulatorHooks({ minimizeSimulator: true }, () => runPromise);
    const resultPromise = wrapped;

    await vi.advanceTimersByTimeAsync(2_000);
    expect(mockRunCommand).toHaveBeenCalled();

    resolveRun('done');
    await expect(resultPromise).resolves.toEqual({ result: 'done', cleanupSummary: undefined });
  });
});
