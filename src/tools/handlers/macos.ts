import { join } from 'node:path';
import type { JsonObject, ToolCallResult, ToolDefinition, BuildArgs, TestArgs, TargetKind, BuildMode } from '../../types/index.js';
import { stringOrUndefined, numberOrUndefined } from '../helpers.js';
import { STREAMING_PROPERTY } from '../schema-constants.js';
import { buildCommandArgs, configArgs, discoverExpression, modeArgs, parseTargetLabels, requireLabel, runBazel, asStringArray, testFilterArgs } from '../../core/bazel.js';
import { findAppBundle, readBundleId, readInfoPlistValue } from '../../core/simulators.js';
import { formatCommandResult, structuredCommandResult, toolResult, toolText } from '../../utils/output.js';
import { runCommand } from '../../utils/process.js';
import { getConfig } from '../../runtime/config.js';

export const definitions: ToolDefinition[] = [
  {
    name: 'bazel_macos_build',
    description: 'Build a Bazel macOS target (macos_application, macos_bundle, macos_command_line_application, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Bazel target label, for example //mac:MyMacApp.' },
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
    name: 'bazel_macos_run',
    description: 'Build and launch a Bazel macOS application locally via `bazel run`.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Bazel target label for the macos_application.' },
        buildMode: { type: 'string', enum: ['none', 'debug', 'release', 'release_with_symbols'] },
        configs: { type: 'array', items: { type: 'string' } },
        startupArgs: { type: 'array', items: { type: 'string' } },
        extraArgs: { type: 'array', items: { type: 'string' } },
        runArgs: { type: 'array', items: { type: 'string' }, description: 'Arguments passed to the launched binary after --.' },
        timeoutSeconds: { type: 'number' },
        streaming: STREAMING_PROPERTY,
      },
      required: ['target'],
    },
  },
  {
    name: 'bazel_macos_test',
    description: 'Run a Bazel macOS unit test target (macos_unit_test).',
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
    name: 'bazel_macos_discover_targets',
    description: 'Discover Bazel macOS application and unit test targets using bazel query.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', description: 'Bazel query scope, for example //mac/... or //...' },
        kind: { type: 'string', enum: ['macos_apps', 'macos_tests', 'macos_all'], description: 'Target category to discover.' },
        extraArgs: { type: 'array', items: { type: 'string' } },
        startupArgs: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'bazel_macos_coverage',
    description: 'Run Bazel macOS test with coverage collection and lcov output.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Bazel test target label.' },
        testFilter: { type: 'string', description: 'Optional test filter. Supports pipe-separated values (e.g. "SuiteA|SuiteB") to run multiple suites.' },
        configs: { type: 'array', items: { type: 'string' } },
        startupArgs: { type: 'array', items: { type: 'string' } },
        extraArgs: { type: 'array', items: { type: 'string' } },
        timeoutSeconds: { type: 'number' },
      },
      required: ['target'],
    },
  },
  {
    name: 'bazel_macos_clean',
    description: 'Clean Bazel macOS build outputs. Equivalent to bazel_ios_clean but scoped for macOS context.',
    inputSchema: {
      type: 'object',
      properties: {
        expunge: { type: 'boolean', description: 'Run bazel clean --expunge.' },
        startupArgs: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'bazel_macos_launch',
    description: 'Launch a previously built macOS application by its bundle path or target label.',
    inputSchema: {
      type: 'object',
      properties: {
        appPath: { type: 'string', description: 'Path to the .app bundle.' },
        target: { type: 'string', description: 'Bazel target label (used to find .app in bazel-bin).' },
        launchArgs: { type: 'array', items: { type: 'string' }, description: 'Arguments passed to the app.' },
        launchEnv: { type: 'object', description: 'Environment variables for the app.' },
      },
    },
  },
  {
    name: 'bazel_macos_stop',
    description: 'Terminate a running macOS application by bundle ID or process name.',
    inputSchema: {
      type: 'object',
      properties: {
        bundleId: { type: 'string', description: 'App bundle identifier.' },
        processName: { type: 'string', description: 'Process name (alternative to bundleId).' },
      },
    },
  },
  {
    name: 'bazel_macos_install',
    description: 'Copy a Bazel-built macOS .app into /Applications or a custom directory.',
    inputSchema: {
      type: 'object',
      properties: {
        appPath: { type: 'string', description: 'Path to the .app bundle.' },
        target: { type: 'string', description: 'Bazel target label to locate .app in bazel-bin.' },
        destination: { type: 'string', description: 'Install directory (default: /Applications).' },
      },
    },
  },
  {
    name: 'bazel_macos_app_path',
    description: 'Locate the .app bundle for a macOS Bazel target in bazel-bin.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Bazel target label.' },
      },
      required: ['target'],
    },
  },
  {
    name: 'bazel_macos_bundle_id',
    description: 'Read the CFBundleIdentifier from a macOS .app bundle.',
    inputSchema: {
      type: 'object',
      properties: {
        appPath: { type: 'string', description: 'Path to the .app bundle or Bazel target label.' },
      },
      required: ['appPath'],
    },
  },
  {
    name: 'bazel_macos_log',
    description: 'Stream system logs on macOS, optionally filtered by process.',
    inputSchema: {
      type: 'object',
      properties: {
        processName: { type: 'string', description: 'Filter logs to this process.' },
        level: { type: 'string', enum: ['default', 'info', 'debug'], description: 'Log level filter.' },
        timeoutSeconds: { type: 'number', description: 'How long to capture logs (default: 30).' },
      },
    },
  },
  {
    name: 'bazel_macos_screenshot',
    description: 'Take a screenshot of the macOS desktop via `screencapture`.',
    inputSchema: {
      type: 'object',
      properties: {
        outputPath: { type: 'string', description: 'File path to save the screenshot.' },
        windowOnly: { type: 'boolean', description: 'Capture only the frontmost window.' },
      },
      required: ['outputPath'],
    },
  },
];

