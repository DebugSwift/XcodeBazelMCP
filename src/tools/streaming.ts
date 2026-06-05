import type {
  BuildAndRunArgs,
  BuildArgs,
  BuildMode,
  BuildPlatform,
  CommandResult,
  JsonObject,
  QueryArgs,
  TestArgs,
} from '../types/index.js';
import {
  asStringArray,
  buildCommandArgs,
  configArgs,
  modeArgs,
  platformArgs,
  requireLabel,
  runBazelStreaming,
  sanitizeQueryExpression,
  simulatorArgs,
  testFilterArgs,
} from '../core/bazel.js';
import { bootSimulatorIfNeeded, findAppBundle, installApp, launchApp, readBundleId, resolveSimulator } from '../core/simulators.js';
import { withTestSimulatorHooks } from '../core/test-simulator.js';
import { deployBuiltAppToDevice } from '../core/device-deploy.js';
import { swiftBuildStreaming, swiftTestStreaming, type SwiftBuildConfiguration } from '../core/swift-package.js';
import { getConfig } from '../runtime/config.js';
import { formatCommandResult, structuredCommandResult, toolResult, toolText } from '../utils/output.js';
import { applyDefaults, numberOrUndefined, prependWarning, stringOrUndefined } from './helpers.js';
import { callBazelTool } from './bazel-tools.js';

const STREAMING_TOOLS = new Set([
  'bazel_ios_build',
  'bazel_ios_build_and_run',
  'bazel_ios_device_build_and_run',
  'bazel_ios_device_test',
  'bazel_ios_test',
  'bazel_ios_query',
  'bazel_ios_clean',
  'bazel_macos_build',
  'bazel_macos_run',
  'bazel_macos_test',
  'bazel_macos_coverage',
  'bazel_tvos_build',
  'bazel_tvos_run',
  'bazel_tvos_test',
  'bazel_watchos_build',
  'bazel_watchos_run',
  'bazel_watchos_test',
  'bazel_visionos_build',
  'bazel_visionos_run',
  'bazel_visionos_test',
  'swift_package_build',
  'swift_package_test',
]);

export async function callBazelToolStreaming(
  name: string,
  args: JsonObject,
  onProgress: (chunk: string) => void,
) {
  args = applyDefaults(args);
  if (!STREAMING_TOOLS.has(name)) {
    return callBazelTool(name, args);
  }

  if (name === 'swift_package_build' || name === 'swift_package_test') {
    return streamSwiftPackageTool(name, args, onProgress);
  }

  const bazelArgs = buildStreamingBazelArgs(name, args);
  const startupArgs = asStringArray(args.startupArgs, 'startupArgs');
  const buildLike = [
    'bazel_ios_build', 'bazel_ios_build_and_run', 'bazel_ios_device_build_and_run', 'bazel_ios_test', 'bazel_ios_test_coverage',
    'bazel_macos_build', 'bazel_macos_run', 'bazel_macos_test',
    'bazel_tvos_build', 'bazel_tvos_run', 'bazel_tvos_test',
    'bazel_watchos_build', 'bazel_watchos_run', 'bazel_watchos_test',
    'bazel_visionos_build', 'bazel_visionos_run', 'bazel_visionos_test',
  ];
  const defaultTimeout = buildLike.includes(name) ? 1_800 : 600;
  const timeout = numberOrUndefined(args.timeoutSeconds) || defaultTimeout;

  const runStreaming = async (): Promise<CommandResult> => {
    let finalResult: CommandResult | undefined;
    for await (const chunk of runBazelStreaming(bazelArgs, timeout, startupArgs)) {
      if ('stream' in chunk) {
        onProgress(chunk.data);
      } else {
        finalResult = chunk;
      }
    }
    if (!finalResult) {
      throw new Error('Command produced no result.');
    }
    return finalResult;
  };

  let finalResult: CommandResult;
  let cleanupSummary: string | undefined;
  if (name === 'bazel_ios_test') {
    try {
      const wrapped = await withTestSimulatorHooks(args as TestArgs, runStreaming);
      finalResult = wrapped.result;
      cleanupSummary = wrapped.cleanupSummary;
    } catch (err) {
      return toolText((err as Error).message, true);
    }
  } else {
    try {
      finalResult = await runStreaming();
    } catch (err) {
      return toolText((err as Error).message, true);
    }
  }

  if (name === 'bazel_ios_build_and_run' && finalResult.exitCode === 0) {
    const platform = stringOrUndefined(args.platform) === 'device' ? 'device' : 'simulator';
    if (platform === 'device') {
      return deployBuiltAppToDevice({
        target: requireLabel(args.target),
        buildResult: finalResult,
        deviceId: stringOrUndefined(args.deviceId),
        deviceName: stringOrUndefined(args.deviceName),
        launchArgs: asStringArray(args.launchArgs, 'launchArgs'),
        launchEnv: (args.launchEnv as Record<string, string> | undefined) || {},
      });
    }
    return handleBuildAndRunPostBuild(args as BuildAndRunArgs, finalResult);
  }

  if (name === 'bazel_ios_device_build_and_run' && finalResult.exitCode === 0) {
    return deployBuiltAppToDevice({
      target: requireLabel(args.target),
      buildResult: finalResult,
      deviceId: stringOrUndefined(args.deviceId),
      deviceName: stringOrUndefined(args.deviceName),
      launchArgs: asStringArray(args.launchArgs, 'launchArgs'),
      launchEnv: (args.launchEnv as Record<string, string> | undefined) || {},
    });
  }

  const output = cleanupSummary
    ? `${formatCommandResult(finalResult)}\n\n${cleanupSummary}`
    : formatCommandResult(finalResult);
  return toolText(output, finalResult.exitCode !== 0);
}

