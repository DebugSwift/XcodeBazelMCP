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

  it('total definitions across all handlers is 117', () => {
    const total = handlers.reduce((sum, { mod }) => sum + mod.definitions.length, 0);
    expect(total).toBe(117);
  });
});
