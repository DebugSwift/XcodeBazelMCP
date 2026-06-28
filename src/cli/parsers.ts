import type { BuildAndRunArgs, BuildArgs, JsonObject, TestArgs } from '../types/index.js';

function append(value: unknown, next: string): string[] {
  return [...(Array.isArray(value) ? (value as string[]) : []), next];
}

function appendEnv(existing: unknown, pair: string | undefined): Record<string, string> {
  const env = (existing as Record<string, string>) ?? {};
  const eq = pair?.indexOf('=') ?? -1;
  if (pair && eq > 0) env[pair.slice(0, eq)] = pair.slice(eq + 1);
  return env;
}

export function parseDiscover(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--scope') parsed.scope = args[++index];
    else if (arg === '--kind') parsed.kind = args[++index];
    else if (arg === '--arg') parsed.extraArgs = append(parsed.extraArgs, args[++index]);
    else if (arg === '--startup-arg') parsed.startupArgs = append(parsed.startupArgs, args[++index]);
  }
  return parsed;
}

export function parseSimSelector(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--simulator-id') parsed.simulatorId = args[++index];
    else if (arg === '--simulator-name') parsed.simulatorName = args[++index];
  }
  return parsed;
}

export function parseLongPress(args: string[]): JsonObject {
  const parsed: JsonObject = { x: Number(args[0]), y: Number(args[1]) };
  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--duration') parsed.durationSeconds = Number(args[++i]);
    else if (args[i] === '--simulator-id') parsed.simulatorId = args[++i];
    else if (args[i] === '--simulator-name') parsed.simulatorName = args[++i];
  }
  return parsed;
}

export function parseSwipe(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  const dir = args.find((a) => ['up', 'down', 'left', 'right'].includes(a));
  if (dir) parsed.direction = dir;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--direction') parsed.direction = args[++i];
    else if (args[i] === '--x') parsed.x = Number(args[++i]);
    else if (args[i] === '--y') parsed.y = Number(args[++i]);
    else if (args[i] === '--distance') parsed.distance = Number(args[++i]);
    else if (args[i] === '--velocity') parsed.velocity = Number(args[++i]);
    else if (args[i] === '--simulator-id') parsed.simulatorId = args[++i];
    else if (args[i] === '--simulator-name') parsed.simulatorName = args[++i];
  }
  return parsed;
}

export function parsePinch(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--x') parsed.x = Number(args[++i]);
    else if (args[i] === '--y') parsed.y = Number(args[++i]);
    else if (args[i] === '--scale') parsed.scale = Number(args[++i]);
    else if (args[i] === '--velocity') parsed.velocity = Number(args[++i]);
    else if (args[i] === '--simulator-id') parsed.simulatorId = args[++i];
    else if (args[i] === '--simulator-name') parsed.simulatorName = args[++i];
  }
  return parsed;
}

export function parseDrag(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from-x') parsed.fromX = Number(args[++i]);
    else if (args[i] === '--from-y') parsed.fromY = Number(args[++i]);
    else if (args[i] === '--to-x') parsed.toX = Number(args[++i]);
    else if (args[i] === '--to-y') parsed.toY = Number(args[++i]);
    else if (args[i] === '--duration') parsed.durationSeconds = Number(args[++i]);
    else if (args[i] === '--simulator-id') parsed.simulatorId = args[++i];
    else if (args[i] === '--simulator-name') parsed.simulatorName = args[++i];
  }
  return parsed;
}

export function parseSimErase(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  const positional = args.find((arg) => !arg.startsWith('--'));
  if (positional) parsed.simulatorId = positional;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--simulator-id') parsed.simulatorId = args[++index];
  }
  return parsed;
}

export function parseSimShutdown(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--simulator-id') parsed.simulatorId = args[++index];
    else if (arg === '--all') parsed.all = true;
  }
  return parsed;
}

export function parseSimLocation(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--simulator-id') parsed.simulatorId = args[++index];
    else if (arg === '--simulator-name') parsed.simulatorName = args[++index];
    else if (arg === '--latitude' || arg === '--lat') parsed.latitude = Number(args[++index]);
    else if (arg === '--longitude' || arg === '--lon') parsed.longitude = Number(args[++index]);
  }
  return parsed;
}

export function parseSimAppearance(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--simulator-id') parsed.simulatorId = args[++index];
    else if (arg === '--simulator-name') parsed.simulatorName = args[++index];
    else if (arg === '--appearance') parsed.appearance = args[++index];
    else if (arg === 'light' || arg === 'dark') parsed.appearance = arg;
  }
  return parsed;
}