async function streamSwiftPackageTool(
  name: string,
  args: JsonObject,
  onProgress: (chunk: string) => void,
) {
  const pkgPath = stringOrUndefined(args.packagePath) || getConfig().workspacePath;
  const generator = name === 'swift_package_build'
    ? swiftBuildStreaming({
        packagePath: pkgPath,
        configuration: stringOrUndefined(args.configuration) as SwiftBuildConfiguration | undefined,
        target: stringOrUndefined(args.target),
        extraArgs: asStringArray(args.extraArgs, 'extraArgs'),
        timeoutSeconds: numberOrUndefined(args.timeoutSeconds),
      })
    : swiftTestStreaming({
        packagePath: pkgPath,
        filter: stringOrUndefined(args.filter),
        configuration: stringOrUndefined(args.configuration) as SwiftBuildConfiguration | undefined,
        extraArgs: asStringArray(args.extraArgs, 'extraArgs'),
        timeoutSeconds: numberOrUndefined(args.timeoutSeconds),
      });

  let finalResult: CommandResult | undefined;
  for await (const chunk of generator) {
    if ('stream' in chunk) {
      onProgress(chunk.data);
    } else {
      finalResult = chunk;
    }
  }

  if (!finalResult) {
    return toolText('Command produced no result.', true);
  }
  return toolResult(
    formatCommandResult(finalResult),
    { ...structuredCommandResult(finalResult), packagePath: pkgPath },
    finalResult.exitCode !== 0,
  );
}

function buildStreamingBazelArgs(name: string, args: JsonObject): string[] {
  switch (name) {
    case 'bazel_ios_build': {
      return buildCommandArgs(args as BuildArgs);
    }
    case 'bazel_ios_build_and_run': {
      const platform = stringOrUndefined(args.platform) === 'device' ? 'device' : 'simulator';
      const a = { ...args, platform } as BuildArgs;
      return buildCommandArgs(a);
    }
    case 'bazel_ios_device_build_and_run': {
      const a = { ...args, platform: 'device' } as BuildArgs;
      return buildCommandArgs(a);
    }
    case 'bazel_ios_test': {
      const testArgs = args as TestArgs;
      const target = requireLabel(testArgs.target);
      const bazelArgs = [
        'test',
        '--test_output=errors',
        '--ios_multi_cpus=sim_arm64',
        ...simulatorArgs(testArgs),
        ...configArgs(testArgs.configs),
        ...asStringArray(testArgs.extraArgs, 'extraArgs'),
        ...testFilterArgs(testArgs.testFilter),
      ];
      bazelArgs.push(target);
      return bazelArgs;
    }
    case 'bazel_ios_query': {
      const queryArgs = args as QueryArgs;
      const expression = sanitizeQueryExpression(queryArgs.expression);
      const bazelArgs = ['query', ...asStringArray(queryArgs.extraArgs, 'extraArgs')];
      if (typeof queryArgs.output === 'string' && queryArgs.output.trim()) {
        if (!/^[A-Za-z0-9_-]+$/.test(queryArgs.output.trim())) {
          throw new Error(`Invalid output value: ${queryArgs.output}`);
        }
        bazelArgs.push(`--output=${queryArgs.output.trim()}`);
      }
      bazelArgs.push(expression);
      return bazelArgs;
    }
    case 'bazel_ios_clean': {
      const cleanArgs = ['clean'];
      if (args.expunge === true) cleanArgs.push('--expunge');
      return cleanArgs;
    }
    case 'bazel_ios_device_test': {
      const testArgs = args as TestArgs;
      const target = requireLabel(testArgs.target);
      const bazelArgs = [
        'test',
        '--test_output=errors',
        '--ios_multi_cpus=arm64',
        ...configArgs(testArgs.configs),
        ...asStringArray(testArgs.extraArgs, 'extraArgs'),
        ...testFilterArgs(testArgs.testFilter),
      ];
      bazelArgs.push(target);
      return bazelArgs;
    }
    case 'bazel_macos_coverage': {
      const testArgs = args as TestArgs;
      const target = requireLabel(testArgs.target);
      const bazelArgs = [
        'coverage',
        ...configArgs(testArgs.configs),
        ...asStringArray(testArgs.extraArgs, 'extraArgs'),
        ...testFilterArgs(testArgs.testFilter),
      ];
      bazelArgs.push(target);
      return bazelArgs;
    }
    case 'bazel_macos_build': {
      const a = { ...args, platform: 'macos' } as BuildArgs;
      return buildCommandArgs(a);
    }
    case 'bazel_macos_run': {
      const target = requireLabel(args.target);
      const bazelArgs = [
        'run',
        ...modeArgs(args.buildMode as BuildMode | undefined),
        ...configArgs(args.configs),
        ...asStringArray(args.extraArgs, 'extraArgs'),
        target,
      ];
      const runArgsList = asStringArray(args.runArgs, 'runArgs');
      if (runArgsList.length > 0) {
        bazelArgs.push('--', ...runArgsList);
      }
      return bazelArgs;
    }
    case 'bazel_macos_test': {
      const testArgs = args as TestArgs;
      const target = requireLabel(testArgs.target);
      const bazelArgs = [
        'test',
        '--test_output=errors',
        ...configArgs(testArgs.configs),
        ...asStringArray(testArgs.extraArgs, 'extraArgs'),
        ...testFilterArgs(testArgs.testFilter),
      ];
      bazelArgs.push(target);
      return bazelArgs;
    }
    case 'bazel_tvos_build':
    case 'bazel_watchos_build':
    case 'bazel_visionos_build': {
      const plat = name.replace('bazel_', '').replace('_build', '') as BuildPlatform;
      const a = { ...args, platform: plat } as BuildArgs;
      return buildCommandArgs(a);
    }
    case 'bazel_tvos_run':
    case 'bazel_watchos_run':
    case 'bazel_visionos_run': {
      const target = requireLabel(args.target);
      const plat = name.replace('bazel_', '').replace('_run', '') as BuildPlatform;
      const bazelArgs = [
        'run',
        ...modeArgs(args.buildMode as BuildMode | undefined),
        ...platformArgs(plat),
        ...configArgs(args.configs),
        ...asStringArray(args.extraArgs, 'extraArgs'),
        target,
      ];
      const runArgsList = asStringArray(args.runArgs, 'runArgs');
      if (runArgsList.length > 0) {
        bazelArgs.push('--', ...runArgsList);
      }
      return bazelArgs;
    }
    case 'bazel_tvos_test':
    case 'bazel_watchos_test':
    case 'bazel_visionos_test': {
      const testArgs = args as TestArgs;
      const target = requireLabel(testArgs.target);
      const plat = name.replace('bazel_', '').replace('_test', '') as BuildPlatform;
      const bazelArgs = [
        'test',
        '--test_output=errors',
        ...platformArgs(plat),
        ...configArgs(testArgs.configs),
        ...asStringArray(testArgs.extraArgs, 'extraArgs'),
        ...testFilterArgs(testArgs.testFilter),
      ];
      bazelArgs.push(target);
      return bazelArgs;
    }
    default:
      throw new Error(`Streaming not supported for ${name}`);
  }
}

