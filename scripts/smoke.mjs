import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const required = [
  'package.json',
  'server.json',
  'tsup.config.ts',
  'src/cli.ts',
  'src/doctor-cli.ts',
  'src/server/index.ts',
  'src/mcp/server.ts',
  'src/tools/bazel-tools.ts',
  'src/core/bazel.ts',
];

for (const file of required) {
  if (!existsSync(join(root, file))) {
    throw new Error(`Missing required file: ${file}`);
  }
}

const handlersDir = join(root, 'src/tools/handlers');
const handlerFiles = ['build.ts', 'session.ts', 'simulator.ts', 'device.ts'];
const allHandlerContent = handlerFiles
  .map((f) => readFileSync(join(handlersDir, f), 'utf8'))
  .join('\n');
for (const toolName of ['bazel_ios_build', 'bazel_ios_test', 'bazel_ios_discover_targets']) {
  if (!allHandlerContent.includes(toolName)) {
    throw new Error(`Missing tool: ${toolName}`);
  }
}

// Runtime smoke: boot the CLI (no Bazel/Xcode needed) and exercise scaffolding.
const cli = join(root, 'src/cli.ts');
const runCli = (args) =>
  execFileSync('npx', ['tsx', cli, ...args], { cwd: root, encoding: 'utf8', timeout: 60_000 });

const toolsOut = runCli(['tools']);
const toolCount = toolsOut.split('\n').filter((l) => /^[a-z_]+$/.test(l)).length;
if (toolCount !== 125) {
  throw new Error(`Expected 125 tools, CLI listed ${toolCount}`);
}
for (const t of ['bazel_ios_uninstall_app', 'bazel_ios_device_uninstall_app', 'bazel_ios_device_list_apps']) {
  if (!toolsOut.includes(t)) throw new Error(`tools output missing ${t}`);
}

const scaffoldDir = mkdtempSync(join(tmpdir(), 'xbmcp-smoke-'));
try {
  runCli(['new', 'ios_app', 'SmokeApp', '-o', scaffoldDir]);
  for (const f of ['MODULE.bazel', '.bazelrc', 'SmokeApp/BUILD.bazel', 'SmokeApp/Info.plist']) {
    if (!existsSync(join(scaffoldDir, f))) throw new Error(`scaffold missing ${f}`);
  }
} finally {
  rmSync(scaffoldDir, { recursive: true, force: true });
}

console.log('smoke ok');