export function parseBuildAndRun(args: string[]): BuildAndRunArgs {
  const parsed: BuildAndRunArgs = { buildMode: 'none', platform: 'simulator' };
  const target = args.find((arg) => !arg.startsWith('--'));
  if (target) parsed.target = target;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--debug') parsed.buildMode = 'debug';
    else if (arg === '--release') parsed.buildMode = 'release';
    else if (arg === '--release-with-symbols') parsed.buildMode = 'release_with_symbols';
    else if (arg === '--simulator-name') parsed.simulatorName = args[++index];
    else if (arg === '--simulator-version') parsed.simulatorVersion = args[++index];
    else if (arg === '--simulator-id') parsed.simulatorId = args[++index];
    else if (arg === '--config') parsed.configs = append(parsed.configs, args[++index]);
    else if (arg === '--arg') parsed.extraArgs = append(parsed.extraArgs, args[++index]);
    else if (arg === '--startup-arg') parsed.startupArgs = append(parsed.startupArgs, args[++index]);
    else if (arg === '--launch-arg') parsed.launchArgs = append(parsed.launchArgs, args[++index]);
    else if (arg === '--stream') (parsed as JsonObject).streaming = true;
  }
  return parsed;
}

export function parseInstall(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  const appPath = args.find((arg) => !arg.startsWith('--'));
  if (appPath) parsed.appPath = appPath;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--simulator-id') parsed.simulatorId = args[++index];
    else if (arg === '--simulator-name') parsed.simulatorName = args[++index];
  }
  return parsed;
}

export function parseLaunch(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  const bundleId = args.find((arg) => !arg.startsWith('--'));
  if (bundleId) parsed.bundleId = bundleId;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--simulator-id') parsed.simulatorId = args[++index];
    else if (arg === '--simulator-name') parsed.simulatorName = args[++index];
    else if (arg === '--launch-arg') parsed.launchArgs = append(parsed.launchArgs, args[++index]);
    else if (arg === '--launch-env') parsed.launchEnv = appendEnv(parsed.launchEnv, args[++index]);
  }
  return parsed;
}

export function parseBuild(args: string[]): BuildArgs {
  const parsed: BuildArgs = { buildMode: 'none', platform: 'none' };
  const target = args.find((arg) => !arg.startsWith('--'));
  if (target) parsed.target = target;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--debug') parsed.buildMode = 'debug';
    else if (arg === '--release') parsed.buildMode = 'release';
    else if (arg === '--release-with-symbols') parsed.buildMode = 'release_with_symbols';
    else if (arg === '--simulator') parsed.platform = 'simulator';
    else if (arg === '--device') parsed.platform = 'device';
    else if (arg === '--simulator-name') parsed.simulatorName = args[++index];
    else if (arg === '--simulator-version') parsed.simulatorVersion = args[++index];
    else if (arg === '--config') parsed.configs = append(parsed.configs, args[++index]);
    else if (arg === '--arg') parsed.extraArgs = append(parsed.extraArgs, args[++index]);
    else if (arg === '--startup-arg') parsed.startupArgs = append(parsed.startupArgs, args[++index]);
    else if (arg === '--stream') (parsed as JsonObject).streaming = true;
  }
  return parsed;
}

export function parseTest(args: string[]): TestArgs {
  const parsed: TestArgs = {};
  const target = args.find((arg) => !arg.startsWith('--'));
  if (target) parsed.target = target;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--filter') parsed.testFilter = args[++index];
    else if (arg === '--simulator-name') parsed.simulatorName = args[++index];
    else if (arg === '--simulator-version') parsed.simulatorVersion = args[++index];
    else if (arg === '--config') parsed.configs = append(parsed.configs, args[++index]);
    else if (arg === '--arg') parsed.extraArgs = append(parsed.extraArgs, args[++index]);
    else if (arg === '--startup-arg') parsed.startupArgs = append(parsed.startupArgs, args[++index]);
    else if (arg === '--stream') (parsed as JsonObject).streaming = true;
    else if (arg === '--minimize-simulator') parsed.minimizeSimulator = true;
    else if (arg === '--shutdown-simulator') parsed.shutdownSimulatorAfterTest = true;
  }
  return parsed;
}

