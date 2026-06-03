import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const CLI = resolve(import.meta.dirname, 'cli.ts');
const run = (args: string[]) =>
  execFileSync('npx', ['tsx', CLI, ...args], {
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });

describe('CLI help', () => {
  it('prints help with usage sections', () => {
    const out = run(['help']);
    expect(out).toContain('XcodeBazelMCP');
    expect(out).toContain('Usage:');
    expect(out).toContain('xcodebazelmcp mcp');
    expect(out).toContain('Build & Run:');
    expect(out).toContain('Query & Inspect:');
    expect(out).toContain('Config & Defaults:');
    expect(out).toContain('Simulator:');
    expect(out).toContain('Device:');
    expect(out).toContain('macOS:');
    expect(out).toContain('tvOS:');
    expect(out).toContain('watchOS:');
    expect(out).toContain('visionOS:');
    expect(out).toContain('Daemon:');
    expect(out).toContain('Scaffold:');
    expect(out).toContain('Swift Package (SPM):');
    expect(out).toContain('UI Automation:');
    expect(out).toContain('App Interaction:');
    expect(out).toContain('Debugging (LLDB):');
    expect(out).toContain('Logging:');
  });

  it('prints help on unknown command', () => {
    const out = run(['nonexistent-command']);
    expect(out).toContain('Usage:');
  });
});

describe('CLI tools', () => {
  it('lists all 116 tools', () => {
    const out = run(['tools']);
    const toolLines = out
      .split('\n')
      .filter((line) => line.match(/^[a-z_]+$/));
    expect(toolLines.length).toBe(116);
    expect(out).toContain('bazel_ios_build');
    expect(out).toContain('bazel_macos_build');
    expect(out).toContain('bazel_tvos_build');
    expect(out).toContain('bazel_watchos_build');
    expect(out).toContain('bazel_visionos_build');
    expect(out).toContain('swift_package_build');
    expect(out).toContain('bazel_scaffold');
    expect(out).toContain('bazel_daemon_start');
    expect(out).toContain('bazel_check_update');
    expect(out).toContain('bazel_ios_tap');
    expect(out).toContain('bazel_ios_accessibility_snapshot');
  });
});

describe('CLI defaults', () => {
  it('shows defaults with no session set', () => {
    const out = run(['defaults']);
    expect(out).toContain('No session defaults set');
  });
});

describe('CLI templates', () => {
  it('lists scaffold templates', () => {
    const out = run(['templates']);
    expect(out).toContain('ios_app');
    expect(out).toContain('ios_test');
    expect(out).toContain('ios_app_with_tests');
    expect(out).toContain('macos_app');
    expect(out).toContain('macos_test');
    expect(out).toContain('macos_app_with_tests');
  });
});

describe('CLI profiles', () => {
  it('lists profiles (empty when no config)', () => {
    const out = run(['profiles']);
    expect(out).toBeDefined();
  });
});

describe('CLI LLDB sessions', () => {
  it('lists sessions (empty)', () => {
    const out = run(['lldb-sessions']);
    expect(out).toBeDefined();
  });
});

describe('CLI check-update', () => {
  it('reports current version', () => {
    const out = run(['check-update']);
    expect(out).toContain('Current version:');
    expect(out).toContain('Install method:');
  });
});
