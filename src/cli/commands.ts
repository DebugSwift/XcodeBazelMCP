import { createInterface } from 'node:readline';
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, cpSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { callBazelTool, callBazelToolStreaming } from '../tools/index.js';
import type { JsonObject } from '../types/index.js';

export function extractText(result: Awaited<ReturnType<typeof callBazelTool>>): string {
  return result.content
    .filter((item): item is { type: 'text'; text: string } => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
}

export async function printTool(name: string, args: JsonObject): Promise<void> {
  try {
    if (args.streaming) {
      let streamedAny = false;
      const result = await callBazelToolStreaming(name, args, (chunk) => {
        streamedAny = true;
        process.stdout.write(chunk);
      });
      if (streamedAny) console.log(''); // separate streamed progress from the summary
      console.log(extractText(result));
      if (result.isError) process.exitCode = 1;
      return;
    }
    const result = await callBazelTool(name, args);
    console.log(extractText(result));
    if (result.isError) process.exitCode = 1;
  } catch (err) {
    // Surface a clean message to CLI users instead of a raw Node stack trace.
    console.error(`Error: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

function bundledSkillsDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, '..', 'skills'), join(here, '..', '..', 'skills')]) {
    if (existsSync(candidate)) return candidate;
  }
  const cwdSkill = join(process.cwd(), 'skills');
  if (existsSync(cwdSkill)) return cwdSkill;
  return null;
}

function installBundledSkills(): void {
  const source = bundledSkillsDir();
  if (!source) {
    console.log('No bundled skills directory found (skip skill copy).');
    return;
  }

  const skillNames = readdirSync(source, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const destRoots = [
    join(homedir(), '.cursor', 'skills'),
    join(process.cwd(), '.agents', 'skills'),
  ];

  for (const skillName of skillNames) {
    const srcSkill = join(source, skillName, 'SKILL.md');
    if (!existsSync(srcSkill)) continue;
    const content = readFileSync(srcSkill, 'utf-8');

    for (const root of destRoots) {
      const destDir = join(root, skillName);
      mkdirSync(destDir, { recursive: true });
      const destFile = join(destDir, 'SKILL.md');
      writeFileSync(destFile, content);
      console.log(`Installed skill: ${destFile}`);
    }

    const agentsMirror = join(process.cwd(), '.agents', 'skills', skillName);
    if (!existsSync(agentsMirror)) {
      mkdirSync(dirname(agentsMirror), { recursive: true });
      cpSync(join(source, skillName), agentsMirror, { recursive: true });
      console.log(`Installed skill: ${agentsMirror}`);
    }
  }
}

export function runSkillInit(): void {
  const skillContent = `# XcodeBazelMCP Skill

This project uses XcodeBazelMCP for Bazel-based iOS development.

## Available Tools

Use the \`bazel_ios_*\` MCP tools to build, test, run, and manage iOS apps built with Bazel.

Key commands:
- \`bazel_ios_build\` — Build a Bazel iOS target
- \`bazel_ios_build_and_run\` — Build, install, and launch on simulator
- \`bazel_ios_test\` — Run tests
- \`bazel_ios_test_coverage\` — Run tests with code coverage
- \`bazel_ios_query\` / \`bazel_ios_deps\` / \`bazel_ios_rdeps\` — Query the build graph
- \`bazel_ios_discover_targets\` — Find app and test targets
- \`bazel_ios_set_defaults\` — Set default target, simulator, build mode
- \`bazel_ios_clean\` — Clean build outputs
- \`bazel_ios_log_capture_start\` / \`bazel_ios_log_capture_stop\` — Capture simulator logs
- \`bazel_ios_agent_debug_log_clear\` / \`read\` / \`pull\` / \`repro\` — Cursor DEBUG MODE NDJSON workflow

## Cursor debug mode (swift-agent-debug-log)

1. \`bazel_ios_agent_debug_log_clear\` with \`logPath\` → \`.cursor/debug-{session}.log\`
2. \`bazel_ios_agent_debug_repro\` (or \`build_and_run\` with \`launchEnv\`: \`AGENT_DEBUG_LOG_PATH\`, \`AGENT_DEBUG_SESSION_ID\`)
3. User reproduces the bug in the simulator
4. \`bazel_ios_agent_debug_log_read\` on the host log, or \`bazel_ios_agent_debug_log_pull\` if Swift wrote to \`Documents/agent-debug.ndjson\`

See skill \`swift-agent-debug-log\` (installed by \`xcodebazelmcp init\`).

All build/test/query tools support \`streaming: true\` for real-time output via MCP progress notifications.

## CLI

\`\`\`sh
xcodebazelmcp build //app:app --stream
xcodebazelmcp run //app:app --simulator-name "iPhone 16 Pro"
xcodebazelmcp test //tests:tests --filter MyTest
xcodebazelmcp deps //app:app --depth 2
xcodebazelmcp coverage //tests:tests
\`\`\`
`;

  const targets = [
    { dir: '.cursor/rules', file: 'xcodebazelmcp.md' },
    { dir: '.codex', file: 'AGENTS.md' },
  ];

  let installed = false;
  for (const { dir, file } of targets) {
    const dirPath = join(process.cwd(), dir);
    const filePath = join(dirPath, file);
    if (existsSync(dirPath) || dir === '.cursor/rules') {
      if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
      writeFileSync(filePath, skillContent);
      console.log(`Installed: ${filePath}`);
      installed = true;
    }
  }

  if (!installed) {
    const fallback = join(process.cwd(), '.cursor', 'rules', 'xcodebazelmcp.md');
    mkdirSync(join(process.cwd(), '.cursor', 'rules'), { recursive: true });
    writeFileSync(fallback, skillContent);
    console.log(`Installed: ${fallback}`);
  }

  installBundledSkills();
}

/**
 * Print update status. With `withExitCode`, set a scripting-friendly exit code:
 * 0 = up to date / unknown, 1 = a newer version is available.
 */
export async function runCheckUpdate(withExitCode = false): Promise<void> {
  const { checkForUpdate, upgradeHint } = await import('../core/upgrade.js');
  const info = await checkForUpdate();
  console.log(`Current version: ${info.current}`);
  console.log(`Latest version: ${info.latest || '(unable to fetch)'}`);
  console.log(`Install method: ${info.installMethod}`);
  if (info.updateAvailable) {
    console.log(`\nUpdate available! Run: ${upgradeHint(info.installMethod)}`);
    if (withExitCode) process.exitCode = 1;
  } else {
    console.log('\nYou are up to date.');
  }
}

export async function runUpgrade(args: string[]): Promise<void> {
  const { checkForUpdate, performUpgrade, upgradeHint } = await import('../core/upgrade.js');
  let method: import('../core/upgrade.js').InstallMethod | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--method') method = args[++i] as import('../core/upgrade.js').InstallMethod;
  }

  const info = await checkForUpdate();
  console.log(`Current: ${info.current}`);
  console.log(`Latest:  ${info.latest || '(unable to fetch)'}`);
  console.log(`Method:  ${info.installMethod}`);

  if (!info.updateAvailable && !method) {
    console.log('\nAlready up to date.');
    return;
  }

  console.log(`\nUpgrading via: ${upgradeHint(method || info.installMethod)}`);

  const result = await performUpgrade(method);
  console.log(result.output);
  if (result.exitCode !== 0) {
    console.error(`Upgrade failed (exit ${result.exitCode}).`);
    process.exitCode = 1;
  } else {
    console.log('Upgrade complete.');
  }
}

export async function runDaemon(args: string[]): Promise<void> {
  const { startDaemon } = await import('../daemon/index.js');
  let wsPath = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--workspace') wsPath = args[++i];
  }
  const info = startDaemon(wsPath);
  if (!process.env.XBMCP_DAEMON) {
    console.log(`Daemon started (PID ${info.pid}) for ${info.workspacePath}`);
    console.log(`Socket: ${info.socketPath}`);
    console.log('Press Ctrl+C to stop.');
  }
  await new Promise<void>((resolve) => {
    process.once('SIGINT', () => {
      if (!process.env.XBMCP_DAEMON) console.log('\nDaemon stopping.');
      resolve();
    });
    process.once('SIGTERM', resolve);
  });
}

/**
 * Resolve a booted simulator UDID from --simulator-id / --simulator-name, or
 * fall back to the first booted device. Exits the process with a clear message
 * if none can be found. Shared by the streaming CLI commands.
 */
async function resolveBootedSimulatorUdid(args: JsonObject): Promise<string> {
  const result = await callBazelTool('bazel_ios_list_simulators', { onlyBooted: true });
  let devices: Array<{ udid: string; name: string }> = [];
  try {
    devices = JSON.parse(extractText(result));
  } catch {
    /* empty */
  }
  let udid = args.simulatorId as string | undefined;
  if (!udid && typeof args.simulatorName === 'string') {
    const match = devices.find(
      (d) => d.name.toLowerCase() === (args.simulatorName as string).toLowerCase(),
    );
    if (match) udid = match.udid;
  }
  if (!udid) udid = devices[0]?.udid;
  if (!udid) {
    console.error('No booted simulator found. Boot one first or pass --simulator-id / --simulator-name.');
    process.exit(1);
  }
  return udid;
}

export async function runVideoRecord(args: JsonObject): Promise<void> {
  if (typeof args.outputPath !== 'string') {
    console.error('Usage: xcodebazelmcp video-record <output.mp4> [--simulator-name "..."]');
    process.exit(1);
  }
  const udid = await resolveBootedSimulatorUdid(args);

  console.log(`Recording video from simulator ${udid}...`);
  console.log(`Output: ${args.outputPath}`);
  console.log('Press Ctrl+C to stop.\n');

  const child = spawn('xcrun', ['simctl', 'io', udid, 'recordVideo', '-f', args.outputPath], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      child.kill('SIGINT');
      setTimeout(resolve, 1000);
    });
    child.on('close', () => resolve());
  });
  console.log(`\nVideo saved to ${args.outputPath}`);
}

