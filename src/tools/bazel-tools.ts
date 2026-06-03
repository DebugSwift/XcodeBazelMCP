import type { JsonObject, ToolCallResult, ToolDefinition } from '../types/index.js';
import { applyDefaults } from './helpers.js';

import * as session from './handlers/session.js';
import * as build from './handlers/build.js';
import * as simulator from './handlers/simulator.js';
import * as device from './handlers/device.js';
import * as lldb from './handlers/lldb.js';
import * as macos from './handlers/macos.js';
import * as multiPlatform from './handlers/multi-platform.js';
import * as spm from './handlers/spm.js';
import * as scaffold from './handlers/scaffold.js';
import * as uiAutomation from './handlers/ui-automation.js';
import * as agentDebug from './handlers/agent-debug.js';

const handlerModules = [
  session, build, simulator, device, lldb,
  macos, multiPlatform, spm, scaffold, uiAutomation, agentDebug,
];

export const bazelToolDefinitions: ToolDefinition[] = handlerModules.flatMap(m => m.definitions);

export async function callBazelTool(name: string, args: JsonObject = {}): Promise<ToolCallResult> {
  args = applyDefaults(args);
  for (const mod of handlerModules) {
    if (mod.canHandle(name)) {
      const result = await mod.handle(name, args);
      if (result) return result;
    }
  }
  throw new Error(`Unknown tool: ${name}`);
}
