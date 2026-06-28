import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

/** Rotate the log to `<path>.1` once it grows past this size, keeping ≤ 2x on disk. */
const DEFAULT_MAX_LOG_BYTES = 5 * 1024 * 1024;

function maxLogBytes(): number {
  const override = Number(process.env.BAZEL_IOS_COMMAND_LOG_MAX_BYTES);
  return Number.isFinite(override) && override > 0 ? override : DEFAULT_MAX_LOG_BYTES;
}

export interface CommandLogEntry {
  id?: string;
  timestamp: number;
  argv: string[];
  cwd?: string;
  envOverrides?: string[];
  exitCode: number;
  durationMs: number;
  truncated?: boolean;
  failureKind?: string;
  timedOut?: boolean;
  bytesDropped?: number;
}

/**
 * Path of the persistent NDJSON command log. Override with
 * `BAZEL_IOS_COMMAND_LOG`. Defaults to `~/.xcodebazelmcp/commands.ndjson`.
 */
export function commandLogPath(): string {
  return process.env.BAZEL_IOS_COMMAND_LOG || join(homedir(), '.xcodebazelmcp', 'commands.ndjson');
}

/**
 * Append one command invocation to the persistent NDJSON log. Best-effort: a
 * logging failure must never break the actual command. A postmortem is then a
 * `tail` away, surviving restarts (unlike the in-memory lastCommand).
 */
export function logCommand(entry: CommandLogEntry): void {
  if (process.env.BAZEL_IOS_COMMAND_LOG_DISABLE === '1') return;
  try {
    const path = commandLogPath();
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path) && statSync(path).size >= maxLogBytes()) {
      renameSync(path, `${path}.1`); // overwrites a previous .1; bounds disk to ~2x
    }
    appendFileSync(path, JSON.stringify(entry) + '\n');
  } catch {
    /* best effort — never throw from logging */
  }
}

/** Read the most recent command log entries (newest last). */
export function readRecentCommands(limit = 20): CommandLogEntry[] {
  const path = commandLogPath();
  const entries: CommandLogEntry[] = [];
  // Read the rotated file first (older entries), then the active file, so the
  // most-recent N span the rotation boundary instead of being truncated to
  // whatever survived the last rename.
  for (const p of [`${path}.1`, path]) {
    if (!existsSync(p)) continue;
    for (const raw of readFileSync(p, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      try {
        entries.push(JSON.parse(line) as CommandLogEntry);
      } catch {
        /* skip malformed line */
      }
    }
  }
  return limit > 0 ? entries.slice(-limit) : entries;
}
