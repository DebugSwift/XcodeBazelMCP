import { describe, expect, it } from 'vitest';
import type { CommandResult } from '../types/index.js';
import { formatCommandResult, structuredCommandResult, toolResult, toolText } from './output.js';

const okResult: CommandResult = {
  command: 'bazel',
  args: ['build', '//:MyApp'],
  exitCode: 0,
  durationMs: 12345,
  output: 'Build completed successfully.\n',
  truncated: false,
};

const failResult: CommandResult = {
  command: 'bazel',
  args: ['test', '//:Tests'],
  exitCode: 1,
  durationMs: 5678,
  output: 'FAILED: //Tests\nSome test failure output',
  truncated: true,
  signal: 'SIGTERM',
};

describe('formatCommandResult', () => {
  it('formats successful command', () => {
    const out = formatCommandResult(okResult);
    expect(out).toContain('OK exit=0');
    expect(out).toContain('duration=12.3s');
    expect(out).toContain('$ bazel build //:MyApp');
    expect(out).toContain('Build completed successfully.');
  });

  it('formats failed command with signal and truncation', () => {
    const out = formatCommandResult(failResult);
    expect(out).toContain('FAILED exit=1');
    expect(out).toContain('signal=SIGTERM');
    expect(out).toContain('duration=5.7s');
    expect(out).toContain('[output truncated]');
    expect(out).toContain('FAILED: //Tests');
  });

  it('annotates known Bazel exit codes on failure', () => {
    const out = formatCommandResult({ ...failResult, exitCode: 3, signal: null, truncated: false });
    expect(out).toContain('Bazel exit 3: tests failed or did not pass');
  });

  it('does not annotate exit codes for non-bazel commands', () => {
    const out = formatCommandResult({ ...failResult, command: 'xcrun', exitCode: 1, signal: null, truncated: false });
    expect(out).not.toContain('Bazel exit');
  });

  it('shows (no output) for empty output', () => {
    const out = formatCommandResult({ ...okResult, output: '' });
    expect(out).toContain('(no output)');
  });

  it('surfaces a timeout explicitly', () => {
    const out = formatCommandResult({
      ...failResult,
      truncated: false,
      timedOut: true,
      timeoutSeconds: 30,
      failureKind: 'timeout',
    });
    expect(out).toContain('kind=timeout');
    expect(out).toContain('TIMED OUT after 30s');
  });

  it('reports dropped characters on head+tail truncation', () => {
    const out = formatCommandResult({ ...okResult, exitCode: 1, truncated: true, bytesDropped: 4096 });
    expect(out).toContain('[output truncated: ~4096 characters dropped (head + tail kept)]');
  });

  it('surfaces failure category, diagnostics, and context for a build failure', () => {
    const out = formatCommandResult({
      command: 'bazel',
      args: ['build', '//a:b'],
      exitCode: 1,
      durationMs: 1000,
      output: '',
      stderr: "ERROR: no such target '//a:b'",
      truncated: false,
      failureKind: 'nonzero-exit',
      context: { bazel: 'bazel', workspace: '/ws', startupArgs: '(none)' },
    });
    expect(out).toContain('Failure category: missing_dependency');
    expect(out).toContain('Top diagnostics:');
    expect(out).toContain('Context:');
    expect(out).toContain('workspace: /ws');
  });

  it('does not print a bare "Failure category: unknown" for trivial failures', () => {
    const out = formatCommandResult({
      command: 'xcrun',
      args: ['simctl', 'boot', 'X'],
      exitCode: 164,
      durationMs: 50,
      output: 'Unable to boot device in current state: Booted',
      truncated: false,
      failureKind: 'nonzero-exit',
    });
    expect(out).not.toContain('Failure category');
  });

  it('flags spawn errors distinctly in the header', () => {
    const out = formatCommandResult({
      command: 'bazel',
      args: ['build'],
      exitCode: -1,
      durationMs: 5,
      output: 'Error: spawn bazel ENOENT',
      truncated: false,
      failureKind: 'spawn-error',
      spawnErrorCode: 'ENOENT',
    });
    expect(out).toContain('kind=spawn-error');
    expect(out).toContain('Failure category: spawn_error');
  });
});

describe('structuredCommandResult', () => {
  it('returns structured ok result', () => {
    const s = structuredCommandResult(okResult);
    expect(s.ok).toBe(true);
    expect(s.exitCode).toBe(0);
    expect(s.durationMs).toBe(12345);
    expect(s.truncated).toBe(false);
    expect(s.command).toBe('bazel build //:MyApp');
  });

  it('returns structured failed result with signal', () => {
    const s = structuredCommandResult(failResult);
    expect(s.ok).toBe(false);
    expect(s.exitCode).toBe(1);
    expect(s.signal).toBe('SIGTERM');
    expect(s.truncated).toBe(true);
  });

  it('carries failureKind, stderr, and classification fields', () => {
    const s = structuredCommandResult({
      command: 'bazel',
      args: ['build', '//a:b'],
      exitCode: 1,
      durationMs: 10,
      output: 'noise',
      stderr: '/Foo.swift:1:1: error: boom',
      truncated: false,
      failureKind: 'nonzero-exit',
      bytesDropped: 42,
    });
    expect(s.failureKind).toBe('nonzero-exit');
    expect(s.stderr).toBe('/Foo.swift:1:1: error: boom');
    expect(s.category).toBe('compile_error');
    expect(s.bytesDropped).toBe(42);
  });

  it('treats a timed-out command as not ok', () => {
    const s = structuredCommandResult({ ...okResult, timedOut: true, timeoutSeconds: 60, failureKind: 'timeout' });
    expect(s.ok).toBe(false);
    expect(s.timedOut).toBe(true);
    expect(s.timeoutSeconds).toBe(60);
  });
});

describe('toolText', () => {
  it('returns text content without error', () => {
    const r = toolText('hello');
    expect(r.content).toEqual([{ type: 'text', text: 'hello' }]);
    expect(r.isError).toBeUndefined();
  });

  it('returns text content with error flag', () => {
    const r = toolText('oops', true);
    const first = r.content[0];
    expect(first.type).toBe('text');
    expect(first.type === 'text' && first.text).toBe('oops');
    expect(r.isError).toBe(true);
  });
});

describe('toolResult', () => {
  it('returns text + structured content', () => {
    const r = toolResult('summary', { key: 'value' });
    const first = r.content[0];
    expect(first.type).toBe('text');
    expect(first.type === 'text' && first.text).toBe('summary');
    expect(r.structuredContent).toEqual({ key: 'value' });
    expect(r.isError).toBeUndefined();
  });

  it('marks error when flagged', () => {
    const r = toolResult('failed', {}, true);
    expect(r.isError).toBe(true);
  });
});