export function parseQuery(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  const expressionParts: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--output') parsed.output = args[++index];
    else if (arg === '--arg') parsed.extraArgs = append(parsed.extraArgs, args[++index]);
    else if (arg === '--startup-arg') parsed.startupArgs = append(parsed.startupArgs, args[++index]);
    else expressionParts.push(arg);
  }
  parsed.expression = expressionParts.join(' ');
  return parsed;
}

export function parseDeps(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  const target = args.find((arg) => !arg.startsWith('--'));
  if (target) parsed.target = target;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--depth') parsed.depth = Number(args[++index]);
    else if (arg === '--startup-arg') parsed.startupArgs = append(parsed.startupArgs, args[++index]);
  }
  return parsed;
}

export function parseRdeps(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  const target = args.find((arg) => !arg.startsWith('--'));
  if (target) parsed.target = target;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--scope') parsed.scope = args[++index];
    else if (arg === '--startup-arg') parsed.startupArgs = append(parsed.startupArgs, args[++index]);
  }
  return parsed;
}

export function parseTargetInfo(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  const target = args.find((arg) => !arg.startsWith('--'));
  if (target) parsed.target = target;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--startup-arg') parsed.startupArgs = append(parsed.startupArgs, args[++index]);
  }
  return parsed;
}

export function parseStopApp(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  const positional = args.find((arg) => !arg.startsWith('--'));
  if (positional) parsed.bundleId = positional;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--simulator-id') parsed.simulatorId = args[++index];
    else if (arg === '--simulator-name') parsed.simulatorName = args[++index];
  }
  return parsed;
}

export function parseScreenshot(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  const positional = args.find((arg) => !arg.startsWith('--'));
  if (positional) parsed.outputPath = positional;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--simulator-id') parsed.simulatorId = args[++index];
    else if (arg === '--simulator-name') parsed.simulatorName = args[++index];
    else if (arg === '--mask') parsed.mask = args[++index];
    else if (arg === '-o' || arg === '--output') parsed.outputPath = args[++index];
  }
  return parsed;
}

export function parseVideoStart(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  const positional = args.find((arg) => !arg.startsWith('--'));
  if (positional) parsed.outputPath = positional;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--simulator-id') parsed.simulatorId = args[++index];
    else if (arg === '--simulator-name') parsed.simulatorName = args[++index];
    else if (arg === '-o' || arg === '--output') parsed.outputPath = args[++index];
  }
  return parsed;
}

export function parseStatusBar(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--simulator-id') parsed.simulatorId = args[++index];
    else if (arg === '--simulator-name') parsed.simulatorName = args[++index];
    else if (arg === '--time') parsed.time = args[++index];
    else if (arg === '--battery-level') parsed.batteryLevel = Number(args[++index]);
    else if (arg === '--battery-state') parsed.batteryState = args[++index];
    else if (arg === '--network') parsed.networkType = args[++index];
    else if (arg === '--operator') parsed.operatorName = args[++index];
    else if (arg === '--wifi-bars') parsed.wifiBars = Number(args[++index]);
    else if (arg === '--cellular-bars') parsed.cellularBars = Number(args[++index]);
    else if (arg === '--clear') parsed.clear = true;
  }
  return parsed;
}

export function parsePrivacy(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  const positional = args.filter((arg) => !arg.startsWith('--'));
  if (positional[0]) parsed.action = positional[0];
  if (positional[1]) parsed.service = positional[1];
  if (positional[2]) parsed.bundleId = positional[2];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--simulator-id') parsed.simulatorId = args[++index];
    else if (arg === '--simulator-name') parsed.simulatorName = args[++index];
  }
  return parsed;
}

export function parsePush(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  const positional = args.find((arg) => !arg.startsWith('--'));
  if (positional) parsed.bundleId = positional;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--simulator-id') parsed.simulatorId = args[++index];
    else if (arg === '--simulator-name') parsed.simulatorName = args[++index];
    else if (arg === '--title') parsed.title = args[++index];
    else if (arg === '--body') parsed.body = args[++index];
    else if (arg === '--badge') parsed.badge = Number(args[++index]);
    else if (arg === '--payload') parsed.payloadPath = args[++index];
  }
  return parsed;
}

export function parseLogStart(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--simulator-id') parsed.simulatorId = args[++index];
    else if (arg === '--simulator-name') parsed.simulatorName = args[++index];
    else if (arg === '--process') parsed.processName = args[++index];
    else if (arg === '--subsystem') parsed.subsystem = args[++index];
    else if (arg === '--level') parsed.level = args[++index];
  }
  return parsed;
}

