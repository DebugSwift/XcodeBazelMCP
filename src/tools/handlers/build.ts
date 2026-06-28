import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  asStringArray,
  buildCommandArgs,
  configArgs,
  discoverExpression,
  iosSimulatorCpuArg,
  parseTargetLabels,
  requireLabel,
  runBazel,
  sanitizeQueryExpression,
  simulatorArgs,
  testFilterArgs,
} from '../../core/bazel.js';
import { withTestSimulatorHooks } from '../../core/test-simulator.js';
import { deployBuiltAppToDevice } from '../../core/device-deploy.js';
import {
  bootSimulatorIfNeeded,
  findAppBundle,
  installApp,
  launchApp,
  readBundleId,
} from '../../core/simulators.js';
import { getConfig } from '../../runtime/config.js';
import type {
  BuildAndRunArgs,
  BuildArgs,
  JsonObject,
  QueryArgs,
  TargetKind,
  TestArgs,
  ToolCallResult,
  ToolDefinition,
} from '../../types/index.js';
import { formatCommandResult, structuredCommandResult, toolResult, toolText } from '../../utils/output.js';
import { numberOrUndefined, prependWarning, resolveSimulatorFromArgs, stringOrUndefined } from '../helpers.js';
import { STREAMING_PROPERTY } from '../schema-constants.js';

interface LcovFile { name: string; total: number; covered: number }

function parseLcovSummary(lcov: string): { totalLines: number; coveredLines: number; files: LcovFile[] } {
  const files: LcovFile[] = [];
  let currentFile = '';
  let fileLH = 0;
  let fileLF = 0;
  let totalLines = 0;
  let coveredLines = 0;

  for (const line of lcov.split('\n')) {
    if (line.startsWith('SF:')) {
      currentFile = line.slice(3);
      fileLH = 0;
      fileLF = 0;
    } else if (line.startsWith('LF:')) {
      fileLF = parseInt(line.slice(3), 10) || 0;
    } else if (line.startsWith('LH:')) {
      fileLH = parseInt(line.slice(3), 10) || 0;
    } else if (line === 'end_of_record') {
      if (currentFile) {
        files.push({ name: currentFile, total: fileLF, covered: fileLH });
        totalLines += fileLF;
        coveredLines += fileLH;
      }
      currentFile = '';
    }
  }
  files.sort((a, b) => {
    const aPct = a.total > 0 ? a.covered / a.total : 0;
    const bPct = b.total > 0 ? b.covered / b.total : 0;
    return aPct - bPct;
  });
  return { totalLines, coveredLines, files };
}

