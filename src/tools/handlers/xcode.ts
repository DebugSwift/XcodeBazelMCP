import type { JsonObject, ToolCallResult, ToolDefinition } from '../../types/index.js';
import {
  detectXcodeNativeMcp,
  exportXcodeSkills,
  mcpBridgeInvocation,
  openDeviceHub,
  xcodeMcpClientConfig,
} from '../../core/xcode-mcp.js';
import { formatCommandResult, structuredCommandResult, toolResult, toolText } from '../../utils/output.js';
import { stringOrUndefined } from '../helpers.js';

export const definitions: ToolDefinition[] = [
  {
    name: 'bazel_xcode_native_mcp_status',
    description:
      "Detect Apple's native Xcode MCP integration (Xcode 26.3+): the `mcpbridge` STDIO server, beta `lldb-mcp`, and the DeviceHub.app device manager. Returns installs, the running Xcode PIDs, and a ready-to-paste MCP client config to expose Xcode's own tools alongside XcodeBazelMCP.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'bazel_xcode_open_device_hub',
    description:
      'Open DeviceHub.app — the GUI device manager bundled with Xcode-beta / Xcode 27 — to inspect, pair, and interact with physical devices. Falls back with guidance when no DeviceHub is installed (older Xcode).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'bazel_xcode_export_skills',
    description:
      "Export Xcode's globally available agent SKILL.md bundles via `xcrun mcpbridge run-agent skills export`. Requires a running Xcode 26.3+ instance.",
    inputSchema: {
      type: 'object',
      properties: {
        outputDir: { type: 'string', description: 'Directory to write skill bundles into (default: ./xcode-skills).' },
        replaceExisting: { type: 'boolean', description: 'Overwrite existing skill directories.' },
      },
    },
  },
];

const HANDLED = new Set(definitions.map((d) => d.name));

export function canHandle(name: string): boolean {
  return HANDLED.has(name);
}

export async function handle(name: string, args: JsonObject): Promise<ToolCallResult | undefined> {
  switch (name) {
    case 'bazel_xcode_native_mcp_status': {
      const status = await detectXcodeNativeMcp();
      const lines = ['Xcode native MCP integration', ''];
      if (status.installs.length === 0) {
        lines.push('  No Xcode installs found under /Applications.');
      }
      for (const i of status.installs) {
        const tags = [
          i.hasMcpBridge ? 'mcpbridge ✅' : 'mcpbridge ❌',
          i.hasLldbMcp ? 'lldb-mcp ✅' : 'lldb-mcp ❌',
          i.deviceHubPath ? 'DeviceHub ✅' : 'DeviceHub ❌',
        ];
        const active = i.developerDir === status.activeDeveloperDir ? ' (active)' : '';
        lines.push(`  ${i.appPath}${active}${i.isBeta ? ' [beta]' : ''}`);
        lines.push(`    ${tags.join('  ')}`);
      }
      lines.push('');
      lines.push(`Running Xcode PIDs: ${status.runningXcodePids.length ? status.runningXcodePids.join(', ') : '(none — mcpbridge needs a running Xcode)'}`);
      lines.push('');
      lines.push(status.bridgeAvailable
        ? 'Bridge available. Add Xcode\'s native tools to your MCP client with:'
        : 'mcpbridge not found — Xcode 26.3 or later is required for native MCP.');
      if (status.bridgeAvailable) {
        lines.push(JSON.stringify(xcodeMcpClientConfig(), null, 2));
      }

      return toolResult(lines.join('\n'), {
        installs: status.installs,
        activeDeveloperDir: status.activeDeveloperDir,
        runningXcodePids: status.runningXcodePids,
        bridgeAvailable: status.bridgeAvailable,
        deviceHubAvailable: Boolean(status.deviceHub),
        lldbMcpAvailable: Boolean(status.lldbMcp),
        bridge: mcpBridgeInvocation(),
        clientConfig: xcodeMcpClientConfig(),
      });
    }
    case 'bazel_xcode_open_device_hub': {
      const status = await detectXcodeNativeMcp();
      const hub = status.deviceHub;
      if (!hub || !hub.deviceHubPath) {
        return toolText(
          'DeviceHub.app not found. It ships with Xcode-beta / Xcode 27. ' +
            'On Xcode 26.3 use the device tools (bazel_ios_list_devices, bazel_ios_device_info) or Xcode\u2019s Devices window.',
          true,
        );
      }
      const result = await openDeviceHub(hub.deviceHubPath);
      return toolText(
        `Opening DeviceHub.app (${hub.appPath})\n${formatCommandResult(result)}`,
        result.exitCode !== 0,
      );
    }
    case 'bazel_xcode_export_skills': {
      const result = await exportXcodeSkills({
        outputDir: stringOrUndefined(args.outputDir),
        replaceExisting: args.replaceExisting === true,
      });
      const hint = result.exitCode !== 0
        ? '\n\nHint: `mcpbridge` needs a running Xcode 26.3+ instance. Open Xcode and retry.'
        : '';
      return toolResult(
        `${formatCommandResult(result)}${hint}`,
        structuredCommandResult(result),
        result.exitCode !== 0,
      );
    }
    default:
      return undefined;
  }
}
