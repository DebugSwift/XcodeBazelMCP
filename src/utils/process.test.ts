import { describe, it, expect } from 'vitest';
import { runCommand, BoundedCapture } from './process.js';

const opts = { cwd: process.cwd(), maxOutput: 1_000_000 } as const;

describe('runCommand', () => {
  it('captures stdout and a zero exit code', async () => {
    const result = await runCommand('node', ['-e', 'process.stdout.write("hello")'], opts);
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe('hello');
    expect(result.truncated).toBe(false);
    expect(result.failureKind).toBe('ok');
    expect(result.stdout).toBe('hello');
    expect(result.stderr).toBe('');
  });

  it('keeps stdout and stderr as distinct channels', async () => {
    const result = await runCommand(
      'node',
      ['-e', 'process.stdout.write("OUT"); process.stderr.write("ERRLINE")'],
      opts,
    );
    expect(result.stdout).toBe('OUT');
    expect(result.stderr).toBe('ERRLINE');
    expect(result.output).toContain('OUT');
    expect(result.output).toContain('ERRLINE');
  });

  it('reports a non-zero exit code with failureKind', async () => {
    const result = await runCommand('node', ['-e', 'process.exit(3)'], opts);
    expect(result.exitCode).toBe(3);
    expect(result.failureKind).toBe('nonzero-exit');
  });

  it('preserves multi-byte UTF-8 output without corruption', async () => {
    const result = await runCommand('node', ['-e', 'process.stdout.write("café — 🚀")'], opts);
    expect(result.output).toBe('café — 🚀');
    expect(result.output).not.toContain('\uFFFD');
  });

  it('head+tail truncates and reports dropped characters', async () => {
    const result = await runCommand(
      'node',
      ['-e', 'process.stdout.write("H".repeat(2500) + "T".repeat(2500))'],
      { cwd: process.cwd(), maxOutput: 100 },
    );
    expect(result.truncated).toBe(true);
    expect(result.bytesDropped).toBeGreaterThan(0);
    // Tail (the real error location) must survive.
    expect(result.output).toContain('T');
    // Head must survive too.
    expect(result.output).toContain('H');
    expect(result.output).toContain('characters dropped');
  });

  it('flags spawn errors distinctly from crashes', async () => {
    const result = await runCommand('definitely-not-a-real-binary-xyz', [], opts);
    expect(result.exitCode).toBe(-1);
    expect(result.failureKind).toBe('spawn-error');
    expect(result.spawnErrorCode).toBe('ENOENT');
  });

  it('flags a timeout explicitly', async () => {
    const result = await runCommand(
      'node',
      ['-e', 'setTimeout(() => {}, 10000)'],
      { cwd: process.cwd(), maxOutput: 1000, timeoutSeconds: 1 },
    );
    expect(result.timedOut).toBe(true);
    expect(result.failureKind).toBe('timeout');
    expect(result.timeoutSeconds).toBe(1);
  });
});

describe('BoundedCapture', () => {
  it('returns full text when under the limit', () => {
    const cap = new BoundedCapture(1000);
    cap.push('hello world');
    expect(cap.result()).toBe('hello world');
    expect(cap.truncated).toBe(false);
    expect(cap.bytesDropped).toBe(0);
  });

  it('keeps head and tail and drops the middle', () => {
    const cap = new BoundedCapture(10); // head=4, tail=6
    cap.push('AAAA' + 'x'.repeat(50) + 'ZZZZZZ');
    expect(cap.truncated).toBe(true);
    expect(cap.bytesDropped).toBe(50);
    expect(cap.result().startsWith('AAAA')).toBe(true);
    expect(cap.result().endsWith('ZZZZZZ')).toBe(true);
    expect(cap.result()).toContain('characters dropped');
  });
});