export async function runLogStream(args: JsonObject): Promise<void> {
  const udid = await resolveBootedSimulatorUdid(args);

  const logArgs = ['simctl', 'spawn', udid, 'log', 'stream', '--style', 'compact'];
  if (typeof args.level === 'string') logArgs.push('--level', args.level);

  const { buildLogPredicate } = await import('../core/simulators.js');
  let predicate: string | undefined;
  try {
    predicate = buildLogPredicate({
      processName: typeof args.processName === 'string' ? args.processName : undefined,
      subsystem: typeof args.subsystem === 'string' ? args.subsystem : undefined,
    });
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
  if (predicate) logArgs.push('--predicate', predicate);

  console.log(`Streaming logs from simulator ${udid}...`);
  if (predicate) console.log(`Filter: ${predicate}`);
  console.log('Press Ctrl+C to stop.\n');

  const child = spawn('xcrun', logArgs, { stdio: ['ignore', 'inherit', 'inherit'] });

  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      child.kill('SIGTERM');
      resolve();
    });
    child.on('close', () => resolve());
  });
}

export async function runSetupWizard(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (question: string, defaultValue = ''): Promise<string> =>
    new Promise((r) => {
      const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
      rl.question(prompt, (answer) => r(answer.trim() || defaultValue));
    });

  console.log('XcodeBazelMCP Setup\n');

  const workspacePath = await ask('Bazel workspace path', process.cwd());
  const bazelPath = await ask('Bazel binary path', 'bazel');
  const simulatorName = await ask('Default simulator name (optional)', '');
  const platform = await ask('Default platform (simulator/device)', 'simulator');
  const buildMode = await ask('Default build mode (none/debug/release)', 'none');

  rl.close();

  const configDir = join(resolve(workspacePath), '.xcodebazelmcp');
  const configPath = join(configDir, 'config.yaml');

  const lines = [
    `workspacePath: ${resolve(workspacePath)}`,
    `bazelPath: ${bazelPath}`,
  ];
  if (simulatorName) lines.push(`defaultSimulatorName: ${simulatorName}`);
  if (platform !== 'none') lines.push(`defaultPlatform: ${platform}`);
  if (buildMode !== 'none') lines.push(`defaultBuildMode: ${buildMode}`);

  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
  writeFileSync(configPath, lines.join('\n') + '\n');

  console.log(`\nConfig written to ${configPath}`);
  console.log('\nTo use with MCP, add this to your agent config (e.g. .mcp.json / mcp.json):');
  console.log(JSON.stringify({
    mcpServers: {
      XcodeBazelMCP: {
        command: 'npx',
        args: ['-y', 'xcodebazelmcp', 'mcp'],
        env: { BAZEL_IOS_WORKSPACE: resolve(workspacePath) },
      },
    },
  }, null, 2));
}