export const definitions: ToolDefinition[] = [
  {
    name: 'bazel_ios_build',
    description: 'Build a Bazel target with iOS-oriented defaults for simulator/device builds.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Bazel target label, for example //:MyApp.' },
        buildMode: {
          type: 'string',
          enum: ['none', 'debug', 'release', 'release_with_symbols'],
        },
        platform: {
          type: 'string',
          enum: ['none', 'simulator', 'device', 'macos', 'tvos', 'watchos', 'visionos'],
          description: 'Target platform. Use "simulator" for iOS sim, "device" for iOS device, "macos" for macOS, or "none" to skip platform flags.',
        },
        simulatorName: { type: 'string' },
        simulatorVersion: { type: 'string' },
        configs: { type: 'array', items: { type: 'string' } },
        startupArgs: { type: 'array', items: { type: 'string' } },
        extraArgs: { type: 'array', items: { type: 'string' } },
        timeoutSeconds: { type: 'number' },
        streaming: STREAMING_PROPERTY,
      },
      required: ['target'],
    },
  },
  {
    name: 'bazel_ios_build_and_run',
    description:
      'Build a Bazel iOS app, install it on a simulator or physical device, and launch it. One-shot build-run cycle. Default platform is simulator; pass platform=device for physical device.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Bazel target label, for example //:MyApp.' },
        buildMode: {
          type: 'string',
          enum: ['none', 'debug', 'release', 'release_with_symbols'],
        },
        platform: {
          type: 'string',
          enum: ['simulator', 'device'],
          description: 'Deploy target. Defaults to simulator.',
        },
        simulatorName: { type: 'string', description: 'Simulator device name.' },
        simulatorVersion: { type: 'string' },
        simulatorId: { type: 'string', description: 'Simulator UDID. Takes precedence over name.' },
        deviceId: { type: 'string', description: 'Physical device UDID (when platform=device).' },
        deviceName: { type: 'string', description: 'Physical device name (when platform=device).' },
        configs: { type: 'array', items: { type: 'string' } },
        startupArgs: { type: 'array', items: { type: 'string' } },
        extraArgs: { type: 'array', items: { type: 'string' } },
        launchArgs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Arguments passed to the launched app process.',
        },
        launchEnv: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Environment variables injected into the launched app.',
        },
        timeoutSeconds: { type: 'number' },
        streaming: STREAMING_PROPERTY,
      },
      required: ['target'],
    },
  },
  {
    name: 'bazel_ios_test',
    description: 'Run a Bazel iOS test target with simulator and test-output defaults.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Bazel test target label.' },
        testFilter: { type: 'string', description: 'Optional test filter. Supports pipe-separated values (e.g. "SuiteA|SuiteB") to run multiple suites.' },
        simulatorName: { type: 'string' },
        simulatorVersion: { type: 'string' },
        configs: { type: 'array', items: { type: 'string' } },
        startupArgs: { type: 'array', items: { type: 'string' } },
        extraArgs: { type: 'array', items: { type: 'string' } },
        timeoutSeconds: { type: 'number' },
        streaming: STREAMING_PROPERTY,
        minimizeSimulator: {
          type: 'boolean',
          description: 'Minimize Simulator.app windows while the test runs.',
        },
        shutdownSimulatorAfterTest: {
          type: 'boolean',
          description: 'Shutdown simulators opened for the test when it finishes (deletes BAZEL_TEST_* simulators).',
        },
      },
      required: ['target'],
    },
  },
  {
    name: 'bazel_ios_query',
    description: 'Run a read-only bazel query in the configured workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'Bazel query expression.' },
        output: { type: 'string', description: 'Optional --output value, such as label or build.' },
        startupArgs: { type: 'array', items: { type: 'string' } },
        extraArgs: { type: 'array', items: { type: 'string' } },
        timeoutSeconds: { type: 'number' },
      },
      required: ['expression'],
    },
  },
  {
    name: 'bazel_ios_discover_targets',
    description: 'Discover Bazel iOS app, unit/UI test, and build-test targets using bazel query.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          description: 'Bazel query scope, for example //Apps/... or //Packages/DebugTools/....',
        },
        kind: {
          type: 'string',
          enum: ['apps', 'tests', 'all'],
          description: 'Target category to discover.',
        },
        extraArgs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional Bazel args placed before the query expression.',
        },
        startupArgs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Bazel startup args placed before the command, for example --output_base=...',
        },
      },
    },
  },
  {
    name: 'bazel_ios_target_info',
    description: 'Show Bazel build-file information for a target.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string' },
        startupArgs: { type: 'array', items: { type: 'string' } },
        timeoutSeconds: { type: 'number' },
      },
      required: ['target'],
    },
  },
  {
    name: 'bazel_ios_clean',
    description: 'Clean Bazel build outputs. Use expunge to remove the entire output base.',
    inputSchema: {
      type: 'object',
      properties: {
        expunge: { type: 'boolean', description: 'Remove entire output base (bazel clean --expunge).' },
        startupArgs: { type: 'array', items: { type: 'string' } },
        streaming: STREAMING_PROPERTY,
      },
    },
  },
  {
    name: 'bazel_ios_deps',
    description: 'Query direct dependencies of a Bazel target.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Bazel target label.' },
        depth: { type: 'number', description: 'Max depth (default: 1 for direct deps).' },
        startupArgs: { type: 'array', items: { type: 'string' } },
        timeoutSeconds: { type: 'number' },
      },
      required: ['target'],
    },
  },
  {
    name: 'bazel_ios_rdeps',
    description: 'Query reverse dependencies — which targets depend on the given target.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Bazel target label.' },
        scope: { type: 'string', description: 'Search scope (default: //...).' },
        startupArgs: { type: 'array', items: { type: 'string' } },
        timeoutSeconds: { type: 'number' },
      },
      required: ['target'],
    },
  },
  {
    name: 'bazel_ios_test_coverage',
    description: 'Run a Bazel iOS test target and collect code coverage data (lcov format).',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Bazel test target label.' },
        testFilter: { type: 'string', description: 'Optional test filter. Supports pipe-separated values (e.g. "SuiteA|SuiteB") to run multiple suites.' },
        simulatorName: { type: 'string' },
        simulatorVersion: { type: 'string' },
        configs: { type: 'array', items: { type: 'string' } },
        startupArgs: { type: 'array', items: { type: 'string' } },
        extraArgs: { type: 'array', items: { type: 'string' } },
        timeoutSeconds: { type: 'number' },
        minimizeSimulator: {
          type: 'boolean',
          description: 'Minimize Simulator.app windows while the test runs.',
        },
        shutdownSimulatorAfterTest: {
          type: 'boolean',
          description: 'Shutdown simulators opened for the test when it finishes (deletes BAZEL_TEST_* simulators).',
        },
      },
      required: ['target'],
    },
  },
];

