import { callBazelTool } from './tools/index.js';
import { getConfig } from './runtime/config.js';
import { assertBazelWorkspace } from './core/workspace.js';
import { runCommand } from './utils/process.js';
import { listSimulators } from './core/simulators.js';

interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

async function preflight(): Promise<{ checks: Check[]; hardFail: boolean }> {
  const config = getConfig();
  const checks: Check[] = [];

  // 1. Bazel binary resolves and runs.
  const version = await runCommand(config.bazelPath, ['--version'], {
    cwd: config.workspacePath,
    timeoutSeconds: 20,
    maxOutput: 5_000,
  });
  if (version.failureKind === 'spawn-error') {
    checks.push({
      label: 'bazel binary',
      ok: false,
      detail: `cannot run "${config.bazelPath}" (${version.spawnErrorCode || 'spawn error'}). Set bazelPath in config or PATH.`,
    });
  } else if (version.exitCode !== 0) {
    checks.push({ label: 'bazel binary', ok: false, detail: `"${config.bazelPath} --version" exited ${version.exitCode}.` });
  } else {
    checks.push({ label: 'bazel binary', ok: true, detail: `${config.bazelPath} — ${version.output.trim().split('\n')[0]}` });
  }

  // 2. Workspace is a real Bazel root.
  try {
    assertBazelWorkspace(config.workspacePath);
    checks.push({ label: 'workspace', ok: true, detail: `${config.workspacePath} (Bazel root)` });
  } catch (err) {
    checks.push({ label: 'workspace', ok: false, detail: (err as Error).message });
  }

  // 3. Simulator runtime availability.
  const { command, devices } = await listSimulators();
  if (command.exitCode !== 0) {
    checks.push({ label: 'simulators', ok: false, detail: 'xcrun simctl unavailable — is Xcode installed and selected?' });
  } else if (devices.length === 0) {
    checks.push({ label: 'simulators', ok: false, detail: 'No simulators available. Install a runtime in Xcode.' });
  } else {
    const booted = devices.filter((d) => d.state === 'Booted').length;
    checks.push({ label: 'simulators', ok: true, detail: `${devices.length} available, ${booted} booted` });
  }

  return { checks, hardFail: checks.some((c) => !c.ok) };
}

const { checks, hardFail } = await preflight();
console.log('⚙️ XcodeBazelMCP Doctor — preflight\n');
for (const c of checks) {
  console.log(`  ${c.ok ? '✅' : '❌'} ${c.label}: ${c.detail}`);
}
console.log('');

const result = await callBazelTool('bazel_ios_health', {});
const text = result.content
  .filter((item): item is { type: 'text'; text: string } => item.type === 'text')
  .map((item) => item.text)
  .join('\n');
console.log(text);

if (hardFail || result.isError) {
  process.exitCode = 1;
}
