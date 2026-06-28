import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const CLI = resolve(import.meta.dirname, '..', 'cli.ts');

function sendMcpRequest(
  messages: Array<Record<string, unknown>>,
  timeoutMs = 10_000,
): Promise<string[]> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('npx', ['tsx', CLI, 'mcp'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });

    let stdout = '';
    const timer = setTimeout(() => {
      child.kill();
      resolvePromise(stdout.split('\n').filter(Boolean));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.on('close', () => {
      clearTimeout(timer);
      resolvePromise(stdout.split('\n').filter(Boolean));
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    for (const msg of messages) {
      child.stdin.write(JSON.stringify(msg) + '\n');
    }

    setTimeout(() => child.stdin.end(), 500);
  });
}

describe('MCP server protocol', () => {
  it('responds to initialize with server info and capabilities', async () => {
    const lines = await sendMcpRequest([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
    ]);

    expect(lines.length).toBeGreaterThanOrEqual(1);
    const resp = JSON.parse(lines[0]);
    expect(resp.jsonrpc).toBe('2.0');
    expect(resp.id).toBe(1);
    expect(resp.result.serverInfo.name).toBe('XcodeBazelMCP');
    expect(resp.result.capabilities.tools).toBeDefined();
    expect(resp.result.capabilities.resources).toBeDefined();
    expect(resp.result.protocolVersion).toBe('2024-11-05');
  });

  it('responds to ping', async () => {
    const lines = await sendMcpRequest([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      { jsonrpc: '2.0', id: 2, method: 'ping' },
    ]);

    const pingResp = lines.map((l) => JSON.parse(l)).find((r) => r.id === 2);
    expect(pingResp).toBeDefined();
    expect(pingResp.result).toEqual({});
  });

  it('lists default workflow tools via tools/list (smart defaults)', async () => {
    const lines = await sendMcpRequest([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]);

    const toolsResp = lines.map((l) => JSON.parse(l)).find((r) => r.id === 2);
    expect(toolsResp).toBeDefined();
    expect(toolsResp.result.tools).toHaveLength(57);
    const names = toolsResp.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('bazel_ios_build');
    expect(names).toContain('bazel_ios_test');
    expect(names).toContain('bazel_ios_device_build_and_run');
    expect(names).toContain('bazel_ios_list_devices');
    expect(names).toContain('bazel_list_workflows');
    expect(names).toContain('bazel_toggle_workflow');
    expect(names).not.toContain('bazel_tvos_build');
    expect(names).not.toContain('bazel_ios_tap');
  });

  it('compact schemas strip property descriptions', async () => {
    const lines = await sendMcpRequest([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]);

    const toolsResp = lines.map((l) => JSON.parse(l)).find((r) => r.id === 2);
    const buildTool = toolsResp.result.tools.find((t: { name: string }) => t.name === 'bazel_ios_build');
    expect(buildTool).toBeDefined();
    expect(buildTool.description).toBeTruthy();
    const targetProp = (buildTool.inputSchema.properties as Record<string, Record<string, unknown>>).target;
    expect(targetProp.type).toBe('string');
    expect(targetProp.description).toBeUndefined();
  });

  it('lists resources including last-command', async () => {
    const lines = await sendMcpRequest([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      { jsonrpc: '2.0', id: 2, method: 'resources/list' },
    ]);

    const resp = lines.map((l) => JSON.parse(l)).find((r) => r.id === 2);
    expect(resp.result.resources.length).toBeGreaterThanOrEqual(3);
    const uris = resp.result.resources.map((r: { uri: string }) => r.uri);
    expect(uris).toContain('xcodebazel://last-command');
    expect(uris).toContain('xcodebazel://session-status');
    expect(uris.some((uri: string) => uri.startsWith('xcodebazel://agent-debug-log'))).toBe(true);
  });

  it('reads bare agent-debug-log resource without error', async () => {
    const lines = await sendMcpRequest([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      { jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'xcodebazel://agent-debug-log' } },
    ]);

    const resp = lines.map((l) => JSON.parse(l)).find((r) => r.id === 2);
    expect(resp.error).toBeUndefined();
    const parsed = JSON.parse(resp.result.contents[0].text);
    expect(parsed.kind).toBe('agent-debug-log-help');
  });

  it('lists agent-debug-log as a resource template (requires path param)', async () => {
    const lines = await sendMcpRequest([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      { jsonrpc: '2.0', id: 2, method: 'resources/templates/list' },
    ]);

    const resp = lines.map((l) => JSON.parse(l)).find((r) => r.id === 2);
    expect(resp.result.resourceTemplates).toHaveLength(1);
    expect(resp.result.resourceTemplates[0].uriTemplate).toBe(
      'xcodebazel://agent-debug-log?path={path}',
    );
  });

  it('reads agent-debug-log resource when path query is provided', async () => {
    const lines = await sendMcpRequest([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'resources/read',
        params: { uri: 'xcodebazel://agent-debug-log?path=%2Ftmp%2Fmissing-agent-debug.log' },
      },
    ]);

    const resp = lines.map((l) => JSON.parse(l)).find((r) => r.id === 2);
    expect(resp.error).toBeUndefined();
    const parsed = JSON.parse(resp.result.contents[0].text);
    expect(parsed.exists).toBe(false);
    expect(parsed.logPath).toBe('/tmp/missing-agent-debug.log');
  });

  it('reads last-command resource (no command yet)', async () => {
    const lines = await sendMcpRequest([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      { jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'xcodebazel://last-command' } },
    ]);

    const resp = lines.map((l) => JSON.parse(l)).find((r) => r.id === 2);
    expect(resp.result.contents[0].text).toBe('No command has run yet.');
  });

  it('returns error for unknown method', async () => {
    const lines = await sendMcpRequest([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      { jsonrpc: '2.0', id: 99, method: 'nonexistent/method' },
    ]);

    const resp = lines.map((l) => JSON.parse(l)).find((r) => r.id === 99);
    expect(resp.error).toBeDefined();
    expect(resp.error.code).toBe(-32601);
  });

  it('calls show_defaults tool successfully', async () => {
    const lines = await sendMcpRequest([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'bazel_ios_show_defaults', arguments: {} } },
    ]);

    const resp = lines.map((l) => JSON.parse(l)).find((r) => r.id === 2);
    expect(resp.result).toBeDefined();
    expect(resp.result.content).toBeDefined();
    expect(resp.result.content[0].type).toBe('text');
  });

  it('returns prompts/list as empty', async () => {
    const lines = await sendMcpRequest([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
      { jsonrpc: '2.0', id: 2, method: 'prompts/list' },
    ]);

    const resp = lines.map((l) => JSON.parse(l)).find((r) => r.id === 2);
    expect(resp.result.prompts).toEqual([]);
  });
});
