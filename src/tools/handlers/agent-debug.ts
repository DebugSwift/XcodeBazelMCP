import type { JsonObject, ToolCallResult, ToolDefinition } from '../../types/index.js';
import {
  agentDebugLaunchEnv,
  clearAgentDebugLog,
  readAgentDebugLog,
  pullAgentDebugLogFromSimulator,
  AGENT_DEBUG_SIM_REL_PATH,
} from '../../core/agent-debug-log.js';
import { resolveSimulatorFromArgs, stringOrUndefined, prependWarning } from '../helpers.js';
import { toolText } from '../../utils/output.js';

export const definitions: ToolDefinition[] = [
  {
    name: 'bazel_ios_agent_debug_log_clear',
    description:
      'Delete an agent debug NDJSON log file before a repro run (Cursor debug mode). Safe no-op if missing.',
    inputSchema: {
      type: 'object',
      properties: {
        logPath: {
          type: 'string',
          description: 'Absolute path to .cursor/debug-{session}.log on the host.',
        },
      },
      required: ['logPath'],
    },
  },
  {
    name: 'bazel_ios_agent_debug_log_read',
    description:
      'Read and parse an agent debug NDJSON log. Returns structured entries grouped by hypothesisId/runId with status hints.',
    inputSchema: {
      type: 'object',
      properties: {
        logPath: { type: 'string', description: 'Absolute path to the NDJSON log file.' },
        hypothesisId: { type: 'string', description: 'Filter entries to this hypothesisId.' },
        runId: { type: 'string', description: 'Filter entries to this runId.' },
        limit: { type: 'number', description: 'Return only the last N matching entries.' },
      },
      required: ['logPath'],
    },
  },
  {
    name: 'bazel_ios_agent_debug_log_pull',
    description:
      'Pull agent-debug.ndjson from a simulator app data container (Documents/agent-debug.ndjson) via simctl get_app_container.',
    inputSchema: {
      type: 'object',
      properties: {
        bundleId: { type: 'string', description: 'App bundle identifier.' },
        simulatorId: { type: 'string', description: 'Simulator UDID (default: first booted).' },
        simulatorName: { type: 'string', description: 'Simulator name (alternative to simulatorId).' },
        destPath: {
          type: 'string',
          description:
            'Optional host path to copy the file (e.g. .cursor/debug-{session}.log). Parses NDJSON from dest after copy.',
        },
        simRelPath: {
          type: 'string',
          description: `Relative path inside app data container (default: ${AGENT_DEBUG_SIM_REL_PATH}).`,
        },
      },
      required: ['bundleId'],
    },
  },
  {
    name: 'bazel_ios_agent_debug_repro',
    description:
      'One-shot Cursor debug repro: clear host log → build_and_run with AGENT_DEBUG_* launchEnv → optional log capture.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Bazel iOS app target label.' },
        logPath: { type: 'string', description: 'Host NDJSON log path (.cursor/debug-{session}.log).' },
        sessionId: { type: 'string', description: 'Debug session id (passed as AGENT_DEBUG_SESSION_ID).' },
        hypothesisIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional hypothesis ids for agent context (echoed in response only).',
        },
        launchEnv: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Extra env vars merged with AGENT_DEBUG_LOG_PATH and AGENT_DEBUG_SESSION_ID.',
        },
        startLogCapture: {
          type: 'boolean',
          description: 'Start bazel_ios_log_capture_start after launch (returns captureId).',
        },
        simulatorId: { type: 'string' },
        simulatorName: { type: 'string' },
        buildMode: { type: 'string', enum: ['none', 'debug', 'release', 'release_with_symbols'] },
        configs: { type: 'array', items: { type: 'string' } },
        launchArgs: { type: 'array', items: { type: 'string' } },
      },
      required: ['target', 'logPath', 'sessionId'],
    },
  },
];

const HANDLED = new Set(definitions.map((d) => d.name));

export function canHandle(name: string): boolean {
  return HANDLED.has(name);
}

