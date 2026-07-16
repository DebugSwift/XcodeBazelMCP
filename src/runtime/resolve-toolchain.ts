import { accessSync, constants, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Common install locations when MCP inherits a minimal PATH (e.g. from Cursor). */
export const COMMON_BIN_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  join(homedir(), '.local/bin'),
];

const BAZEL_EXECUTABLE_NAMES = ['bazel', 'bazelisk'] as const;

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Prepend Homebrew and other common bin dirs so bare tool names resolve under MCP.
 */
export function augmentPathForToolchain(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const current = env.PATH || '';
  const parts = current.split(':').filter(Boolean);
  const prefix = COMMON_BIN_DIRS.filter((dir) => dir && !parts.includes(dir));
  if (prefix.length === 0) return env;
  return { ...env, PATH: [...prefix, ...parts].join(':') };
}

/**
 * Resolve a configured Bazel binary name or path to an absolute executable.
 * Falls back through `which` (with augmented PATH) and common install dirs.
 */
export function resolveBazelExecutable(configured: string): string {
  const trimmed = configured.trim() || 'bazel';

  if (trimmed.includes('/')) {
    return trimmed;
  }

  const env = augmentPathForToolchain();
  const names = trimmed === 'bazel'
    ? BAZEL_EXECUTABLE_NAMES
    : [trimmed, ...BAZEL_EXECUTABLE_NAMES.filter((name) => name !== trimmed)];

  for (const name of names) {
    try {
      const resolved = execFileSync('which', [name], { env, encoding: 'utf8' }).trim();
      if (resolved && isExecutable(resolved)) return resolved;
    } catch {
      // try next candidate
    }
  }

  for (const dir of COMMON_BIN_DIRS) {
    for (const name of names) {
      const full = join(dir, name);
      if (isExecutable(full)) return full;
    }
  }

  return trimmed;
}
