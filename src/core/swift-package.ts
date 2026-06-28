import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CommandResult } from '../types/index.js';
import { runCommand, runCommandStreaming, type StreamChunk } from '../utils/process.js';

interface SwiftPackageInfo {
  packagePath: string;
  hasPackageSwift: boolean;
  hasPackageResolved: boolean;
}

export function detectSwiftPackage(path: string): SwiftPackageInfo {
  const resolved = resolve(path);
  return {
    packagePath: resolved,
    hasPackageSwift: existsSync(join(resolved, 'Package.swift')),
    hasPackageResolved: existsSync(join(resolved, 'Package.resolved')),
  };
}

export function assertSwiftPackage(path: string): string {
  const resolved = resolve(path);
  if (!existsSync(join(resolved, 'Package.swift'))) {
    throw new Error(`No Package.swift found in ${resolved}. This is not a Swift package.`);
  }
  return resolved;
}

export type SwiftBuildConfiguration = 'debug' | 'release';

export async function swiftBuild(options: {
  packagePath: string;
  configuration?: SwiftBuildConfiguration;
  target?: string;
  extraArgs?: string[];
  timeoutSeconds?: number;
}): Promise<CommandResult> {
  const args = ['build'];
  if (options.configuration) {
    args.push('-c', options.configuration);
  }
  if (options.target) {
    args.push('--target', options.target);
  }
  if (options.extraArgs) {
    args.push(...options.extraArgs);
  }

  return runCommand('swift', args, {
    cwd: assertSwiftPackage(options.packagePath),
    timeoutSeconds: options.timeoutSeconds || 600,
    maxOutput: 500_000,
  });
}

export async function* swiftBuildStreaming(options: {
  packagePath: string;
  configuration?: SwiftBuildConfiguration;
  target?: string;
  extraArgs?: string[];
  timeoutSeconds?: number;
}): AsyncGenerator<StreamChunk | CommandResult> {
  const args = ['build'];
  if (options.configuration) {
    args.push('-c', options.configuration);
  }
  if (options.target) {
    args.push('--target', options.target);
  }
  if (options.extraArgs) {
    args.push(...options.extraArgs);
  }

  yield* runCommandStreaming('swift', args, {
    cwd: assertSwiftPackage(options.packagePath),
    timeoutSeconds: options.timeoutSeconds || 600,
    maxOutput: 500_000,
  });
}

export async function swiftTest(options: {
  packagePath: string;
  filter?: string;
  configuration?: SwiftBuildConfiguration;
  extraArgs?: string[];
  timeoutSeconds?: number;
}): Promise<CommandResult> {
  const args = ['test'];
  if (options.configuration) {
    args.push('-c', options.configuration);
  }
  if (options.filter) {
    args.push('--filter', options.filter);
  }
  if (options.extraArgs) {
    args.push(...options.extraArgs);
  }

  return runCommand('swift', args, {
    cwd: assertSwiftPackage(options.packagePath),
    timeoutSeconds: options.timeoutSeconds || 1_200,
    maxOutput: 500_000,
  });
}

export async function* swiftTestStreaming(options: {
  packagePath: string;
  filter?: string;
  configuration?: SwiftBuildConfiguration;
  extraArgs?: string[];
  timeoutSeconds?: number;
}): AsyncGenerator<StreamChunk | CommandResult> {
  const args = ['test'];
  if (options.configuration) {
    args.push('-c', options.configuration);
  }
  if (options.filter) {
    args.push('--filter', options.filter);
  }
  if (options.extraArgs) {
    args.push(...options.extraArgs);
  }

  yield* runCommandStreaming('swift', args, {
    cwd: assertSwiftPackage(options.packagePath),
    timeoutSeconds: options.timeoutSeconds || 1_200,
    maxOutput: 500_000,
  });
}

export async function swiftRun(options: {
  packagePath: string;
  executable?: string;
  configuration?: SwiftBuildConfiguration;
  extraArgs?: string[];
  runArgs?: string[];
  timeoutSeconds?: number;
}): Promise<CommandResult> {
  const args = ['run'];
  if (options.configuration) {
    args.push('-c', options.configuration);
  }
  if (options.executable) {
    args.push(options.executable);
  }
  if (options.extraArgs) {
    args.push(...options.extraArgs);
  }
  if (options.runArgs && options.runArgs.length > 0) {
    args.push('--', ...options.runArgs);
  }

  return runCommand('swift', args, {
    cwd: assertSwiftPackage(options.packagePath),
    timeoutSeconds: options.timeoutSeconds || 300,
    maxOutput: 500_000,
  });
}

export async function* swiftRunStreaming(options: {
  packagePath: string;
  executable?: string;
  configuration?: SwiftBuildConfiguration;
  extraArgs?: string[];
  runArgs?: string[];
  timeoutSeconds?: number;
}): AsyncGenerator<StreamChunk | CommandResult> {
  const args = ['run'];
  if (options.configuration) {
    args.push('-c', options.configuration);
  }
  if (options.executable) {
    args.push(options.executable);
  }
  if (options.extraArgs) {
    args.push(...options.extraArgs);
  }
  if (options.runArgs && options.runArgs.length > 0) {
    args.push('--', ...options.runArgs);
  }

  yield* runCommandStreaming('swift', args, {
    cwd: assertSwiftPackage(options.packagePath),
    timeoutSeconds: options.timeoutSeconds || 300,
    maxOutput: 500_000,
  });
}

export async function swiftPackageClean(options: {
  packagePath: string;
}): Promise<CommandResult> {
  return runCommand('swift', ['package', 'clean'], {
    cwd: assertSwiftPackage(options.packagePath),
    timeoutSeconds: 60,
    maxOutput: 100_000,
  });
}

export async function swiftPackageResolve(options: {
  packagePath: string;
  timeoutSeconds?: number;
}): Promise<CommandResult> {
  return runCommand('swift', ['package', 'resolve'], {
    cwd: assertSwiftPackage(options.packagePath),
    timeoutSeconds: options.timeoutSeconds || 300,
    maxOutput: 200_000,
  });
}

export async function swiftPackageDump(options: {
  packagePath: string;
}): Promise<{ command: CommandResult; manifest?: Record<string, unknown> }> {
  const command = await runCommand('swift', ['package', 'dump-package'], {
    cwd: assertSwiftPackage(options.packagePath),
    timeoutSeconds: 60,
    maxOutput: 500_000,
  });

  let manifest: Record<string, unknown> | undefined;
  if (command.exitCode === 0) {
    try {
      // dump-package writes JSON to stdout; swift may emit warnings to stderr
      // which the combined `output` would prepend and break JSON.parse.
      manifest = JSON.parse(command.stdout || command.output) as Record<string, unknown>;
    } catch {
      // JSON parse failed — return raw output
    }
  }

  return { command, manifest };
}