export async function handle(name: string, args: JsonObject): Promise<ToolCallResult | undefined> {
  switch (name) {
    case 'bazel_ios_agent_debug_log_clear': {
      if (typeof args.logPath !== 'string') throw new Error('logPath is required.');
      const result = clearAgentDebugLog(args.logPath);
      return toolText(JSON.stringify(result, null, 2));
    }
    case 'bazel_ios_agent_debug_log_read': {
      if (typeof args.logPath !== 'string') throw new Error('logPath is required.');
      const result = readAgentDebugLog({
        logPath: args.logPath,
        hypothesisId: stringOrUndefined(args.hypothesisId),
        runId: stringOrUndefined(args.runId),
        limit: typeof args.limit === 'number' ? args.limit : undefined,
      });
      return toolText(JSON.stringify(result, null, 2));
    }
    case 'bazel_ios_agent_debug_log_pull': {
      if (typeof args.bundleId !== 'string') throw new Error('bundleId is required.');
      const { sim, warning } = await resolveSimulatorFromArgs(args);
      const pulled = await pullAgentDebugLogFromSimulator({
        bundleId: args.bundleId,
        simulatorId: sim.udid,
        destPath: stringOrUndefined(args.destPath),
        simRelPath: stringOrUndefined(args.simRelPath),
      });
      return toolText(
        prependWarning(JSON.stringify(pulled, null, 2), warning),
        !pulled.read.exists && pulled.read.lineCount === 0,
      );
    }
    case 'bazel_ios_agent_debug_repro': {
      if (typeof args.target !== 'string') throw new Error('target is required.');
      if (typeof args.logPath !== 'string') throw new Error('logPath is required.');
      if (typeof args.sessionId !== 'string') throw new Error('sessionId is required.');

      const cleared = clearAgentDebugLog(args.logPath);
      const debugEnv = agentDebugLaunchEnv(args.logPath, args.sessionId);
      const userEnv = (args.launchEnv as Record<string, string> | undefined) || {};
      const launchEnv = { ...userEnv, ...debugEnv };

      const { callBazelTool } = await import('../bazel-tools.js');
      const buildRunArgs: JsonObject = {
        target: args.target,
        launchEnv,
      };
      if (args.simulatorId !== undefined) buildRunArgs.simulatorId = args.simulatorId;
      if (args.simulatorName !== undefined) buildRunArgs.simulatorName = args.simulatorName;
      if (args.buildMode !== undefined) buildRunArgs.buildMode = args.buildMode;
      if (args.configs !== undefined) buildRunArgs.configs = args.configs;
      if (args.launchArgs !== undefined) buildRunArgs.launchArgs = args.launchArgs;

      const buildResult = await callBazelTool('bazel_ios_build_and_run', buildRunArgs);
      const buildText = buildResult.content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map((c) => c.text)
        .join('\n');

      let captureId: string | undefined;
      if (args.startLogCapture === true) {
        const cap = await callBazelTool('bazel_ios_log_capture_start', {
          simulatorId: args.simulatorId,
          simulatorName: args.simulatorName,
          messageContains: 'agentDebugLog',
        });
        const match = cap.content
          .map((c) => (c.type === 'text' ? c.text : ''))
          .join('\n')
          .match(/Capture ID:\s*(\S+)/);
        captureId = match?.[1];
      }

      const summary = {
        logPath: args.logPath,
        sessionId: args.sessionId,
        hypothesisIds: Array.isArray(args.hypothesisIds) ? args.hypothesisIds : undefined,
        cleared,
        launchEnv,
        simContainerFallback: AGENT_DEBUG_SIM_REL_PATH,
        captureId,
        buildAndRun: {
          isError: buildResult.isError ?? false,
          output: buildText,
        },
        nextSteps: [
          'Reproduce the bug in the simulator.',
          'bazel_ios_agent_debug_log_read with logPath (host path from launchEnv)',
          'Or bazel_ios_agent_debug_log_pull if Swift wrote to Documents/agent-debug.ndjson',
        ],
      };

      return toolText(JSON.stringify(summary, null, 2), buildResult.isError === true);
    }
    default:
      return undefined;
  }
}