const HANDLED = new Set(definitions.map(d => d.name));

export function canHandle(name: string): boolean {
  return HANDLED.has(name);
}

export async function handle(name: string, args: JsonObject): Promise<ToolCallResult | undefined> {
  switch (name) {
    case 'bazel_macos_build': {
      const buildArgs = { ...args, platform: 'macos' } as BuildArgs;
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
    case 'bazel_macos_run': {
      const target = requireLabel(args.target);
      // No platformArgs here on purpose: `bazel run` builds for the host
      // (darwin) by default, so adding --platforms is unnecessary (unlike the
      // tvOS/watchOS/visionOS run handlers which target a non-host platform).
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
      const commandResult = await runBazel(
        bazelArgs,
        numberOrUndefined(args.timeoutSeconds) || 1_800,
        asStringArray(args.startupArgs, 'startupArgs'),
      );
      return toolResult(
        formatCommandResult(commandResult),
        { ...structuredCommandResult(commandResult), target },
        commandResult.exitCode !== 0,
      );
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
      const commandResult = await runBazel(
        bazelArgs,
        numberOrUndefined(testArgs.timeoutSeconds) || 1_800,
        asStringArray(testArgs.startupArgs, 'startupArgs'),
      );
      return toolResult(
        formatCommandResult(commandResult),
        { ...structuredCommandResult(commandResult), target, testFilter: testArgs.testFilter },
        commandResult.exitCode !== 0,
      );
    }
    case 'bazel_macos_discover_targets': {
      const kind = (args.kind as TargetKind | undefined) || 'macos_all';
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
    case 'bazel_macos_coverage': {
      const target = requireLabel(args.target as string);
      const coverageArgs = [
        'coverage',
        '--combined_report=lcov',
        ...configArgs(asStringArray(args.configs, 'configs')),
        ...asStringArray(args.extraArgs, 'extraArgs'),
      ];
      coverageArgs.push(...testFilterArgs(args.testFilter));
      coverageArgs.push(target);
      const result = await runBazel(
        coverageArgs,
        numberOrUndefined(args.timeoutSeconds) || 1_800,
        asStringArray(args.startupArgs, 'startupArgs'),
      );
      return toolResult(
        formatCommandResult(result),
        { ...structuredCommandResult(result), target },
        result.exitCode !== 0,
      );
    }
    case 'bazel_macos_clean': {
      const cleanArgs = ['clean'];
      if (args.expunge) cleanArgs.push('--expunge');
      const result = await runBazel(
        cleanArgs,
        300,
        asStringArray(args.startupArgs, 'startupArgs'),
      );
      return toolText(formatCommandResult(result), result.exitCode !== 0);
    }
    case 'bazel_macos_launch': {
      let appPath = stringOrUndefined(args.appPath);
      if (!appPath && args.target) {
        const config = getConfig();
        appPath = findAppBundle(config.workspacePath, requireLabel(args.target as string)) || undefined;
        if (!appPath) throw new Error(`Could not locate .app for target ${args.target} in bazel-bin.`);
      }
      if (!appPath) throw new Error('Either appPath or target is required.');
      const launchArgs = asStringArray(args.launchArgs, 'launchArgs');
      const launchEnv = (args.launchEnv as Record<string, string> | undefined) || {};
      // `open` cannot inject per-launch environment variables, so when
      // launchEnv is requested we exec the app's Mach-O binary directly.
      if (Object.keys(launchEnv).length > 0) {
        const exec = readInfoPlistValue(appPath, 'CFBundleExecutable');
        if (!exec) throw new Error(`Could not read CFBundleExecutable from ${appPath}.`);
        const binary = join(appPath, 'Contents', 'MacOS', exec);
        const result = await runCommand(binary, launchArgs, {
          cwd: process.cwd(), timeoutSeconds: 30, maxOutput: 50_000,
          env: { ...process.env, ...launchEnv },
        });
        return toolText(`Launched: ${binary}\n${formatCommandResult(result)}`, result.exitCode !== 0);
      }
      const launchCmdArgs = ['open', appPath];
      if (launchArgs.length > 0) {
        launchCmdArgs.push('--args', ...launchArgs);
      }
      const result = await runCommand(launchCmdArgs[0], launchCmdArgs.slice(1), {
        cwd: process.cwd(), timeoutSeconds: 30, maxOutput: 50_000,
      });
      return toolText(`Launched: ${appPath}\n${formatCommandResult(result)}`, result.exitCode !== 0);
    }
    case 'bazel_macos_stop': {
      const bundleId = stringOrUndefined(args.bundleId);
      const processName = stringOrUndefined(args.processName);
      if (!bundleId && !processName) throw new Error('Either bundleId or processName is required.');
      if (bundleId) {
        const script = `tell application id "${bundleId.replace(/"/g, '\\"')}" to quit`;
        const result = await runCommand('osascript', ['-e', script], {
          cwd: process.cwd(), timeoutSeconds: 10, maxOutput: 10_000,
        });
        return toolText(`Terminated: ${bundleId}\n${formatCommandResult(result)}`, result.exitCode !== 0);
      }
      const result = await runCommand('pkill', ['-x', processName!], {
        cwd: process.cwd(), timeoutSeconds: 10, maxOutput: 10_000,
      });
      return toolText(`Terminated: ${processName}\n${formatCommandResult(result)}`, result.exitCode !== 0);
    }
    case 'bazel_macos_install': {
      let appPath = stringOrUndefined(args.appPath);
      if (!appPath && args.target) {
        const config = getConfig();
        appPath = findAppBundle(config.workspacePath, requireLabel(args.target as string)) || undefined;
        if (!appPath) throw new Error(`Could not locate .app for target ${args.target} in bazel-bin.`);
      }
      if (!appPath) throw new Error('Either appPath or target is required.');
      const dest = stringOrUndefined(args.destination) || '/Applications';
      const result = await runCommand('cp', ['-R', appPath, dest], {
        cwd: process.cwd(), timeoutSeconds: 60, maxOutput: 50_000,
      });
      return toolText(`Installed ${appPath} → ${dest}\n${formatCommandResult(result)}`, result.exitCode !== 0);
    }
    case 'bazel_macos_app_path': {
      const config = getConfig();
      const appPath = findAppBundle(config.workspacePath, requireLabel(args.target as string));
      if (!appPath) {
        return toolText(`No .app bundle found for target ${args.target} in bazel-bin.`, true);
      }
      return toolText(appPath);
    }
    case 'bazel_macos_bundle_id': {
      if (typeof args.appPath !== 'string' || !args.appPath.trim()) {
        throw new Error('appPath is required (path to a .app bundle or a Bazel target label).');
      }
      const appPathStr = args.appPath;
      let resolvedPath = appPathStr;
      if (appPathStr.startsWith('//')) {
        const config = getConfig();
        const found = findAppBundle(config.workspacePath, requireLabel(appPathStr));
        if (!found) return toolText(`No .app found for ${appPathStr}`, true);
        resolvedPath = found;
      }
      const bundleId = readBundleId(resolvedPath);
      return toolText(bundleId);
    }
    case 'bazel_macos_log': {
      const logArgs = ['stream', '--style', 'compact'];
      if (args.level !== undefined) {
        const validLevels = ['default', 'info', 'debug'];
        if (typeof args.level !== 'string' || !validLevels.includes(args.level)) {
          throw new Error(`Invalid level "${args.level}". Expected one of: ${validLevels.join(', ')}.`);
        }
        logArgs.push('--level', args.level);
      }
      if (args.processName !== undefined) {
        const processName = String(args.processName);
        // Reject control characters / backslashes that could break out of the
        // quoted NSPredicate; quotes are escaped below.
        // eslint-disable-next-line no-control-regex
        if (/[\u0000-\u001f\\]/.test(processName)) {
          throw new Error('processName contains invalid characters.');
        }
        logArgs.push('--predicate', `processImagePath ENDSWITH "${processName.replace(/"/g, '\\"')}"`);
      }
      const timeout = numberOrUndefined(args.timeoutSeconds) || 30;
      const result = await runCommand('log', logArgs, {
        cwd: process.cwd(), timeoutSeconds: timeout, maxOutput: 500_000,
      });
      return toolText(formatCommandResult(result), result.exitCode !== 0);
    }
    case 'bazel_macos_screenshot': {
      if (typeof args.outputPath !== 'string') throw new Error('outputPath is required.');
      const captureArgs = ['-o', args.outputPath];
      if (args.windowOnly) captureArgs.push('-w');
      const result = await runCommand('screencapture', captureArgs, {
        cwd: process.cwd(), timeoutSeconds: 10, maxOutput: 10_000,
      });
      return toolResult(
        `Screenshot saved to ${args.outputPath}\n${formatCommandResult(result)}`,
        { ...structuredCommandResult(result), outputPath: args.outputPath },
        result.exitCode !== 0,
      );
    }
    default:
      return undefined;
  }
}
