import type { JsonObject, ToolCallResult, ToolDefinition } from '../../types/index.js';
import { swiftBuild, swiftTest, swiftRun, swiftPackageClean, swiftPackageResolve, swiftPackageDump } from '../../core/swift-package.js';
import type { SwiftBuildConfiguration } from '../../core/swift-package.js';
import { runCommand } from '../../utils/process.js';
import { formatCommandResult, structuredCommandResult, toolResult, toolText } from '../../utils/output.js';
import { getConfig } from '../../runtime/config.js';
import { stringOrUndefined, numberOrUndefined } from '../helpers.js';
import { STREAMING_PROPERTY } from '../schema-constants.js';
import { asStringArray } from '../../core/bazel.js';

export const definitions: ToolDefinition[] = [
  {
    name: 'swift_package_build',
    description: 'Build a Swift package using `swift build`. Works on any directory with a Package.swift.',
    inputSchema: {
      type: 'object',
      properties: {
        packagePath: { type: 'string', description: 'Path to the Swift package directory. Defaults to workspace path.' },
        configuration: { type: 'string', enum: ['debug', 'release'], description: 'Build configuration (default: debug).' },
        target: { type: 'string', description: 'Specific target to build (default: all targets).' },
        extraArgs: { type: 'array', items: { type: 'string' }, description: 'Additional arguments passed to swift build.' },
        timeoutSeconds: { type: 'number' },
        streaming: STREAMING_PROPERTY,
      },
    },
  },
  {
    name: 'swift_package_test',
    description: 'Run tests in a Swift package using `swift test`.',
    inputSchema: {
      type: 'object',
      properties: {
        packagePath: { type: 'string', description: 'Path to the Swift package directory. Defaults to workspace path.' },
        filter: { type: 'string', description: 'Test filter pattern (e.g. MyTests.testFoo).' },
        configuration: { type: 'string', enum: ['debug', 'release'], description: 'Build configuration (default: debug).' },
        extraArgs: { type: 'array', items: { type: 'string' }, description: 'Additional arguments passed to swift test.' },
        timeoutSeconds: { type: 'number' },
        streaming: STREAMING_PROPERTY,
      },
    },
  },
  {
    name: 'swift_package_run',
    description: 'Build and run an executable target in a Swift package using `swift run`.',
    inputSchema: {
      type: 'object',
      properties: {
        packagePath: { type: 'string', description: 'Path to the Swift package directory. Defaults to workspace path.' },
        executable: { type: 'string', description: "Executable target name. If omitted, uses the package's default." },
        configuration: { type: 'string', enum: ['debug', 'release'], description: 'Build configuration (default: debug).' },
        extraArgs: { type: 'array', items: { type: 'string' }, description: 'Additional arguments passed to swift run.' },
        runArgs: { type: 'array', items: { type: 'string' }, description: 'Arguments passed to the executable after --.' },
        timeoutSeconds: { type: 'number' },
      },
    },
  },
  {
    name: 'swift_package_clean',
    description: 'Clean build artifacts of a Swift package (`swift package clean`).',
    inputSchema: {
      type: 'object',
      properties: {
        packagePath: { type: 'string', description: 'Path to the Swift package directory. Defaults to workspace path.' },
      },
    },
  },
  {
    name: 'swift_package_resolve',
    description: 'Resolve and fetch Swift package dependencies (`swift package resolve`).',
    inputSchema: {
      type: 'object',
      properties: {
        packagePath: { type: 'string', description: 'Path to the Swift package directory. Defaults to workspace path.' },
        timeoutSeconds: { type: 'number' },
      },
    },
  },
  {
    name: 'swift_package_dump',
    description: 'Dump the Swift package manifest as JSON (`swift package dump-package`). Shows targets, products, and dependencies.',
    inputSchema: {
      type: 'object',
      properties: {
        packagePath: { type: 'string', description: 'Path to the Swift package directory. Defaults to workspace path.' },
      },
    },
  },
  {
    name: 'swift_package_init',
    description: 'Initialize a new Swift package in the given directory (`swift package init`).',
    inputSchema: {
      type: 'object',
      properties: {
        packagePath: { type: 'string', description: 'Directory where the package will be created. Defaults to workspace path.' },
        type: { type: 'string', enum: ['library', 'executable', 'tool', 'macro', 'empty'], description: 'Package type (default: library).' },
        name: { type: 'string', description: 'Package name. Defaults to the directory name.' },
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
    case 'swift_package_build': {
      const pkgPath = stringOrUndefined(args.packagePath) || getConfig().workspacePath;
      const commandResult = await swiftBuild({
        packagePath: pkgPath,
        configuration: stringOrUndefined(args.configuration) as SwiftBuildConfiguration | undefined,
        target: stringOrUndefined(args.target),
        extraArgs: asStringArray(args.extraArgs, 'extraArgs'),
        timeoutSeconds: numberOrUndefined(args.timeoutSeconds),
      });
      return toolResult(
        formatCommandResult(commandResult),
        { ...structuredCommandResult(commandResult), packagePath: pkgPath },
        commandResult.exitCode !== 0,
      );
    }
    case 'swift_package_test': {
      const pkgPath = stringOrUndefined(args.packagePath) || getConfig().workspacePath;
      const commandResult = await swiftTest({
        packagePath: pkgPath,
        filter: stringOrUndefined(args.filter),
        configuration: stringOrUndefined(args.configuration) as SwiftBuildConfiguration | undefined,
        extraArgs: asStringArray(args.extraArgs, 'extraArgs'),
        timeoutSeconds: numberOrUndefined(args.timeoutSeconds),
      });
      return toolResult(
        formatCommandResult(commandResult),
        { ...structuredCommandResult(commandResult), packagePath: pkgPath, filter: args.filter },
        commandResult.exitCode !== 0,
      );
    }
    case 'swift_package_run': {
      const pkgPath = stringOrUndefined(args.packagePath) || getConfig().workspacePath;
      const commandResult = await swiftRun({
        packagePath: pkgPath,
        executable: stringOrUndefined(args.executable),
        configuration: stringOrUndefined(args.configuration) as SwiftBuildConfiguration | undefined,
        extraArgs: asStringArray(args.extraArgs, 'extraArgs'),
        runArgs: asStringArray(args.runArgs, 'runArgs'),
        timeoutSeconds: numberOrUndefined(args.timeoutSeconds),
      });
      return toolResult(
        formatCommandResult(commandResult),
        { ...structuredCommandResult(commandResult), packagePath: pkgPath },
        commandResult.exitCode !== 0,
      );
    }
    case 'swift_package_clean': {
      const pkgPath = stringOrUndefined(args.packagePath) || getConfig().workspacePath;
      const commandResult = await swiftPackageClean({ packagePath: pkgPath });
      return toolText(formatCommandResult(commandResult), commandResult.exitCode !== 0);
    }
    case 'swift_package_resolve': {
      const pkgPath = stringOrUndefined(args.packagePath) || getConfig().workspacePath;
      const commandResult = await swiftPackageResolve({
        packagePath: pkgPath,
        timeoutSeconds: numberOrUndefined(args.timeoutSeconds),
      });
      return toolText(formatCommandResult(commandResult), commandResult.exitCode !== 0);
    }
    case 'swift_package_dump': {
      const pkgPath = stringOrUndefined(args.packagePath) || getConfig().workspacePath;
      const { command, manifest } = await swiftPackageDump({ packagePath: pkgPath });
      if (command.exitCode !== 0) {
        return toolText(formatCommandResult(command), true);
      }
      if (manifest) {
        const targets = (manifest.targets as Array<{ name: string; type: string }>) || [];
        const products = (manifest.products as Array<{ name: string; type: Record<string, unknown> }>) || [];
        const deps = (manifest.dependencies as Array<{ sourceControl?: Array<{ identity: string }> }>) || [];
        const lines = [
          `Package: ${manifest.name || '(unknown)'}`,
          '',
          `Products (${products.length}):`,
          ...products.map((p) => `  ${p.name} (${Object.keys(p.type || {})[0] || 'unknown'})`),
          '',
          `Targets (${targets.length}):`,
          ...targets.map((t) => `  ${t.name} (${t.type})`),
          '',
          `Dependencies (${deps.length}):`,
          ...deps.map((d) => `  ${d.sourceControl?.[0]?.identity || JSON.stringify(d)}`),
        ];
        return toolResult(lines.join('\n'), { manifest, packagePath: pkgPath }, false);
      }
      return toolText(command.output);
    }
    case 'swift_package_init': {
      const pkgPath = stringOrUndefined(args.packagePath) || getConfig().workspacePath;
      const initArgs = ['package', 'init'];
      if (typeof args.type === 'string') {
        initArgs.push('--type', args.type);
      }
      if (typeof args.name === 'string') {
        initArgs.push('--name', args.name);
      }
      const commandResult = await runCommand('swift', initArgs, {
        cwd: pkgPath,
        timeoutSeconds: 30,
        maxOutput: 100_000,
      });
      return toolText(formatCommandResult(commandResult), commandResult.exitCode !== 0);
    }
    default:
      return undefined;
  }
}
