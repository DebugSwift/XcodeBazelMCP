import { createInterface } from 'node:readline';
import { bazelToolDefinitions, callBazelTool, callBazelToolStreaming } from '../tools/index.js';
import { getLastCommand } from '../core/bazel.js';
import { DEFAULT_WORKFLOWS, compactToolSchema, getEnabledToolNames } from '../core/workflows.js';
import { getEnabledWorkflows } from '../runtime/config.js';
import type { JsonObject } from '../types/index.js';
import { formatCommandResult } from '../utils/output.js';

const SERVER_VERSION = '0.1.0';

type RequestId = string | number | null;

interface JsonRpcMessage {
  jsonrpc?: '2.0';
  id?: RequestId;
  method?: string;
  params?: {
    name?: string;
    arguments?: JsonObject;
    uri?: string;
    protocolVersion?: string;
    _meta?: { progressToken?: string | number };
  };
}

export async function startMcpServer(): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  rl.on('line', (line) => {
    if (!line.trim()) return;
    try {
      const message = JSON.parse(line) as JsonRpcMessage;
      void handleMessage(message);
    } catch (err) {
      sendError(null, -32700, `Parse error: ${(err as Error).message}`);
    }
  });

  await new Promise<void>((resolve) => rl.once('close', resolve));
}

async function handleMessage(message: JsonRpcMessage): Promise<void> {
  const { id, method, params } = message;

  try {
    if (method === 'initialize') {
      sendResult(id, {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: {
          tools: {},
          resources: {},
        },
        serverInfo: {
          name: 'XcodeBazelMCP',
          version: SERVER_VERSION,
        },
      });
      return;
    }

    if (method === 'notifications/initialized') return;
    if (method === 'ping') return sendResult(id, {});
    if (method === 'tools/list') {
      const configWorkflows = getEnabledWorkflows();
      const effectiveWorkflows = configWorkflows || DEFAULT_WORKFLOWS;
      const enabledNames = getEnabledToolNames(effectiveWorkflows);
      const filtered = enabledNames
        ? bazelToolDefinitions.filter((t) => enabledNames.has(t.name))
        : bazelToolDefinitions;
      const tools = filtered.map((t) => compactToolSchema(t as { name: string; description: string; inputSchema: Record<string, unknown> }));
      return sendResult(id, { tools });
    }
    if (method === 'prompts/list') return sendResult(id, { prompts: [] });
    if (method === 'resources/list') {
      const { listAgentDebugLogResources } = await import('../core/agent-debug-log.js');
      const { getConfig: getRuntimeConfig } = await import('../runtime/config.js');
      const runtimeConfig = getRuntimeConfig();
      const agentDebugResources = listAgentDebugLogResources([
        runtimeConfig.workspacePath,
        process.cwd(),
      ]);
      return sendResult(id, {
        resources: [
          {
            uri: 'xcodebazel://last-command',
            name: 'Last XcodeBazelMCP command',
            description: 'The most recent command run by this MCP server.',
            mimeType: 'text/plain',
          },
          {
            uri: 'xcodebazel://session-status',
            name: 'Session status',
            description: 'Current session state: active workflows, defaults, uptime.',
            mimeType: 'application/json',
          },
          ...agentDebugResources,
        ],
      });
    }
    if (method === 'resources/templates/list') {
      return sendResult(id, {
        resourceTemplates: [
          {
            uriTemplate: 'xcodebazel://agent-debug-log?path={path}',
            name: 'Agent debug NDJSON log',
            description: 'Structured agent debug log at an absolute host path. Use bazel_ios_agent_debug_log_read or pass ?path=<absolute-log-path>.',
            mimeType: 'application/json',
          },
        ],
      });
    }
    if (method === 'resources/read') {
      if (params?.uri === 'xcodebazel://last-command') {
        const last = getLastCommand();
        return sendResult(id, {
          contents: [
            {
              uri: params.uri,
              mimeType: 'text/plain',
              text: last ? formatCommandResult(last) : 'No command has run yet.',
            },
          ],
        });
      }
      if (params?.uri === 'xcodebazel://session-status') {
        const { getConfig: gc, getActiveProfile: gap, getEnabledWorkflows: gew } = await import('../runtime/config.js');
        const cfg = gc();
        const configWorkflows = gew();
        const effective = configWorkflows || DEFAULT_WORKFLOWS;
        const enabledNames = getEnabledToolNames(effective);
        const status = {
          workspace: cfg.workspacePath,
          configFile: cfg.configFilePath || null,
          activeProfile: gap() || null,
          defaults: cfg.defaults,
          workflows: {
            active: effective.includes('all') ? 'all' : effective,
            toolCount: enabledNames ? enabledNames.size : bazelToolDefinitions.length,
          },
          process: {
            pid: process.pid,
            uptimeMs: Math.round(process.uptime() * 1000),
            rssBytes: process.memoryUsage().rss,
            heapUsedBytes: process.memoryUsage().heapUsed,
          },
        };
        return sendResult(id, {
          contents: [
            {
              uri: params.uri,
              mimeType: 'application/json',
              text: JSON.stringify(status, null, 2),
            },
          ],
        });
      }
      if (params?.uri?.startsWith('xcodebazel://agent-debug-log')) {
        const { parseAgentDebugLogUri, readAgentDebugLog, readAgentDebugLogResourceHelp } = await import('../core/agent-debug-log.js');
        const { getConfig: getRuntimeConfig } = await import('../runtime/config.js');
        const runtimeConfig = getRuntimeConfig();
        const logPath = parseAgentDebugLogUri(params.uri);
        if (!logPath) {
          const help = readAgentDebugLogResourceHelp([runtimeConfig.workspacePath, process.cwd()]);
          return sendResult(id, {
            contents: [
              {
                uri: params.uri,
                mimeType: 'application/json',
                text: JSON.stringify(help, null, 2),
              },
            ],
          });
        }
        const result = readAgentDebugLog({ logPath });
        return sendResult(id, {
          contents: [
            {
              uri: params.uri,
              mimeType: 'application/json',
              text: JSON.stringify(result, null, 2),
            },
          ],
        });
      }
      throw new Error(`Unknown resource: ${params?.uri}`);
    }
    if (method === 'tools/call') {
      if (!params?.name) throw new Error('tools/call requires params.name');
      const progressToken = params._meta?.progressToken;
      const toolArgs = params.arguments || {};
      if (progressToken !== undefined && toolArgs.streaming === true) {
        let callProgressCounter = 0;
        const value = await callBazelToolStreaming(
          params.name,
          toolArgs,
          (chunk: string) => {
            callProgressCounter += 1;
            sendProgress(progressToken, callProgressCounter, chunk);
          },
        );
        return sendResult(id, value);
      }
      const value = await callBazelTool(params.name, toolArgs);
      return sendResult(id, value);
    }

    if (id !== undefined) sendError(id, -32601, `Method not found: ${method}`);
  } catch (err) {
    if (id !== undefined) sendError(id, -32000, (err as Error).message, (err as Error).stack);
  }
}

function sendResult(id: RequestId | undefined, value: unknown): void {
  if (id === undefined) return;
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result: value })}\n`);
}

function sendProgress(progressToken: string | number, progress: number, data: string): void {
  process.stdout.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/progress',
      params: { progressToken, progress, message: data },
    })}\n`,
  );
}

function sendError(id: RequestId | undefined, code: number, message: string, data?: unknown): void {
  if (id === undefined) return;
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message, data } })}\n`);
}
