import type { JsonObject, ToolCallResult, ToolDefinition } from '../../types/index.js';
import { getAvailableTemplates, scaffold, type ScaffoldTemplate } from '../../core/scaffold.js';
import { daemonShutdown, daemonStatus, ensureDaemon } from '../../daemon/client.js';
import { isDaemonRunning } from '../../daemon/index.js';
import { checkForUpdate, performUpgrade, upgradeHint } from '../../core/upgrade.js';
import type { InstallMethod } from '../../core/upgrade.js';
import { formatCommandResult, structuredCommandResult, toolResult, toolText } from '../../utils/output.js';
import { getConfig } from '../../runtime/config.js';
import { stringOrUndefined } from '../helpers.js';

export const definitions: ToolDefinition[] = [
  {
    name: 'bazel_scaffold',
    description: 'Generate a new Bazel iOS or macOS project from a template. Creates MODULE.bazel, BUILD files, Swift sources, and config.',
    inputSchema: {
      type: 'object',
      properties: {
        outputPath: { type: 'string', description: 'Directory where the project will be created.' },
        name: { type: 'string', description: 'Project/target name (e.g. MyApp).' },
        template: {
          type: 'string',
          enum: ['ios_app', 'ios_test', 'ios_app_with_tests', 'macos_app', 'macos_test', 'macos_app_with_tests'],
          description: 'Project template to generate.',
        },
        bundleId: { type: 'string', description: 'Bundle identifier (default: com.example.<name>).' },
        minimumOs: { type: 'string', description: 'Minimum OS version (default: 17.0 for iOS, 14.0 for macOS).' },
        rulesVersion: { type: 'string', description: 'rules_apple version (default: 3.16.1).' },
        bazelVersion: { type: 'string', description: 'Pin written to .bazelversion (default: 7.6.1).' },
        families: { type: 'array', items: { type: 'string', enum: ['iphone', 'ipad'] }, description: 'iOS device families (default: iphone, ipad).' },
      },
      required: ['outputPath', 'name', 'template'],
    },
  },
  {
    name: 'bazel_scaffold_list_templates',
    description: 'List available project scaffold templates.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'bazel_daemon_start',
    description: 'Start or ensure the per-workspace background daemon is running. The daemon exposes a coordination socket and tracks background-operation metadata for the workspace. Note: capture/recording/LLDB child processes currently run inside the MCP server process, not the daemon.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'bazel_daemon_stop',
    description: 'Stop the per-workspace background daemon and clear its tracked operation metadata.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'bazel_daemon_status',
    description: 'Check whether the per-workspace daemon is running and list active background operations.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'bazel_check_update',
    description: 'Check if a newer version of XcodeBazelMCP is available.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'bazel_upgrade',
    description: 'Upgrade XcodeBazelMCP to the latest version. Auto-detects install method (npm, Homebrew, source).',
    inputSchema: {
      type: 'object',
      properties: {
        method: {
          type: 'string',
          enum: ['npm-global', 'npm-local', 'homebrew', 'source'],
          description: 'Force a specific upgrade method instead of auto-detecting.',
        },
      },
    },
  },
];

const HANDLED = new Set(definitions.map(d => d.name));

export function canHandle(name: string): boolean {
  return HANDLED.has(name);
}

export async function handle(name: string, args: JsonObject): Promise<ToolCallResult | undefined> {
  switch (name) {
    case 'bazel_scaffold': {
      if (typeof args.outputPath !== 'string') throw new Error('outputPath is required.');
      if (typeof args.name !== 'string') throw new Error('name is required.');
      if (typeof args.template !== 'string') throw new Error('template is required.');
      const result = scaffold({
        outputPath: args.outputPath,
        name: args.name,
        template: args.template as ScaffoldTemplate,
        bundleId: stringOrUndefined(args.bundleId),
        minimumOs: stringOrUndefined(args.minimumOs),
        rulesVersion: stringOrUndefined(args.rulesVersion),
        bazelVersion: stringOrUndefined(args.bazelVersion),
        families: Array.isArray(args.families) ? (args.families as string[]) : undefined,
      });
      const lines = [
        `Project "${args.name}" scaffolded from template "${args.template}".`,
        `Output: ${result.outputPath}`,
        '',
        `Files created (${result.filesCreated.length}):`,
        ...result.filesCreated.map((f) => `  ${f}`),
        '',
        'Next steps:',
        '  1. cd ' + result.outputPath,
        '  2. bazel build //...',
      ];
      return toolText(lines.join('\n'));
    }
    case 'bazel_scaffold_list_templates': {
      const templates = getAvailableTemplates();
      const lines = templates.map((t) => `  ${t.id}: ${t.description}`);
      return toolText(`Available templates:\n${lines.join('\n')}`);
    }
    case 'bazel_daemon_start': {
      const config = getConfig();
      const info = await ensureDaemon(config.workspacePath);
      return toolText(
        `Daemon running.\nPID: ${info.pid}\nWorkspace: ${info.workspacePath}\nSocket: ${info.socketPath}\nStarted: ${info.startedAt}\nActive ops: ${info.activeOps.length}`,
      );
    }
    case 'bazel_daemon_stop': {
      const config = getConfig();
      if (!isDaemonRunning(config.workspacePath)) {
        return toolText('No daemon is running for this workspace.');
      }
      await daemonShutdown(config.workspacePath);
      return toolText('Daemon stopped.');
    }
    case 'bazel_daemon_status': {
      const config = getConfig();
      if (!isDaemonRunning(config.workspacePath)) {
        return toolText('Daemon is not running for this workspace.');
      }
      const info = await daemonStatus(config.workspacePath);
      if (!info) {
        return toolText('Daemon PID file exists but daemon is not responding.');
      }
      const lines = [
        `Daemon running.`,
        `PID: ${info.pid}`,
        `Workspace: ${info.workspacePath}`,
        `Socket: ${info.socketPath}`,
        `Started: ${info.startedAt}`,
        `Uptime: ${info.uptime}s`,
        '',
        `Active ops (${info.activeOps.length}):`,
      ];
      for (const op of info.activeOps) {
        lines.push(`  ${op.id} (${op.type}) — started ${op.startedAt}`);
      }
      if (info.activeOps.length === 0) {
        lines.push('  (none)');
      }
      return toolText(lines.join('\n'));
    }
    case 'bazel_check_update': {
      const info = await checkForUpdate();
      const lines = [
        `Current version: ${info.current}`,
        `Latest version: ${info.latest || '(unable to fetch)'}`,
        `Install method: ${info.installMethod}`,
        info.updateAvailable
          ? `\nUpdate available! Run: ${upgradeHint(info.installMethod)}`
          : '\nYou are up to date.',
      ];
      return toolText(lines.join('\n'));
    }
    case 'bazel_upgrade': {
      const info = await checkForUpdate();
      if (!info.updateAvailable && !args.method) {
        return toolText(`Already on latest version (${info.current}). No upgrade needed.`);
      }
      const method = (args.method as InstallMethod) || undefined;
      const result = await performUpgrade(method);
      return toolResult(
        formatCommandResult(result),
        structuredCommandResult(result),
        result.exitCode !== 0,
      );
    }
    default:
      return undefined;
  }
}
