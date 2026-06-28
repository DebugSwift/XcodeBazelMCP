import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deviceHubPathForApp,
  developerDirForApp,
  findXcodeApps,
  inspectXcodeApp,
  mcpBridgeInvocation,
  xcodeMcpClientConfig,
} from './xcode-mcp.js';

describe('mcpBridgeInvocation', () => {
  it('uses xcrun mcpbridge without DEVELOPER_DIR by default', () => {
    expect(mcpBridgeInvocation()).toEqual({ command: 'xcrun', args: ['mcpbridge'], env: undefined });
  });

  it('pins DEVELOPER_DIR when a specific Xcode is requested', () => {
    expect(mcpBridgeInvocation('/Applications/Xcode-beta.app/Contents/Developer')).toEqual({
      command: 'xcrun',
      args: ['mcpbridge'],
      env: { DEVELOPER_DIR: '/Applications/Xcode-beta.app/Contents/Developer' },
    });
  });
});

describe('xcodeMcpClientConfig', () => {
  it('produces a Cursor/Claude-style mcpServers snippet', () => {
    expect(xcodeMcpClientConfig()).toEqual({
      mcpServers: { 'xcode-native': { command: 'xcrun', args: ['mcpbridge'] } },
    });
  });

  it('includes env when a developer dir is given', () => {
    const cfg = xcodeMcpClientConfig('/X/Contents/Developer') as {
      mcpServers: { 'xcode-native': { env?: Record<string, string> } };
    };
    expect(cfg.mcpServers['xcode-native'].env).toEqual({ DEVELOPER_DIR: '/X/Contents/Developer' });
  });
});

describe('developerDirForApp', () => {
  it('appends Contents/Developer', () => {
    expect(developerDirForApp('/Applications/Xcode.app')).toBe('/Applications/Xcode.app/Contents/Developer');
  });
});

describe('filesystem detection', () => {
  let root: string;

  function makeApp(name: string, opts: { mcpbridge?: boolean; lldbMcp?: boolean; deviceHub?: boolean }): string {
    const app = join(root, name);
    const bin = join(app, 'Contents', 'Developer', 'usr', 'bin');
    mkdirSync(bin, { recursive: true });
    if (opts.mcpbridge) writeFileSync(join(bin, 'mcpbridge'), '');
    if (opts.lldbMcp) writeFileSync(join(bin, 'lldb-mcp'), '');
    if (opts.deviceHub) mkdirSync(join(app, 'Contents', 'Applications', 'DeviceHub.app'), { recursive: true });
    return app;
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'xcode-apps-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('finds only Xcode*.app entries', () => {
    makeApp('Xcode.app', { mcpbridge: true });
    makeApp('Xcode-beta.app', { mcpbridge: true, lldbMcp: true, deviceHub: true });
    mkdirSync(join(root, 'NotXcode.app'), { recursive: true });
    const apps = findXcodeApps(root);
    expect(apps).toEqual([join(root, 'Xcode-beta.app'), join(root, 'Xcode.app')]);
  });

  it('detects stable 26.3 (mcpbridge only)', () => {
    const app = makeApp('Xcode.app', { mcpbridge: true });
    const info = inspectXcodeApp(app);
    expect(info.hasMcpBridge).toBe(true);
    expect(info.hasLldbMcp).toBe(false);
    expect(info.deviceHubPath).toBeNull();
    expect(info.isBeta).toBe(false);
  });

  it('detects beta (lldb-mcp + DeviceHub)', () => {
    const app = makeApp('Xcode-beta.app', { mcpbridge: true, lldbMcp: true, deviceHub: true });
    const info = inspectXcodeApp(app);
    expect(info.isBeta).toBe(true);
    expect(info.hasLldbMcp).toBe(true);
    expect(info.deviceHubPath).toBe(join(app, 'Contents', 'Applications', 'DeviceHub.app'));
  });

  it('deviceHubPathForApp returns null when absent', () => {
    const app = makeApp('Xcode.app', { mcpbridge: true });
    expect(deviceHubPathForApp(app)).toBeNull();
  });

  it('returns [] for a missing apps root', () => {
    expect(findXcodeApps(join(root, 'does-not-exist'))).toEqual([]);
  });
});
