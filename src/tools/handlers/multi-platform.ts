import type { JsonObject, ToolCallResult, ToolDefinition, BuildArgs, TestArgs, BuildPlatform, BuildMode, TargetKind } from '../../types/index.js';
import { stringOrUndefined, numberOrUndefined } from '../helpers.js';
import { STREAMING_PROPERTY } from '../schema-constants.js';
import { buildCommandArgs, configArgs, discoverExpression, modeArgs, platformArgs, requireLabel, runBazel, asStringArray, testFilterArgs } from '../../core/bazel.js';
import { formatCommandResult, structuredCommandResult, toolResult, toolText } from '../../utils/output.js';

export const definitions: ToolDefinition[] = [
  {
    name: 'bazel_tvos_build',
    description: 'Build a Bazel tvOS target (tvos_application, tvos_extension, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Bazel target label.' },
        buildMode: { type: 'string', enum: ['none', 'debug', 'release', 'release_with_symbols'] },
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
    name: 'bazel_tvos_test',
    description: 'Run a Bazel tvOS unit test target (tvos_unit_test).',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Bazel test target label.' },
        testFilter: { type: 'string', description: 'Optional test filter. Supports pipe-separated values (e.g. "SuiteA|SuiteB") to run multiple suites.' },
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
    name: 'bazel_tvos_run',
    description: 'Build and launch a Bazel tvOS application via `bazel run`.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Bazel target label for the tvos_application.' },
        buildMode: { type: 'string', enum: ['none', 'debug', 'release', 'release_with_symbols'] },
        configs: { type: 'array', items: { type: 'string' } },
        startupArgs: { type: 'array', items: { type: 'string' } },
        extraArgs: { type: 'array', items: { type: 'string' } },
        runArgs: { type: 'array', items: { type: 'string' }, description: 'Arguments passed after --.' },
        timeoutSeconds: { type: 'number' },
        streaming: STREAMING_PROPERTY,
      },
      required: ['target'],
    },
  },
  {
    name: 'bazel_tvos_discover_targets',
    description: 'Discover Bazel tvOS application and unit test targets.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', description: 'Bazel query scope.' },
        kind: { type: 'string', enum: ['tvos_apps', 'tvos_tests', 'tvos_all'], description: 'Target category.' },
        extraArgs: { type: 'array', items: { type: 'string' } },
        startupArgs: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'bazel_watchos_build',
    description: 'Build a Bazel watchOS target (watchos_application, watchos_extension, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Bazel target label.' },
        buildMode: { type: 'string', enum: ['none', 'debug', 'release', 'release_with_symbols'] },
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
    name: 'bazel_watchos_test',
    description: 'Run a Bazel watchOS unit test target (watchos_unit_test).',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Bazel test target label.' },
        testFilter: { type: 'string', description: 'Optional test filter. Supports pipe-separated values (e.g. "SuiteA|SuiteB") to run multiple suites.' },
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
    name: 'bazel_watchos_run',
    description: 'Build and launch a Bazel watchOS application via `bazel run`.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Bazel target label for the watchos_application.' },
        buildMode: { type: 'string', enum: ['none', 'debug', 'release', 'release_with_symbols'] },
        configs: { type: 'array', items: { type: 'string' } },
        startupArgs: { type: 'array', items: { type: 'string' } },
        extraArgs: { type: 'array', items: { type: 'string' } },
        runArgs: { type: 'array', items: { type: 'string' }, description: 'Arguments passed after --.' },
        timeoutSeconds: { type: 'number' },
        streaming: STREAMING_PROPERTY,
      },
      required: ['target'],
    },
  },
  {
    name: 'bazel_watchos_discover_targets',
    description: 'Discover Bazel watchOS application and unit test targets.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', description: 'Bazel query scope.' },
        kind: { type: 'string', enum: ['watchos_apps', 'watchos_tests', 'watchos_all'], description: 'Target category.' },
        extraArgs: { type: 'array', items: { type: 'string' } },
        startupArgs: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'bazel_visionos_build',
    description: 'Build a Bazel visionOS target (visionos_application, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Bazel target label.' },
        buildMode: { type: 'string', enum: ['none', 'debug', 'release', 'release_with_symbols'] },
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
    name: 'bazel_visionos_test',
    description: 'Run a Bazel visionOS unit test target (visionos_unit_test).',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Bazel test target label.' },
        testFilter: { type: 'string', description: 'Optional test filter. Supports pipe-separated values (e.g. "SuiteA|SuiteB") to run multiple suites.' },
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
    name: 'bazel_visionos_run',
    description: 'Build and launch a Bazel visionOS application via `bazel run`.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Bazel target label for the visionos_application.' },
        buildMode: { type: 'string', enum: ['none', 'debug', 'release', 'release_with_symbols'] },
        configs: { type: 'array', items: { type: 'string' } },
        startupArgs: { type: 'array', items: { type: 'string' } },
        extraArgs: { type: 'array', items: { type: 'string' } },
        runArgs: { type: 'array', items: { type: 'string' }, description: 'Arguments passed after --.' },
        timeoutSeconds: { type: 'number' },
        streaming: STREAMING_PROPERTY,
      },
      required: ['target'],
    },
  },
  {
    name: 'bazel_visionos_discover_targets',
    description: 'Discover Bazel visionOS application and unit test targets.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', description: 'Bazel query scope.' },
        kind: { type: 'string', enum: ['visionos_apps', 'visionos_tests', 'visionos_all'], description: 'Target category.' },
        extraArgs: { type: 'array', items: { type: 'string' } },
        startupArgs: { type: 'array', items: { type: 'string' } },
      },
    },
  },
];

