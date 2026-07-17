import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const WORKSPACE_MARKERS = ['MODULE.bazel', 'WORKSPACE', 'WORKSPACE.bazel'] as const;

export function isBazelWorkspace(workspacePath: string): boolean {
  if (!existsSync(workspacePath) || !statSync(workspacePath).isDirectory()) {
    return false;
  }
  return WORKSPACE_MARKERS.some((marker) => existsSync(join(workspacePath, marker)));
}

/**
 * Walk upward from each start directory and return the first Bazel workspace root.
 */
export function discoverBazelWorkspace(startDirs: string[]): string | undefined {
  const seen = new Set<string>();

  for (const start of startDirs) {
    if (!start?.trim()) continue;
    let dir = resolve(start.trim());

    for (let depth = 0; depth < 64; depth += 1) {
      if (seen.has(dir)) break;
      seen.add(dir);

      if (isBazelWorkspace(dir)) return dir;

      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  return undefined;
}

export function assertBazelWorkspace(workspacePath: string): void {
  if (!existsSync(workspacePath) || !statSync(workspacePath).isDirectory()) {
    throw new Error(`Workspace does not exist or is not a directory: ${workspacePath}`);
  }

  if (!isBazelWorkspace(workspacePath)) {
    throw new Error(`Workspace has no MODULE.bazel, WORKSPACE, or WORKSPACE.bazel: ${workspacePath}`);
  }
}

export function readBspStatus(workspacePath: string): string[] {
  const bspPath = join(workspacePath, '.bsp', 'skbsp.json');
  const lines = [
    `workspace: ${workspacePath}`,
    `.bsp/skbsp.json: ${existsSync(bspPath) ? 'found' : 'missing'}`,
  ];

  if (existsSync(bspPath)) {
    try {
      const config = JSON.parse(readFileSync(bspPath, 'utf8')) as {
        name?: string;
        argv?: string[];
      };
      lines.push(`name: ${config.name || '(unknown)'}`);
      lines.push(`argv: ${Array.isArray(config.argv) ? config.argv.join(' ') : '(missing)'}`);
    } catch (err) {
      lines.push(`parse error: ${(err as Error).message}`);
    }
  }

  return lines;
}
