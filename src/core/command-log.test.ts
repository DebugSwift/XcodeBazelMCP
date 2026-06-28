import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandLogPath, logCommand, readRecentCommands } from './command-log.js';

let dir: string;
const prevEnv = process.env.BAZEL_IOS_COMMAND_LOG;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cmdlog-'));
  process.env.BAZEL_IOS_COMMAND_LOG = join(dir, 'commands.ndjson');
  delete process.env.BAZEL_IOS_COMMAND_LOG_DISABLE;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (prevEnv === undefined) delete process.env.BAZEL_IOS_COMMAND_LOG;
  else process.env.BAZEL_IOS_COMMAND_LOG = prevEnv;
});

describe('command-log', () => {
  it('uses the env override for the log path', () => {
    expect(commandLogPath()).toBe(join(dir, 'commands.ndjson'));
  });

  it('appends NDJSON entries and reads them back', () => {
    logCommand({ id: 'aaa', timestamp: 1, argv: ['bazel', 'build', '//a'], exitCode: 0, durationMs: 10 });
    logCommand({ id: 'bbb', timestamp: 2, argv: ['bazel', 'test', '//b'], exitCode: 1, durationMs: 20, failureKind: 'nonzero-exit' });

    const raw = readFileSync(commandLogPath(), 'utf8').trim().split('\n');
    expect(raw).toHaveLength(2);
    expect(JSON.parse(raw[0]).id).toBe('aaa');

    const entries = readRecentCommands();
    expect(entries.map((e) => e.id)).toEqual(['aaa', 'bbb']);
    expect(entries[1].failureKind).toBe('nonzero-exit');
  });

  it('respects the limit (newest last)', () => {
    for (let i = 0; i < 5; i++) {
      logCommand({ timestamp: i, argv: ['bazel', String(i)], exitCode: 0, durationMs: 1 });
    }
    const entries = readRecentCommands(2);
    expect(entries.map((e) => e.argv[1])).toEqual(['3', '4']);
  });

  it('returns empty when no log exists', () => {
    expect(readRecentCommands()).toEqual([]);
    expect(existsSync(commandLogPath())).toBe(false);
  });

  it('does not write when disabled', () => {
    process.env.BAZEL_IOS_COMMAND_LOG_DISABLE = '1';
    logCommand({ timestamp: 1, argv: ['bazel'], exitCode: 0, durationMs: 1 });
    expect(existsSync(commandLogPath())).toBe(false);
  });

  it('reads across the rotated .1 file so recent entries survive rotation', () => {
    const path = commandLogPath();
    // Older generation lives in .1, newer in the active file.
    writeFileSync(`${path}.1`, [
      JSON.stringify({ id: 'old1', timestamp: 1, argv: ['bazel', '1'], exitCode: 0, durationMs: 1 }),
      JSON.stringify({ id: 'old2', timestamp: 2, argv: ['bazel', '2'], exitCode: 0, durationMs: 1 }),
    ].join('\n') + '\n');
    writeFileSync(path, JSON.stringify({ id: 'new1', timestamp: 3, argv: ['bazel', '3'], exitCode: 0, durationMs: 1 }) + '\n');

    expect(readRecentCommands().map((e) => e.id)).toEqual(['old1', 'old2', 'new1']);
    // The limit applies across both files, keeping the newest.
    expect(readRecentCommands(2).map((e) => e.id)).toEqual(['old2', 'new1']);
  });

  it('rotates to .1 once the size cap is exceeded (bounded growth)', () => {
    process.env.BAZEL_IOS_COMMAND_LOG_MAX_BYTES = '200';
    try {
      for (let i = 0; i < 50; i++) {
        logCommand({ id: `id-${i}`, timestamp: i, argv: ['bazel', 'build', `//pkg:t${i}`], exitCode: 0, durationMs: 1 });
      }
      // The active log was rotated at least once, so a .1 sibling exists...
      expect(existsSync(`${commandLogPath()}.1`)).toBe(true);
      // ...and the active log stays bounded (not all 50 entries pile up).
      expect(readRecentCommands(1000).length).toBeLessThan(50);
    } finally {
      delete process.env.BAZEL_IOS_COMMAND_LOG_MAX_BYTES;
    }
  });
});