const HANDLED = new Set(definitions.map(d => d.name));

export function canHandle(name: string): boolean {
  return HANDLED.has(name);
}

export async function handle(name: string, args: JsonObject): Promise<ToolCallResult | undefined> {
  switch (name) {
    case 'bazel_tvos_build':
    case 'bazel_watchos_build':
    case 'bazel_visionos_build': {
      const plat = name.replace('bazel_', '').replace('_build', '') as BuildPlatform;
      const buildArgs = { ...args, platform: plat } as BuildArgs;
      const commandResult = await runBazel(
        buildCommandArgs(buildArgs),
        numberOrUndefined(buildArgs.timeoutSeconds) || 1_800,
        asStringArray(buildArgs.startupArgs, 'startupArgs'),
      );
      return toolResult(
        formatCommandResult(commandResult),
        { ...structuredCommandResult(commandResult), target: buildArgs.target, platform: plat },
        commandResult.exitCode !== 0,
      );
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
      const commandResult = await runBazel(
        bazelArgs,
        numberOrUndefined(args.timeoutSeconds) || 1_800,
        asStringArray(args.startupArgs, 'startupArgs'),
      );
      return toolResult(
        formatCommandResult(commandResult),
        { ...structuredCommandResult(commandResult), target, platform: plat },
        commandResult.exitCode !== 0,
      );
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
      const commandResult = await runBazel(
        bazelArgs,
        numberOrUndefined(testArgs.timeoutSeconds) || 1_800,
        asStringArray(testArgs.startupArgs, 'startupArgs'),
      );
      return toolResult(
        formatCommandResult(commandResult),
        { ...structuredCommandResult(commandResult), target, testFilter: testArgs.testFilter, platform: plat },
        commandResult.exitCode !== 0,
      );
    }
    case 'bazel_tvos_discover_targets': {
      const kind = (args.kind as string | undefined) || 'tvos_all';
      const expression = discoverExpression(kind as TargetKind, stringOrUndefined(args.scope));
      const commandResult = await runBazel(
        ['query', ...asStringArray(args.extraArgs, 'extraArgs'), expression],
        numberOrUndefined(args.timeoutSeconds) || 600,
        asStringArray(args.startupArgs, 'startupArgs'),
      );
      return toolText(formatCommandResult(commandResult), commandResult.exitCode !== 0);
    }
    case 'bazel_watchos_discover_targets': {
      const kind = (args.kind as string | undefined) || 'watchos_all';
      const expression = discoverExpression(kind as TargetKind, stringOrUndefined(args.scope));
      const commandResult = await runBazel(
        ['query', ...asStringArray(args.extraArgs, 'extraArgs'), expression],
        numberOrUndefined(args.timeoutSeconds) || 600,
        asStringArray(args.startupArgs, 'startupArgs'),
      );
      return toolText(formatCommandResult(commandResult), commandResult.exitCode !== 0);
    }
    case 'bazel_visionos_discover_targets': {
      const kind = (args.kind as string | undefined) || 'visionos_all';
      const expression = discoverExpression(kind as TargetKind, stringOrUndefined(args.scope));
      const commandResult = await runBazel(
        ['query', ...asStringArray(args.extraArgs, 'extraArgs'), expression],
        numberOrUndefined(args.timeoutSeconds) || 600,
        asStringArray(args.startupArgs, 'startupArgs'),
      );
      return toolText(formatCommandResult(commandResult), commandResult.exitCode !== 0);
    }
    default:
      return undefined;
  }
}
