import type { JsonObject, ToolCallResult, ToolDefinition } from '../../types/index.js';
import { stringOrUndefined } from '../helpers.js';
import {
  attachByName,
  attachToProcess,
  continueExecution,
  deleteBreakpoint,
  detach,
  evaluateExpression,
  getBacktrace,
  getThreadList,
  getVariables,
  listBreakpoints,
  listSessions,
  runLldbCommand,
  selectFrame,
  selectThread,
  setBreakpoint,
  stepInto,
  stepOut,
  stepOver,
} from '../../core/lldb.js';
import { resolveDevice } from '../../core/devices.js';
import { toolText } from '../../utils/output.js';

export const definitions: ToolDefinition[] = [
  {
    name: 'bazel_ios_lldb_attach',
    description: 'Attach LLDB debugger to a running process by PID or process name. Returns a session ID for subsequent debug commands.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number', description: 'Process ID to attach to.' },
        processName: { type: 'string', description: 'Process name to attach to (alternative to pid).' },
        waitFor: { type: 'boolean', description: 'Wait for the process to launch before attaching (only with processName).' },
        target: { type: 'string', enum: ['simulator', 'device'], description: 'Target type (default: simulator). Use "device" for physical iOS devices.' },
        deviceId: { type: 'string', description: 'Device UDID (required when target is "device").' },
        deviceName: { type: 'string', description: 'Device name (alternative to deviceId for device target).' },
      },
    },
  },
  {
    name: 'bazel_ios_lldb_detach',
    description: 'Detach LLDB from a process and end the debug session.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'LLDB session ID from lldb_attach.' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'bazel_ios_lldb_breakpoint',
    description: 'Set a breakpoint by file+line, symbol name, or delete/list breakpoints.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'LLDB session ID.' },
        action: { type: 'string', enum: ['set', 'delete', 'list'], description: 'Breakpoint action.' },
        file: { type: 'string', description: 'Source file path (for set action).' },
        line: { type: 'number', description: 'Line number (for set action, requires file).' },
        symbol: { type: 'string', description: 'Function/method name to break on (for set action).' },
        module: { type: 'string', description: 'Shared library / module to scope the breakpoint.' },
        condition: { type: 'string', description: 'Breakpoint condition expression.' },
        oneShot: { type: 'boolean', description: 'Auto-delete after first hit.' },
        breakpointId: { type: 'number', description: 'Breakpoint ID (for delete action).' },
      },
      required: ['sessionId', 'action'],
    },
  },
  {
    name: 'bazel_ios_lldb_backtrace',
    description: 'Get the call stack (backtrace) for the current or specified thread.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'LLDB session ID.' },
        threadIndex: { type: 'number', description: 'Thread index (default: current thread).' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'bazel_ios_lldb_variables',
    description: 'Inspect local variables, arguments, or all frame variables at the current stop point.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'LLDB session ID.' },
        scope: { type: 'string', enum: ['local', 'args', 'all'], description: 'Variable scope (default: all).' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'bazel_ios_lldb_expression',
    description: 'Evaluate an expression in the current frame context (e.g. print a variable, call a method).',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'LLDB session ID.' },
        expression: { type: 'string', description: 'Expression to evaluate (Swift or ObjC).' },
      },
      required: ['sessionId', 'expression'],
    },
  },
  {
    name: 'bazel_ios_lldb_step',
    description: 'Step through code: over (next line), into (enter function), or out (finish function).',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'LLDB session ID.' },
        action: { type: 'string', enum: ['over', 'into', 'out', 'continue'], description: 'Step action.' },
      },
      required: ['sessionId', 'action'],
    },
  },
  {
    name: 'bazel_ios_lldb_threads',
    description: 'List all threads or select a specific thread/frame for inspection.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'LLDB session ID.' },
        selectThread: { type: 'number', description: 'Switch to this thread index.' },
        selectFrame: { type: 'number', description: 'Switch to this frame index within the current thread.' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'bazel_ios_lldb_command',
    description: 'Run an arbitrary LLDB command. Use for advanced debugging not covered by other tools.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'LLDB session ID.' },
        command: { type: 'string', description: 'Raw LLDB command to execute.' },
      },
      required: ['sessionId', 'command'],
    },
  },
  {
    name: 'bazel_ios_lldb_sessions',
    description: 'List active LLDB debug sessions.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const HANDLED = new Set(definitions.map(d => d.name));

export function canHandle(name: string): boolean {
  return HANDLED.has(name);
}

export async function handle(name: string, args: JsonObject): Promise<ToolCallResult | undefined> {
  switch (name) {
    case 'bazel_ios_lldb_attach': {
      const hasPid = typeof args.pid === 'number';
      if (!hasPid && typeof args.processName !== 'string') {
        throw new Error('Either pid or processName is required.');
      }
      if (hasPid && !Number.isFinite(args.pid as number)) {
        throw new Error('pid must be a finite number.');
      }
      if (hasPid && args.waitFor === true) {
        throw new Error('waitFor cannot be combined with pid; it only applies when attaching by processName.');
      }
      const target = (args.target as 'simulator' | 'device') || 'simulator';

      let deviceIdentifier: string | undefined;
      if (target === 'device') {
        const device = await resolveDevice({
          deviceId: stringOrUndefined(args.deviceId),
          deviceName: stringOrUndefined(args.deviceName),
        });
        deviceIdentifier = device.coreDeviceIdentifier;
        if (!deviceIdentifier) {
          throw new Error(`CoreDevice identifier not available for ${device.name}. Cannot attach LLDB to device.`);
        }
      }

      if (typeof args.pid === 'number') {
        const { sessionId, output } = await attachToProcess(args.pid, `pid:${args.pid}`, target, deviceIdentifier);
        return toolText(`LLDB attached.\nSession ID: ${sessionId}\nPID: ${args.pid}\n\n${output}`);
      }
      const { sessionId, output } = await attachByName(
        args.processName as string,
        Boolean(args.waitFor),
        target,
        deviceIdentifier,
      );
      return toolText(`LLDB attached.\nSession ID: ${sessionId}\nProcess: ${args.processName}\n\n${output}`);
    }
    case 'bazel_ios_lldb_detach': {
      if (typeof args.sessionId !== 'string') throw new Error('sessionId is required.');
      const output = await detach(args.sessionId);
      return toolText(`LLDB detached (${args.sessionId}).\n\n${output}`);
    }
    case 'bazel_ios_lldb_breakpoint': {
      if (typeof args.sessionId !== 'string') throw new Error('sessionId is required.');
      const action = args.action as string;
      if (action === 'list') {
        const output = await listBreakpoints(args.sessionId);
        return toolText(output);
      }
      if (action === 'delete') {
        if (typeof args.breakpointId !== 'number') throw new Error('breakpointId is required for delete.');
        const output = await deleteBreakpoint(args.sessionId, args.breakpointId);
        return toolText(output);
      }
      if (action === 'set') {
        if (!args.file && !args.symbol) throw new Error('Either file+line or symbol is required for set.');
        const output = await setBreakpoint(args.sessionId, {
          file: stringOrUndefined(args.file),
          line: typeof args.line === 'number' ? args.line : undefined,
          symbol: stringOrUndefined(args.symbol),
          module: stringOrUndefined(args.module),
          condition: stringOrUndefined(args.condition),
          oneShot: args.oneShot === true,
        });
        return toolText(output);
      }
      throw new Error('action must be set, delete, or list.');
    }
    case 'bazel_ios_lldb_backtrace': {
      if (typeof args.sessionId !== 'string') throw new Error('sessionId is required.');
      const output = await getBacktrace(args.sessionId, typeof args.threadIndex === 'number' ? args.threadIndex : undefined);
      return toolText(output);
    }
    case 'bazel_ios_lldb_variables': {
      if (typeof args.sessionId !== 'string') throw new Error('sessionId is required.');
      const scope = (args.scope as 'local' | 'args' | 'all') || 'all';
      const output = await getVariables(args.sessionId, scope);
      return toolText(output);
    }
    case 'bazel_ios_lldb_expression': {
      if (typeof args.sessionId !== 'string') throw new Error('sessionId is required.');
      if (typeof args.expression !== 'string') throw new Error('expression is required.');
      const output = await evaluateExpression(args.sessionId, args.expression);
      return toolText(output);
    }
    case 'bazel_ios_lldb_step': {
      if (typeof args.sessionId !== 'string') throw new Error('sessionId is required.');
      const stepAction = args.action as string;
      let output: string;
      switch (stepAction) {
        case 'over': output = await stepOver(args.sessionId); break;
        case 'into': output = await stepInto(args.sessionId); break;
        case 'out': output = await stepOut(args.sessionId); break;
        case 'continue': output = await continueExecution(args.sessionId); break;
        default: throw new Error('action must be over, into, out, or continue.');
      }
      return toolText(output);
    }
    case 'bazel_ios_lldb_threads': {
      if (typeof args.sessionId !== 'string') throw new Error('sessionId is required.');
      if (typeof args.selectThread === 'number') {
        const output = await selectThread(args.sessionId, args.selectThread);
        return toolText(output);
      }
      if (typeof args.selectFrame === 'number') {
        const output = await selectFrame(args.sessionId, args.selectFrame);
        return toolText(output);
      }
      const output = await getThreadList(args.sessionId);
      return toolText(output);
    }
    case 'bazel_ios_lldb_command': {
      if (typeof args.sessionId !== 'string') throw new Error('sessionId is required.');
      if (typeof args.command !== 'string') throw new Error('command is required.');
      const output = await runLldbCommand(args.sessionId, args.command);
      return toolText(output);
    }
    case 'bazel_ios_lldb_sessions': {
      const activeSessions = listSessions();
      if (activeSessions.length === 0) {
        return toolText('No active LLDB sessions.');
      }
      return toolText(JSON.stringify(activeSessions, null, 2));
    }
    default:
      return undefined;
  }
}
