import { describe, it, expect } from 'vitest';
import { classifyFailure, extractInvocationUrl } from './diagnostics.js';
import type { CommandResult } from '../types/index.js';

function res(partial: Partial<CommandResult>): CommandResult {
  return {
    command: 'bazel',
    args: ['build', '//x'],
    exitCode: 1,
    durationMs: 100,
    output: '',
    truncated: false,
    ...partial,
  };
}

describe('extractInvocationUrl', () => {
  it('pulls a BuildBuddy invocation URL', () => {
    const text = 'INFO: Streaming build results to: https://app.buildbuddy.io/invocation/abc-123\nLoading...';
    expect(extractInvocationUrl(text)).toBe('https://app.buildbuddy.io/invocation/abc-123');
  });

  it('trims trailing punctuation', () => {
    expect(extractInvocationUrl('see (https://x.buildbuddy.io/invocation/zzz).')).toBe(
      'https://x.buildbuddy.io/invocation/zzz',
    );
  });

  it('returns undefined when absent', () => {
    expect(extractInvocationUrl('no url here')).toBeUndefined();
  });
});

describe('classifyFailure', () => {
  it('returns undefined for success', () => {
    expect(classifyFailure(res({ exitCode: 0, failureKind: 'ok' }))).toBeUndefined();
  });

  it('classifies timeouts', () => {
    const c = classifyFailure(res({ timedOut: true, failureKind: 'timeout' }));
    expect(c?.category).toBe('timeout');
  });

  it('classifies spawn errors', () => {
    const c = classifyFailure(res({ exitCode: -1, failureKind: 'spawn-error', spawnErrorCode: 'ENOENT', output: 'Error: spawn bazel ENOENT' }));
    expect(c?.category).toBe('spawn_error');
    expect(c?.diagnostics[0]).toContain('ENOENT');
  });

  it('classifies analysis errors', () => {
    const c = classifyFailure(res({ stderr: 'ERROR: Analysis of target //a:b failed; build aborted' }));
    expect(c?.category).toBe('analysis_error');
  });

  it('classifies BUILD file errors', () => {
    const c = classifyFailure(res({ stderr: "ERROR: no such package '//missing': BUILD file not found" }));
    expect(c?.category).toBe('build_file_error');
  });

  it('classifies missing dependency / visibility errors', () => {
    const c = classifyFailure(res({ stderr: "ERROR: target '//a:b' is not visible to target '//c:d'" }));
    expect(c?.category).toBe('missing_dependency');
  });

  it('classifies link errors', () => {
    const c = classifyFailure(res({ stderr: 'Undefined symbols for architecture arm64:\n  "_foo"\nld: symbol(s) not found' }));
    expect(c?.category).toBe('link_error');
  });

  it('classifies compile errors', () => {
    const c = classifyFailure(res({ stderr: '/path/Foo.swift:12:5: error: cannot find "bar" in scope' }));
    expect(c?.category).toBe('compile_error');
    expect(c?.diagnostics.some((d) => d.includes('error:'))).toBe(true);
  });

  it('classifies test failures', () => {
    const c = classifyFailure(res({ stderr: 'Test Suite "MyTests" failed\nExecuted 3 tests, with 1 failure' }));
    expect(c?.category).toBe('test_failure');
  });

  it('prefers stderr and surfaces the invocation URL', () => {
    const c = classifyFailure(res({
      stderr: 'INFO: Streaming build results to: https://app.buildbuddy.io/invocation/xyz\n/a.swift:1:1: error: boom',
      output: 'progress noise',
    }));
    expect(c?.category).toBe('compile_error');
    expect(c?.invocationUrl).toBe('https://app.buildbuddy.io/invocation/xyz');
  });

  it('falls back to unknown for unrecognized failures', () => {
    const c = classifyFailure(res({ stderr: 'something went sideways' }));
    expect(c?.category).toBe('unknown');
  });
});