async function handleBuildAndRunPostBuild(
  args: BuildAndRunArgs,
  buildResult: CommandResult,
) {
  const config = getConfig();
  const appPath = findAppBundle(config.workspacePath, requireLabel(args.target));
  if (!appPath) {
    return toolText(
      `${formatCommandResult(buildResult)}\n\nBuild succeeded but .app bundle not found in bazel-bin.`,
      true,
    );
  }

  const { device: simulator, warning: simWarning } = await resolveSimulator({
    simulatorId: stringOrUndefined(args.simulatorId),
    simulatorName: stringOrUndefined(args.simulatorName),
  });

  const bootResult = await bootSimulatorIfNeeded(simulator);
  if (bootResult && bootResult.exitCode !== 0) {
    return toolText(
      `${formatCommandResult(buildResult)}\n\nBoot failed:\n${formatCommandResult(bootResult)}`,
      true,
    );
  }

  const installResult = await installApp(simulator.udid, appPath);
  if (installResult.exitCode !== 0) {
    return toolText(
      `${formatCommandResult(buildResult)}\n\nInstall failed:\n${formatCommandResult(installResult)}`,
      true,
    );
  }

  let bundleId: string;
  try {
    bundleId = readBundleId(appPath);
  } catch (err) {
    return toolText(
      `${formatCommandResult(buildResult)}\n\nBuild and install succeeded but failed to read bundle ID: ${(err as Error).message}`,
      true,
    );
  }
  const launchResult = await launchApp(
    simulator.udid,
    bundleId,
    asStringArray(args.launchArgs, 'launchArgs'),
    (args.launchEnv as Record<string, string> | undefined) || {},
  );

  const lines = [
    formatCommandResult(buildResult),
    '',
    `App: ${appPath}`,
    `Bundle ID: ${bundleId}`,
    `Simulator: ${simulator.name} (${simulator.udid})`,
    bootResult ? `Boot: OK` : `Boot: already booted`,
    `Install: ${installResult.exitCode === 0 ? 'OK' : 'FAILED'}`,
    `Launch: ${launchResult.exitCode === 0 ? 'OK' : 'FAILED'}`,
  ];
  if (launchResult.output.trim()) {
    lines.push('', launchResult.output.trim());
  }

  return toolText(prependWarning(lines.join('\n'), simWarning), launchResult.exitCode !== 0);
}