export function parseSetDefaults(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--target') parsed.target = args[++index];
    else if (arg === '--simulator-name') parsed.simulatorName = args[++index];
    else if (arg === '--simulator-id') parsed.simulatorId = args[++index];
    else if (arg === '--build-mode') parsed.buildMode = args[++index];
    else if (arg === '--platform') parsed.platform = args[++index];
    else if (arg === '--profile') parsed.profile = args[++index];
    else if (arg === '--clear') parsed.clear = true;
  }
  return parsed;
}

export function parseScaffold(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  const positional = args.filter((arg) => !arg.startsWith('--'));
  if (positional[0]) parsed.template = positional[0];
  if (positional[1]) parsed.name = positional[1];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--template') parsed.template = args[++index];
    else if (arg === '--name') parsed.name = args[++index];
    else if (arg === '--output' || arg === '-o') parsed.outputPath = args[++index];
    else if (arg === '--bundle-id') parsed.bundleId = args[++index];
    else if (arg === '--minimum-os') parsed.minimumOs = args[++index];
    else if (arg === '--rules-version') parsed.rulesVersion = args[++index];
    else if (arg === '--bazel-version') parsed.bazelVersion = args[++index];
    else if (arg === '--family') parsed.families = append(parsed.families, args[++index]);
  }
  if (!parsed.outputPath && parsed.name) {
    parsed.outputPath = parsed.name;
  }
  return parsed;
}

export function parseSpmPath(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--path' || arg === '--package-path') parsed.packagePath = args[++index];
    else if (!arg.startsWith('--') && !parsed.packagePath) parsed.packagePath = arg;
  }
  return parsed;
}

export function parseSpmBuild(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--path' || arg === '--package-path') parsed.packagePath = args[++index];
    else if (arg === '--release' || (arg === '-c' && args[index + 1] === 'release')) { parsed.configuration = 'release'; if (arg === '-c') index++; }
    else if (arg === '--debug' || (arg === '-c' && args[index + 1] === 'debug')) { parsed.configuration = 'debug'; if (arg === '-c') index++; }
    else if (arg === '--target') parsed.target = args[++index];
    else if (arg === '--arg') parsed.extraArgs = append(parsed.extraArgs, args[++index]);
    else if (arg === '--stream') parsed.streaming = true;
  }
  return parsed;
}

export function parseSpmTest(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--path' || arg === '--package-path') parsed.packagePath = args[++index];
    else if (arg === '--filter') parsed.filter = args[++index];
    else if (arg === '--release' || (arg === '-c' && args[index + 1] === 'release')) { parsed.configuration = 'release'; if (arg === '-c') index++; }
    else if (arg === '--debug' || (arg === '-c' && args[index + 1] === 'debug')) { parsed.configuration = 'debug'; if (arg === '-c') index++; }
    else if (arg === '--arg') parsed.extraArgs = append(parsed.extraArgs, args[++index]);
    else if (arg === '--stream') parsed.streaming = true;
  }
  return parsed;
}

export function parseSpmRun(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--path' || arg === '--package-path') parsed.packagePath = args[++index];
    else if (arg === '--release' || (arg === '-c' && args[index + 1] === 'release')) { parsed.configuration = 'release'; if (arg === '-c') index++; }
    else if (arg === '--debug' || (arg === '-c' && args[index + 1] === 'debug')) { parsed.configuration = 'debug'; if (arg === '-c') index++; }
    else if (arg === '--arg') parsed.extraArgs = append(parsed.extraArgs, args[++index]);
    else if (arg === '--run-arg') parsed.runArgs = append(parsed.runArgs, args[++index]);
    else if (arg === '--stream') parsed.streaming = true;
    // First bare token (not a flag, not a flag value consumed above) is the executable.
    else if (!arg.startsWith('-') && parsed.executable === undefined) parsed.executable = arg;
  }
  return parsed;
}

export function parseSpmInit(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--path' || arg === '--package-path') parsed.packagePath = args[++index];
    else if (arg === '--type') parsed.type = args[++index];
    else if (arg === '--name') parsed.name = args[++index];
    else if (!arg.startsWith('--') && !parsed.type) parsed.type = arg;
  }
  return parsed;
}

