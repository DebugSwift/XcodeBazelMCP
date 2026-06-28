import { describe, it, expect } from 'vitest';
import * as session from './session.js';
import * as build from './build.js';
import * as simulator from './simulator.js';
import * as device from './device.js';
import * as lldb from './lldb.js';
import * as macos from './macos.js';
import * as multiPlatform from './multi-platform.js';
import * as spm from './spm.js';
import * as scaffold from './scaffold.js';
import * as uiAutomation from './ui-automation.js';
import * as agentDebug from './agent-debug.js';
import * as xcode from './xcode.js';

const handlers = [
  { label: 'session', mod: session },
  { label: 'build', mod: build },
  { label: 'simulator', mod: simulator },
  { label: 'device', mod: device },
  { label: 'lldb', mod: lldb },
  { label: 'macos', mod: macos },
  { label: 'multiPlatform', mod: multiPlatform },
  { label: 'spm', mod: spm },
  { label: 'scaffold', mod: scaffold },
  { label: 'uiAutomation', mod: uiAutomation },
  { label: 'agentDebug', mod: agentDebug },
  { label: 'xcode', mod: xcode },
] as const;

describe('handler modules', () => {
  for (const { label, mod } of handlers) {
    describe(label, () => {
      it('has non-empty definitions', () => {
        expect(mod.definitions.length).toBeGreaterThan(0);
      });

      it('canHandle returns true for its own tools', () => {
        for (const def of mod.definitions) {
          expect(mod.canHandle(def.name), `${label} should handle ${def.name}`).toBe(true);
        }
      });

      it('canHandle returns false for a foreign tool', () => {
        expect(mod.canHandle('__nonexistent_tool__')).toBe(false);
      });

      it('handle returns undefined for unknown tool', async () => {
        const result = await mod.handle('__nonexistent_tool__', {});
        expect(result).toBeUndefined();
      });
    });
  }

  it('no tool name appears in more than one handler', () => {
    const seen = new Map<string, string>();
    for (const { label, mod } of handlers) {
      for (const def of mod.definitions) {
        expect(seen.has(def.name), `"${def.name}" in both ${seen.get(def.name)} and ${label}`).toBe(false);
        seen.set(def.name, label);
      }
    }
  });

  it('total definitions across all handlers is 125', () => {
    const total = handlers.reduce((sum, { mod }) => sum + mod.definitions.length, 0);
    expect(total).toBe(125);
  });
});

describe('ui-automation coordinate validation', () => {
  it('tap rejects missing coordinates instead of sending NaN', async () => {
    await expect(uiAutomation.handle('bazel_ios_tap', {})).rejects.toThrow('x must be a finite number');
  });

  it('tap rejects a non-numeric y', async () => {
    await expect(uiAutomation.handle('bazel_ios_tap', { x: 10, y: 'oops' })).rejects.toThrow(
      'y must be a finite number',
    );
  });

  it('pinch rejects missing scale', async () => {
    await expect(uiAutomation.handle('bazel_ios_pinch', { x: 1, y: 2 })).rejects.toThrow(
      'scale must be a finite number',
    );
  });

  it('drag rejects missing toX/toY', async () => {
    await expect(uiAutomation.handle('bazel_ios_drag', { fromX: 1, fromY: 2 })).rejects.toThrow(
      'toX must be a finite number',
    );
  });
});

describe('set_defaults validation', () => {
  it('rejects an invalid buildMode', async () => {
    await expect(session.handle('bazel_ios_set_defaults', { buildMode: 'fast' })).rejects.toThrow(
      'Invalid buildMode',
    );
  });

  it('rejects an invalid platform', async () => {
    await expect(session.handle('bazel_ios_set_defaults', { platform: 'iphone' })).rejects.toThrow(
      'Invalid platform',
    );
  });
});

describe('spm/macos input validation', () => {
  it('swift_package_init rejects an invalid type before spawning', async () => {
    await expect(spm.handle('swift_package_init', { type: 'bogus' })).rejects.toThrow(
      'Invalid package type',
    );
  });

  it('bazel_macos_log rejects an invalid level', async () => {
    await expect(macos.handle('bazel_macos_log', { level: 'verbose' })).rejects.toThrow(
      'Invalid level',
    );
  });

  it('bazel_macos_log rejects a processName with control characters', async () => {
    await expect(macos.handle('bazel_macos_log', { processName: 'bad\nname' })).rejects.toThrow(
      'processName contains invalid characters',
    );
  });

  it('bazel_macos_bundle_id requires appPath (clean error, not a crash)', async () => {
    await expect(macos.handle('bazel_macos_bundle_id', {})).rejects.toThrow('appPath is required');
  });

  it('bazel_ios_open_url rejects a schemeless URL before touching a simulator', async () => {
    await expect(simulator.handle('bazel_ios_open_url', { url: 'not a url' })).rejects.toThrow('no scheme');
  });

  it('bazel_ios_open_url rejects an empty URL', async () => {
    await expect(simulator.handle('bazel_ios_open_url', { url: '  ' })).rejects.toThrow('url is required');
  });

  it('bazel_ios_set_simulator_location rejects out-of-range coordinates before touching a simulator', async () => {
    await expect(simulator.handle('bazel_ios_set_simulator_location', { latitude: 200, longitude: 0 })).rejects.toThrow('latitude must be between');
    await expect(simulator.handle('bazel_ios_set_simulator_location', { latitude: 0, longitude: 999 })).rejects.toThrow('longitude must be between');
  });

  it('uninstall tools require a bundleId before touching a device/simulator', async () => {
    await expect(simulator.handle('bazel_ios_uninstall_app', {})).rejects.toThrow('bundleId is required');
    await expect(device.handle('bazel_ios_device_uninstall_app', {})).rejects.toThrow('bundleId is required');
  });

  it('add_media rejects an empty paths list and missing files', async () => {
    await expect(simulator.handle('bazel_ios_add_media', { paths: [] })).rejects.toThrow('paths is required');
    await expect(simulator.handle('bazel_ios_add_media', { paths: ['/no/such/file.png'] })).rejects.toThrow('not found');
  });

  it('get_app_container requires a bundleId', async () => {
    await expect(simulator.handle('bazel_ios_get_app_container', {})).rejects.toThrow('bundleId is required');
  });
});

describe('xcode native mcp tools', () => {
  it('status returns structured detection without throwing', async () => {
    const result = await xcode.handle('bazel_xcode_native_mcp_status', {});
    expect(result?.structuredContent).toBeDefined();
    const sc = result!.structuredContent as Record<string, unknown>;
    expect(sc.bridge).toEqual({ command: 'xcrun', args: ['mcpbridge'], env: undefined });
    expect(typeof sc.bridgeAvailable).toBe('boolean');
    expect(Array.isArray(sc.installs)).toBe(true);
  });
});

describe('lldb attach validation', () => {
  it('requires pid or processName', async () => {
    await expect(lldb.handle('bazel_ios_lldb_attach', {})).rejects.toThrow(
      'Either pid or processName is required',
    );
  });

  it('rejects waitFor combined with pid', async () => {
    await expect(
      lldb.handle('bazel_ios_lldb_attach', { pid: 123, waitFor: true }),
    ).rejects.toThrow('waitFor cannot be combined with pid');
  });

  it('rejects a non-finite pid', async () => {
    await expect(lldb.handle('bazel_ios_lldb_attach', { pid: NaN })).rejects.toThrow(
      'pid must be a finite number',
    );
  });
});