const HANDLED = new Set(definitions.map(d => d.name));

export function canHandle(name: string): boolean {
  return HANDLED.has(name);
}

export async function handle(name: string, args: JsonObject): Promise<ToolCallResult | undefined> {
  switch (name) {
    case 'bazel_ios_build': {
      const buildArgs = args as BuildArgs;
      const commandResult = await runBazel(
        buildCommandArgs(buildArgs),
        numberOrUndefined(buildArgs.timeoutSeconds) || 1_800,
        asStringArray(buildArgs.startupArgs, 'startupArgs'),
      );
      return toolResult(
        formatCommandResult(commandResult),
        { ...structuredCommandResult(commandResult), target: buildArgs.target },
        commandResult.exitCode !== 0,
      );
    }
    case 'bazel_ios_build_and_run': {
      const platform = stringOrUndefined(args.platform) === 'device' ? 'device' : 'simulator';
      const buildRunArgs = { ...args, platform } as BuildAndRunArgs;
      const buildResult = await runBazel(
        buildCommandArgs(buildRunArgs),
        numberOrUndefined(buildRunArgs.timeoutSeconds) || 1_800,
        asStringArray(buildRunArgs.startupArgs, 'startupArgs'),
      );
      if (buildResult.exitCode !== 0) {
        return toolText(formatCommandResult(buildResult), true);
      }

      if (platform === 'device') {
        return deployBuiltAppToDevice({
          target: requireLabel(buildRunArgs.target),
          buildResult,
          deviceId: stringOrUndefined(buildRunArgs.deviceId),
          deviceName: stringOrUndefined(buildRunArgs.deviceName),
          launchArgs: asStringArray(buildRunArgs.launchArgs, 'launchArgs'),
          launchEnv: (buildRunArgs.launchEnv as Record<string, string> | undefined) || {},
        });
      }

      const config = getConfig();
      const appPath = findAppBundle(config.workspacePath, requireLabel(buildRunArgs.target));
      if (!appPath) {
        return toolText(
          `${formatCommandResult(buildResult)}\n\nBuild succeeded but .app bundle not found in bazel-bin. Check the target produces an ios_application.`,
          true,
        );
      }

      const { sim: simulator, warning: simWarning } = await resolveSimulatorFromArgs(buildRunArgs as JsonObject);

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
        asStringArray(buildRunArgs.launchArgs, 'launchArgs'),
        (buildRunArgs.launchEnv as Record<string, string> | undefined) || {},
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
    case 'bazel_ios_test': {
      const testArgs = args as TestArgs;
      const target = requireLabel(testArgs.target);
      const bazelArgs = [
        'test',
        '--test_output=errors',
        iosSimulatorCpuArg(),
        ...simulatorArgs(testArgs),
        ...configArgs(testArgs.configs),
        ...asStringArray(testArgs.extraArgs, 'extraArgs'),
        ...testFilterArgs(testArgs.testFilter),
      ];
      bazelArgs.push(target);
      const { result: commandResult, cleanupSummary } = await withTestSimulatorHooks(testArgs, () =>
        runBazel(
          bazelArgs,
          numberOrUndefined(testArgs.timeoutSeconds) || 1_800,
          asStringArray(testArgs.startupArgs, 'startupArgs'),
        ),
      );
      const output = cleanupSummary
        ? `${formatCommandResult(commandResult)}\n\n${cleanupSummary}`
        : formatCommandResult(commandResult);
      return toolResult(
        output,
        { ...structuredCommandResult(commandResult), target, testFilter: testArgs.testFilter },
        commandResult.exitCode !== 0,
      );
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
      const commandResult = await runBazel(
        bazelArgs,
        numberOrUndefined(queryArgs.timeoutSeconds) || 600,
        asStringArray(queryArgs.startupArgs, 'startupArgs'),
      );
      return toolText(formatCommandResult(commandResult), commandResult.exitCode !== 0);
    }
    case 'bazel_ios_discover_targets': {
      const kind = (args.kind as TargetKind | undefined) || 'all';
      const expression = discoverExpression(kind, stringOrUndefined(args.scope));
      const commandResult = await runBazel(
        ['query', '--output=label', ...asStringArray(args.extraArgs, 'extraArgs'), expression],
        numberOrUndefined(args.timeoutSeconds) || 600,
        asStringArray(args.startupArgs, 'startupArgs'),
      );
      if (commandResult.exitCode !== 0) {
        return toolText(formatCommandResult(commandResult), true);
      }
      const targets = parseTargetLabels(commandResult.output);
      const text = targets.length
        ? `Found ${targets.length} ${kind} target(s):\n${targets.join('\n')}`
        : `No ${kind} targets found in scope.`;
      return toolResult(text, { count: targets.length, kind, targets });
    }
    case 'bazel_ios_target_info': {
      const target = requireLabel(args.target);
      const commandResult = await runBazel(
        ['query', '--output=build', target],
        numberOrUndefined(args.timeoutSeconds) || 600,
        asStringArray(args.startupArgs, 'startupArgs'),
      );
      return toolText(formatCommandResult(commandResult), commandResult.exitCode !== 0);
    }
    case 'bazel_ios_clean': {
      const cleanArgs = ['clean'];
      const expunge = args.expunge === true;
      if (expunge) cleanArgs.push('--expunge');
      const commandResult = await runBazel(
        cleanArgs,
        // --expunge tears down the whole output base and can take minutes on a
        // large repo; give it a much longer budget than a plain clean.
        expunge ? 600 : 120,
        asStringArray(args.startupArgs, 'startupArgs'),
      );
      return toolText(formatCommandResult(commandResult), commandResult.exitCode !== 0);
    }
    case 'bazel_ios_deps': {
      const target = requireLabel(args.target);
      const depth = typeof args.depth === 'number' && Number.isFinite(args.depth) ? args.depth : 1;
      const expression = `deps(${target}, ${depth})`;
      const commandResult = await runBazel(
        ['query', expression],
        numberOrUndefined(args.timeoutSeconds) || 600,
        asStringArray(args.startupArgs, 'startupArgs'),
      );
      return toolText(formatCommandResult(commandResult), commandResult.exitCode !== 0);
    }
    case 'bazel_ios_rdeps': {
      const target = requireLabel(args.target);
      const scope = typeof args.scope === 'string' ? args.scope : '//...';
      const expression = `rdeps(${scope}, ${target})`;
      const commandResult = await runBazel(
        ['query', expression],
        numberOrUndefined(args.timeoutSeconds) || 600,
        asStringArray(args.startupArgs, 'startupArgs'),
      );
      return toolText(formatCommandResult(commandResult), commandResult.exitCode !== 0);
    }
    case 'bazel_ios_test_coverage': {
      const testArgs = args as TestArgs;
      const target = requireLabel(testArgs.target);
      const bazelArgs = [
        'coverage',
        '--test_output=errors',
        iosSimulatorCpuArg(),
        '--combined_report=lcov',
        ...simulatorArgs(testArgs),
        ...configArgs(testArgs.configs),
        ...asStringArray(testArgs.extraArgs, 'extraArgs'),
        ...testFilterArgs(testArgs.testFilter),
      ];
      bazelArgs.push(target);
      const { result: commandResult, cleanupSummary } = await withTestSimulatorHooks(testArgs, () =>
        runBazel(
          bazelArgs,
          numberOrUndefined(testArgs.timeoutSeconds) || 1_800,
          asStringArray(testArgs.startupArgs, 'startupArgs'),
        ),
      );

      const coverageSummary: string[] = [formatCommandResult(commandResult)];
      if (commandResult.exitCode === 0) {
        const config = getConfig();
        const lcovPath = join(config.workspacePath, 'bazel-out', '_coverage', '_coverage_report.dat');
        if (existsSync(lcovPath)) {
          const { readFileSync } = await import('node:fs');
          const lcov = readFileSync(lcovPath, 'utf8');
          const { totalLines, coveredLines, files } = parseLcovSummary(lcov);
          const pct = totalLines > 0 ? ((coveredLines / totalLines) * 100).toFixed(1) : '0.0';
          coverageSummary.push('', `Coverage: ${coveredLines}/${totalLines} lines (${pct}%)`, `Report: ${lcovPath}`);
          if (files.length > 0) {
            coverageSummary.push('', 'Per-file:');
            for (const f of files.slice(0, 30)) {
              const fpct = f.total > 0 ? ((f.covered / f.total) * 100).toFixed(1) : '0.0';
              coverageSummary.push(`  ${fpct}% ${f.covered}/${f.total}  ${f.name}`);
            }
            if (files.length > 30) coverageSummary.push(`  ... and ${files.length - 30} more files`);
          }
        } else {
          coverageSummary.push('', 'Coverage report not found. The target may not produce coverage data.');
        }
      }
      if (cleanupSummary) {
        coverageSummary.push('', cleanupSummary);
      }
      return toolText(coverageSummary.join('\n'), commandResult.exitCode !== 0);
    }
    default:
      return undefined;
  }
}