export function parseMacosBuild(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  const target = args.find((arg) => !arg.startsWith('--'));
  if (target) parsed.target = target;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--debug') parsed.buildMode = 'debug';
    else if (arg === '--release') parsed.buildMode = 'release';
    else if (arg === '--release-with-symbols') parsed.buildMode = 'release_with_symbols';
    else if (arg === '--config') parsed.configs = append(parsed.configs, args[++index]);
    else if (arg === '--arg') parsed.extraArgs = append(parsed.extraArgs, args[++index]);
    else if (arg === '--startup-arg') parsed.startupArgs = append(parsed.startupArgs, args[++index]);
    else if (arg === '--stream') parsed.streaming = true;
  }
  return parsed;
}

export function parseMacosRun(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  const target = args.find((arg) => !arg.startsWith('--'));
  if (target) parsed.target = target;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--debug') parsed.buildMode = 'debug';
    else if (arg === '--release') parsed.buildMode = 'release';
    else if (arg === '--config') parsed.configs = append(parsed.configs, args[++index]);
    else if (arg === '--arg') parsed.extraArgs = append(parsed.extraArgs, args[++index]);
    else if (arg === '--startup-arg') parsed.startupArgs = append(parsed.startupArgs, args[++index]);
    else if (arg === '--run-arg') parsed.runArgs = append(parsed.runArgs, args[++index]);
    else if (arg === '--stream') parsed.streaming = true;
  }
  return parsed;
}

export function parseMacosTest(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  const target = args.find((arg) => !arg.startsWith('--'));
  if (target) parsed.target = target;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--filter') parsed.testFilter = args[++index];
    else if (arg === '--config') parsed.configs = append(parsed.configs, args[++index]);
    else if (arg === '--arg') parsed.extraArgs = append(parsed.extraArgs, args[++index]);
    else if (arg === '--startup-arg') parsed.startupArgs = append(parsed.startupArgs, args[++index]);
    else if (arg === '--stream') parsed.streaming = true;
  }
  return parsed;
}

export function parseMacosDiscover(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--scope') parsed.scope = args[++index];
    else if (arg === '--kind') parsed.kind = args[++index];
    else if (arg === '--arg') parsed.extraArgs = append(parsed.extraArgs, args[++index]);
    else if (arg === '--startup-arg') parsed.startupArgs = append(parsed.startupArgs, args[++index]);
  }
  return parsed;
}

export function parsePlatformBuild(args: string[]): JsonObject {
  return parseMacosBuild(args);
}

export function parsePlatformRun(args: string[]): JsonObject {
  return parseMacosRun(args);
}

export function parsePlatformTest(args: string[]): JsonObject {
  return parseMacosTest(args);
}

export function parsePlatformDiscover(args: string[]): JsonObject {
  return parseMacosDiscover(args);
}

export function parseLldbAttach(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--pid') parsed.pid = Number(args[++index]);
    else if (arg === '--name') parsed.processName = args[++index];
    else if (arg === '--wait') parsed.waitFor = true;
    else if (arg === '--device') parsed.target = 'device';
    else if (/^\d+$/.test(arg) && !parsed.pid) parsed.pid = Number(arg);
    else if (!parsed.processName && !arg.startsWith('--')) parsed.processName = arg;
  }
  return parsed;
}

export function parseLldbBreakpoint(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  const positionalAction = args.find((a) => ['set', 'delete', 'list'].includes(a));
  if (positionalAction) parsed.action = positionalAction;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--session') parsed.sessionId = args[++index];
    else if (arg === '--file') parsed.file = args[++index];
    else if (arg === '--line') parsed.line = Number(args[++index]);
    else if (arg === '--symbol') parsed.symbol = args[++index];
    else if (arg === '--module') parsed.module = args[++index];
    else if (arg === '--condition') parsed.condition = args[++index];
    else if (arg === '--one-shot') parsed.oneShot = true;
    else if (arg === '--id') parsed.breakpointId = Number(args[++index]);
  }
  return parsed;
}

export function parseLldbVars(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  if (args[0] && !args[0].startsWith('--')) parsed.sessionId = args[0];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--scope') parsed.scope = args[++index];
    else if (arg === '--session') parsed.sessionId = args[++index];
  }
  return parsed;
}

export function parseLldbThreads(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  if (args[0] && !args[0].startsWith('--')) parsed.sessionId = args[0];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--select-thread') parsed.selectThread = Number(args[++index]);
    else if (arg === '--select-frame') parsed.selectFrame = Number(args[++index]);
    else if (arg === '--session') parsed.sessionId = args[++index];
  }
  return parsed;
}

export function parseDeviceSelector(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--device-id') parsed.deviceId = args[++index];
    else if (arg === '--device-name') parsed.deviceName = args[++index];
  }
  return parsed;
}

