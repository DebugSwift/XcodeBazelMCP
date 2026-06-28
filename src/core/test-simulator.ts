import type { CommandResult, TestArgs } from '../types/index.js';
import { runCommand } from '../utils/process.js';
import { deleteSimulator, listSimulators, shutdownSimulator } from './simulators.js';

const BAZEL_TEST_SIMULATOR_PREFIX = 'BAZEL_TEST_';

export function isTestSimulatorFlagEnabled(value: unknown): boolean {
  return value === true || value === 'true' || value === 1;
}

export async function snapshotBootedSimulatorUdids(): Promise<Set<string>> {
  const { devices } = await listSimulators(true);
  return new Set(devices.map((device) => device.udid));
}

export async function minimizeSimulatorWindows(): Promise<CommandResult> {
  return runCommand(
    'osascript',
    ['-e', 'tell application "Simulator" to set miniaturized of every window to true'],
    {
      cwd: process.cwd(),
      timeoutSeconds: 5,
      maxOutput: 5_000,
    },
  );
}

export function startMinimizeSimulatorPoller(intervalMs = 2_000): () => void {
  let consecutiveFailures = 0;
  let hintShown = false;
  const timer = setInterval(() => {
    void minimizeSimulatorWindows().then((result) => {
      if (result.exitCode === 0) {
        consecutiveFailures = 0;
        return;
      }
      consecutiveFailures += 1;
      if (!hintShown && /not authoriz|-1743|assistive|accessibility/i.test(result.output)) {
        hintShown = true;
        console.error(
          'Note: minimizing Simulator windows needs Automation/Accessibility permission ' +
          '(System Settings → Privacy & Security → Automation). Continuing without minimize.',
        );
      }
      // Stop hammering osascript if Simulator isn't scriptable (e.g. not running).
      if (consecutiveFailures >= 3) clearInterval(timer);
    });
  }, intervalMs);
  return () => clearInterval(timer);
}

export interface SimulatorTestCleanupResult {
  shutDown: string[];
  deleted: string[];
  quitSimulatorApp: boolean;
}

export async function cleanupSimulatorsAfterTest(
  bootedBefore: Set<string>,
): Promise<SimulatorTestCleanupResult> {
  const { devices } = await listSimulators(true);
  const shutDown: string[] = [];
  const deleted: string[] = [];

  for (const device of devices) {
    // Only touch simulators that were not already booted when the test started
    // (i.e. ones the test itself opened). A sim the user had running before —
    // even a leftover BAZEL_TEST_* one — is left alone.
    const openedForTest = !bootedBefore.has(device.udid);
    if (!openedForTest) continue;

    await shutdownSimulator(device.udid);
    shutDown.push(`${device.name} (${device.udid})`);

    if (device.name.startsWith(BAZEL_TEST_SIMULATOR_PREFIX)) {
      await deleteSimulator(device.udid);
      deleted.push(`${device.name} (${device.udid})`);
    }
  }

  let quitSimulatorApp = false;
  const { devices: remaining } = await listSimulators(true);
  if (remaining.length === 0) {
    const quitResult = await runCommand('osascript', ['-e', 'tell application "Simulator" to quit'], {
      cwd: process.cwd(),
      timeoutSeconds: 5,
      maxOutput: 5_000,
    });
    quitSimulatorApp = quitResult.exitCode === 0;
  }

  return { shutDown, deleted, quitSimulatorApp };
}

export function formatSimulatorTestCleanup(result: SimulatorTestCleanupResult): string {
  const lines: string[] = [];
  if (result.shutDown.length > 0) {
    lines.push(`Simulator shutdown: ${result.shutDown.join(', ')}`);
  }
  if (result.deleted.length > 0) {
    lines.push(`Simulator deleted: ${result.deleted.join(', ')}`);
  }
  if (result.quitSimulatorApp) {
    lines.push('Simulator.app quit (no booted devices remaining).');
  }
  if (lines.length === 0) {
    lines.push('Simulator cleanup: no test simulators needed shutdown.');
  }
  return lines.join('\n');
}

export async function withTestSimulatorHooks<T>(
  testArgs: TestArgs,
  run: () => Promise<T>,
): Promise<{ result: T; cleanupSummary?: string }> {
  const minimize = isTestSimulatorFlagEnabled(testArgs.minimizeSimulator);
  const shutdownAfter = isTestSimulatorFlagEnabled(testArgs.shutdownSimulatorAfterTest);

  const bootedBefore = shutdownAfter ? await snapshotBootedSimulatorUdids() : new Set<string>();
  const stopMinimize = minimize ? startMinimizeSimulatorPoller() : undefined;

  try {
    const result = await run();
    let cleanupSummary: string | undefined;
    if (shutdownAfter) {
      const cleanup = await cleanupSimulatorsAfterTest(bootedBefore);
      cleanupSummary = formatSimulatorTestCleanup(cleanup);
    }
    return { result, cleanupSummary };
  } finally {
    stopMinimize?.();
  }
}