export function parseDeviceBuildAndRun(args: string[]): JsonObject {
  const parsed: JsonObject = { platform: 'device' };
  const target = args.find((arg) => !arg.startsWith('--'));
  if (target) parsed.target = target;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--debug') parsed.buildMode = 'debug';
    else if (arg === '--release') parsed.buildMode = 'release';
    else if (arg === '--release-with-symbols') parsed.buildMode = 'release_with_symbols';
    else if (arg === '--device-id') parsed.deviceId = args[++index];
    else if (arg === '--device-name') parsed.deviceName = args[++index];
    else if (arg === '--config') parsed.configs = append(parsed.configs, args[++index]);
    else if (arg === '--arg') parsed.extraArgs = append(parsed.extraArgs, args[++index]);
    else if (arg === '--startup-arg') parsed.startupArgs = append(parsed.startupArgs, args[++index]);
    else if (arg === '--launch-arg') parsed.launchArgs = append(parsed.launchArgs, args[++index]);
    else if (arg === '--launch-env') parsed.launchEnv = appendEnv(parsed.launchEnv, args[++index]);
    else if (arg === '--stream') parsed.streaming = true;
  }
  return parsed;
}

export function parseDeviceInstall(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  const appPath = args.find((arg) => !arg.startsWith('--'));
  if (appPath) parsed.appPath = appPath;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--device-id') parsed.deviceId = args[++index];
    else if (arg === '--device-name') parsed.deviceName = args[++index];
  }
  return parsed;
}

export function parseDeviceLaunch(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  const bundleId = args.find((arg) => !arg.startsWith('--'));
  if (bundleId) parsed.bundleId = bundleId;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--device-id') parsed.deviceId = args[++index];
    else if (arg === '--device-name') parsed.deviceName = args[++index];
    else if (arg === '--launch-arg') parsed.launchArgs = append(parsed.launchArgs, args[++index]);
    else if (arg === '--launch-env') parsed.launchEnv = appendEnv(parsed.launchEnv, args[++index]);
  }
  return parsed;
}

export function parseDeviceStop(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  const positional = args.find((arg) => !arg.startsWith('--'));
  if (positional) parsed.bundleId = positional;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--device-id') parsed.deviceId = args[++index];
    else if (arg === '--device-name') parsed.deviceName = args[++index];
  }
  return parsed;
}

export function parseDeviceTest(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  const target = args.find((arg) => !arg.startsWith('--'));
  if (target) parsed.target = target;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--device-id') parsed.deviceId = args[++index];
    else if (arg === '--device-name') parsed.deviceName = args[++index];
    else if (arg === '--filter') parsed.testFilter = args[++index];
    else if (arg === '--config') parsed.configs = append(parsed.configs, args[++index]);
    else if (arg === '--stream') parsed.streaming = true;
    else if (arg === '--timeout') parsed.timeoutSeconds = Number(args[++index]);
  }
  return parsed;
}

export function parseDeviceScreenshot(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  const positional = args.find((arg) => !arg.startsWith('--'));
  if (positional) parsed.outputPath = positional;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--device-id') parsed.deviceId = args[++index];
    else if (arg === '--device-name') parsed.deviceName = args[++index];
  }
  return parsed;
}

export function parseMacosLaunch(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  const positional = args.find((arg) => !arg.startsWith('--'));
  if (positional) {
    if (positional.startsWith('//')) parsed.target = positional;
    else parsed.appPath = positional;
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--app-path') parsed.appPath = args[++index];
    else if (arg === '--target') parsed.target = args[++index];
    else if (arg === '--launch-arg') parsed.launchArgs = append(parsed.launchArgs, args[++index]);
  }
  return parsed;
}

export function parseMacosStop(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  const positional = args.find((arg) => !arg.startsWith('--'));
  if (positional) parsed.bundleId = positional;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--process') parsed.processName = args[++index];
  }
  return parsed;
}

export function parseMacosInstall(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  const positional = args.find((arg) => !arg.startsWith('--'));
  if (positional) {
    if (positional.startsWith('//')) parsed.target = positional;
    else parsed.appPath = positional;
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--destination') parsed.destination = args[++index];
  }
  return parsed;
}

export function parseMacosLog(args: string[]): JsonObject {
  const parsed: JsonObject = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--process') parsed.processName = args[++index];
    else if (arg === '--level') parsed.level = args[++index];
    else if (arg === '--timeout') parsed.timeoutSeconds = Number(args[++index]);
  }
  return parsed;
}
