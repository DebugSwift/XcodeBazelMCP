import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_WORKFLOWS, WORKFLOWS, getEnabledToolNames, validateWorkflowIds } from '../../core/workflows.js';
import { asStringArray, getLastCommand, runBazel } from '../../core/bazel.js';
import { assertBazelWorkspace, readBspStatus } from '../../core/workspace.js';
import {
  activateProfile,
  clearDefaults,
  getActiveProfile,
  getConfig,
  getDefaults,
  getEnabledWorkflows,
  getProfiles,
  setDefaults,
  setEnabledWorkflows,
  setWorkspace,
} from '../../runtime/config.js';
import type { BuildMode, BuildPlatform, JsonObject, ToolCallResult, ToolDefinition } from '../../types/index.js';
import { formatCommandResult, toolText } from '../../utils/output.js';
import { runCommand } from '../../utils/process.js';
import { stringOrUndefined, booleanOrUndefined } from '../helpers.js';
import { bazelToolDefinitions } from '../bazel-tools.js';

export const definitions: ToolDefinition[] = [
  {
    name: 'bazel_ios_set_workspace',
    description: 'Set the Bazel iOS workspace and optional Bazel binary path used by later tools.',
    inputSchema: {
      type: 'object',
      properties: {
        workspacePath: { type: 'string', description: 'Absolute path to the Bazel workspace.' },
        bazelPath: { type: 'string', description: 'Optional Bazel binary path.' },
      },
      required: ['workspacePath'],
    },
  },
  {
    name: 'bazel_ios_health',
    description: 'Check local Bazel, Xcode, simulator, and workspace readiness for iOS Bazel builds.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'bazel_ios_set_defaults',
    description: 'Set session defaults so agents don\'t repeat target, simulator, or build mode on every call. Use profile to load a named preset from config.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Default Bazel target label.' },
        simulatorName: { type: 'string', description: 'Default simulator device name.' },
        simulatorId: { type: 'string', description: 'Default simulator UDID.' },
        deviceName: { type: 'string', description: 'Default physical device name.' },
        deviceId: { type: 'string', description: 'Default physical device UDID.' },
        buildMode: { type: 'string', enum: ['none', 'debug', 'release', 'release_with_symbols'] },
        platform: { type: 'string', enum: ['none', 'simulator', 'device'] },
        streaming: {
          type: 'boolean',
          description: 'Default streaming for build/test tools. Defaults to false. Set true for live progress.',
        },
        profile: { type: 'string', description: 'Activate a named profile from config file.' },
        clear: { type: 'boolean', description: 'Clear all session defaults.' },
      },
    },
  },
  {
    name: 'bazel_ios_show_defaults',
    description: 'Show current session defaults, active profile, and config file settings.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'bazel_ios_list_profiles',
    description: 'List available named profiles from the config file.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'bazel_ios_last_command',
    description: 'Return the most recent command run by this MCP server, including output and exit code.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'bazel_ios_bsp_status',
    description: 'Inspect sourcekit-bazel-bsp setup files and likely setup targets in the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        querySetupTargets: { type: 'boolean' },
        startupArgs: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'bazel_list_workflows',
    description: 'List all available workflow categories, their tools, and whether they are currently enabled. Use this to discover server capabilities and toggle workflows on/off.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'bazel_toggle_workflow',
    description: 'Enable or disable a workflow category at runtime. When workflows are filtered, only tools from enabled workflows appear in tools/list. Pass "all" as id to reset to all workflows.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Workflow ID (e.g. "build", "test", "device", "macos") or "all" to reset.' },
        enabled: { type: 'boolean', description: 'true to enable, false to disable.' },
      },
      required: ['id', 'enabled'],
    },
  },
];

const VALID_BUILD_MODES: BuildMode[] = ['none', 'debug', 'release', 'release_with_symbols'];
const VALID_DEFAULT_PLATFORMS: BuildPlatform[] = ['none', 'simulator', 'device'];

const HANDLED = new Set(definitions.map(d => d.name));

export function canHandle(name: string): boolean {
  return HANDLED.has(name);
}

export async function handle(name: string, args: JsonObject): Promise<ToolCallResult | undefined> {
  switch (name) {
    case 'bazel_ios_set_workspace': {
      if (typeof args.workspacePath !== 'string') {
        throw new Error('workspacePath is required.');
      }
      const nextConfig = setWorkspace(args.workspacePath, stringOrUndefined(args.bazelPath));
      assertBazelWorkspace(nextConfig.workspacePath);
      return toolText(`Workspace set to ${nextConfig.workspacePath}\nBazel path: ${nextConfig.bazelPath}`);
    }
    case 'bazel_ios_health': {
      const os = await import('node:os');
      const { resolve: resolvePath } = await import('node:path');
      const { countSigningIdentities, listDevices, findPymobiledevice3 } = await import('../../core/devices.js');
      const config = getConfig();
      assertBazelWorkspace(config.workspacePath);

      const hasModuleBazel = existsSync(join(config.workspacePath, 'MODULE.bazel'));
      const hasWorkspace = existsSync(join(config.workspacePath, 'WORKSPACE'))
        || existsSync(join(config.workspacePath, 'WORKSPACE.bazel'));
      const usingCwdFallback = !process.env.BAZEL_IOS_WORKSPACE
        && resolvePath(config.workspacePath) === resolvePath(process.cwd());

      const lines = [
        '⚙️ XcodeBazelMCP Doctor',
        '',
        'System Information',
        `  platform: ${os.platform()}`,
        `  arch: ${os.arch()}`,
        `  cpus: ${os.cpus().length} x ${os.cpus()[0]?.model || 'unknown'}`,
        `  memory: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB`,
        `  node: ${process.version}`,
        '',
        'Workspace',
        `  path: ${config.workspacePath}`,
        `  bazel: ${config.bazelPath}`,
        `  config: ${config.configFilePath || '(none)'}`,
        `  maxOutput: ${config.maxOutput}`,
        `  startupArgs: ${process.env.BAZEL_IOS_STARTUP_ARGS || '(none)'}`,
        `  BAZEL_IOS_WORKSPACE: ${process.env.BAZEL_IOS_WORKSPACE || '(not set)'}`,
        `  MODULE.bazel: ${hasModuleBazel ? '✅ found' : '❌ missing'}`,
        `  WORKSPACE: ${hasWorkspace ? '✅ found' : '⚠️ missing (using MODULE.bazel)'}`,
        `  .bazelrc: ${existsSync(join(config.workspacePath, '.bazelrc')) ? '✅ found' : '⚠️ missing'}`,
      ];

      if (usingCwdFallback && !hasModuleBazel && !hasWorkspace) {
        lines.push(
          '  ⚠️ Workspace looks like process.cwd() and is not a Bazel root.',
          '     Set BAZEL_IOS_WORKSPACE in MCP config or workspacePath in .xcodebazelmcp/config.yaml.',
        );
      } else if (!process.env.BAZEL_IOS_WORKSPACE && !config.configFilePath) {
        lines.push('  ⚠️ BAZEL_IOS_WORKSPACE not set — using cwd or config file workspacePath.');
      }

      const [bazelVersion, xcode, simctl, deviceList, signing, idbWhich, pymPath] = await Promise.all([
        runCommand(config.bazelPath, ['--version'], { cwd: config.workspacePath, timeoutSeconds: 20, maxOutput: config.maxOutput }),
        runCommand('xcodebuild', ['-version'], { cwd: config.workspacePath, timeoutSeconds: 20, maxOutput: config.maxOutput }),
        runCommand('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], { cwd: config.workspacePath, timeoutSeconds: 30, maxOutput: config.maxOutput }),
        listDevices(),
        countSigningIdentities(),
        runCommand('which', ['idb'], { cwd: config.workspacePath, timeoutSeconds: 5, maxOutput: 1_000 }),
        findPymobiledevice3(),
      ]);

      const connectedDevices = deviceList.devices.filter((d) => d.state === 'connected');

      lines.push(
        '',
        'Dependencies',
        `  bazel: ${bazelVersion.exitCode === 0 ? bazelVersion.output.trim() : `❌ exit ${bazelVersion.exitCode}`}`,
        `  xcode: ${xcode.exitCode === 0 ? xcode.output.trim().replace(/\n/g, ' / ') : `❌ exit ${xcode.exitCode}`}`,
        `  simctl: ${simctl.exitCode === 0 ? '✅ available' : '❌ unavailable'}`,
        `  devicectl: ${deviceList.command.exitCode === 0 ? '✅ available' : `❌ exit ${deviceList.command.exitCode}`}`,
        `  codesigning identities: ${signing.command.exitCode === 0 ? `${signing.count} valid` : `❌ exit ${signing.command.exitCode}`}`,
        `  idb (UI automation): ${idbWhich.exitCode === 0 ? `✅ ${idbWhich.output.trim()}` : '⚠️ not found — UI automation falls back to CGEvent (less reliable). Install: brew install idb-companion'}`,
        `  pymobiledevice3 (device screenshots/logs): ${pymPath ? `✅ ${pymPath}` : '⚠️ not found — device screenshots/logs on iOS 17+ need it. Install: pip3 install pymobiledevice3'}`,
      );

      lines.push('', 'Physical Devices');
      if (deviceList.command.exitCode !== 0) {
        lines.push('  ❌ Could not list devices via devicectl.');
      } else if (connectedDevices.length === 0) {
        lines.push('  ⚠️ No connected devices. Connect via USB/Wi-Fi and trust this Mac for device deploy.');
      } else {
        for (const d of connectedDevices) {
          lines.push(`  ✅ ${d.name} — iOS ${d.osVersion}`);
          lines.push(`     hardware UDID: ${d.udid}`);
          if (d.coreDeviceIdentifier && d.coreDeviceIdentifier !== d.udid) {
            lines.push(`     CoreDevice ID: ${d.coreDeviceIdentifier}`);
          }
        }
      }
      if (signing.count === 0 && signing.command.exitCode === 0) {
        lines.push('', '  ⚠️ No code signing identities found. Device builds will fail until certificates are installed.');
      }

      const configWorkflows = getEnabledWorkflows();
      const effective = configWorkflows || DEFAULT_WORKFLOWS;
      const enabledNames = getEnabledToolNames(effective);
      const toolCount = enabledNames ? enabledNames.size : bazelToolDefinitions.length;
      const deviceWorkflowEnabled = effective.includes('all') || effective.includes('device');

      lines.push(
        '',
        'Tool Inventory',
        `  Total tools: ${bazelToolDefinitions.length}`,
        `  Advertised (via workflows): ${toolCount}`,
        `  Active workflows: ${effective.includes('all') ? 'all' : effective.join(', ')}`,
      );

      for (const wf of WORKFLOWS) {
        const isEnabled = effective.includes('all') || effective.includes(wf.id);
        lines.push(`    ${isEnabled ? '✅' : '⛔'} ${wf.id}: ${wf.tools.length} tools`);
      }

      if (!deviceWorkflowEnabled) {
        lines.push(
          '',
          '  ⚠️ Device workflow is disabled — physical device tools are hidden from agents.',
          '     Enable with: xcodebazelmcp toggle-workflow device on',
          '     Or add device to enabledWorkflows in .xcodebazelmcp/config.yaml',
        );
      }

      const hasError = bazelVersion.exitCode !== 0 || xcode.exitCode !== 0 || simctl.exitCode !== 0;
      lines.push('', hasError ? '⚠️ Some checks failed — see above.' : '✅ All checks passed.');
      return toolText(lines.join('\n'), hasError);
    }
    case 'bazel_ios_set_defaults': {
      if (args.clear === true) {
        clearDefaults();
        return toolText('Session defaults cleared.');
      }
      if (typeof args.profile === 'string') {
        const updated = activateProfile(args.profile);
        const lines = Object.entries(updated)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `  ${k}: ${v}`);
        return toolText(`Profile "${args.profile}" activated.\n\nSession defaults:\n${lines.join('\n')}`);
      }
      const buildMode = stringOrUndefined(args.buildMode);
      if (buildMode !== undefined && !VALID_BUILD_MODES.includes(buildMode as BuildMode)) {
        throw new Error(`Invalid buildMode "${buildMode}". Expected one of: ${VALID_BUILD_MODES.join(', ')}.`);
      }
      const platform = stringOrUndefined(args.platform);
      if (platform !== undefined && !VALID_DEFAULT_PLATFORMS.includes(platform as BuildPlatform)) {
        throw new Error(`Invalid platform "${platform}". Expected one of: ${VALID_DEFAULT_PLATFORMS.join(', ')}.`);
      }
      const updated = setDefaults({
        target: stringOrUndefined(args.target),
        simulatorName: stringOrUndefined(args.simulatorName),
        simulatorId: stringOrUndefined(args.simulatorId),
        deviceName: stringOrUndefined(args.deviceName),
        deviceId: stringOrUndefined(args.deviceId),
        buildMode: buildMode as BuildMode | undefined,
        platform: platform as BuildPlatform | undefined,
        streaming: booleanOrUndefined(args.streaming),
      });
      const lines = Object.entries(updated)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `  ${k}: ${v}`);
      return toolText(lines.length > 0 ? `Session defaults:\n${lines.join('\n')}` : 'No defaults set.');
    }
    case 'bazel_ios_show_defaults': {
      const cfg = getConfig();
      const defaults = getDefaults();
      const active = getActiveProfile();
      const profiles = getProfiles();
      const lines = [
        `Workspace: ${cfg.workspacePath}`,
        `Bazel: ${cfg.bazelPath}`,
        `Max output: ${cfg.maxOutput}`,
      ];
      if (cfg.configFilePath) {
        lines.push(`Config file: ${cfg.configFilePath}`);
      }
      if (active) {
        lines.push(`Active profile: ${active}`);
      }
      const profileNames = Object.keys(profiles);
      if (profileNames.length > 0) {
        lines.push(`Available profiles: ${profileNames.join(', ')}`);
      }
      const defaultEntries = Object.entries(defaults).filter(([, v]) => v !== undefined);
      if (defaultEntries.length > 0) {
        lines.push('', 'Session defaults:');
        for (const [k, v] of defaultEntries) {
          lines.push(`  ${k}: ${v}`);
        }
      } else {
        lines.push('', 'No session defaults set.');
      }
      return toolText(lines.join('\n'));
    }
    case 'bazel_ios_list_profiles': {
      const profiles = getProfiles();
      const active = getActiveProfile();
      const names = Object.keys(profiles);
      if (names.length === 0) {
        return toolText('No profiles configured. Add a `profiles:` section to .xcodebazelmcp/config.yaml.');
      }
      const lines: string[] = [];
      for (const name of names) {
        const marker = name === active ? ' (active)' : '';
        const p = profiles[name];
        lines.push(`${name}${marker}:`);
        for (const [k, v] of Object.entries(p)) {
          if (v !== undefined) lines.push(`  ${k}: ${v}`);
        }
      }
      return toolText(lines.join('\n'));
    }
    case 'bazel_ios_last_command': {
      const last = getLastCommand();
      return toolText(last ? formatCommandResult(last) : 'No command has run yet.');
    }
    case 'bazel_ios_bsp_status': {
      const config = getConfig();
      const lines = readBspStatus(config.workspacePath);
      if (args.querySetupTargets) {
        const commandResult = await runBazel(
          ['query', 'kind("setup_sourcekit_bsp rule", //...)'],
          600,
          asStringArray(args.startupArgs, 'startupArgs'),
        );
        lines.push('', formatCommandResult(commandResult));
        return toolText(lines.join('\n'), commandResult.exitCode !== 0);
      }
      return toolText(lines.join('\n'));
    }
    case 'bazel_list_workflows': {
      const configWorkflows = getEnabledWorkflows();
      const effective = configWorkflows || DEFAULT_WORKFLOWS;
      const isDefault = !configWorkflows;
      const lines = WORKFLOWS.map((wf) => {
        const isAll = effective.includes('all');
        const isEnabled = isAll || effective.includes(wf.id);
        const status = isEnabled ? '✅' : '⛔';
        return `${status} ${wf.id} — ${wf.name} (${wf.tools.length} tools)\n   ${wf.description}\n   Tools: ${wf.tools.join(', ')}`;
      });
      const enabledNames = getEnabledToolNames(effective);
      const toolCount = enabledNames ? enabledNames.size : bazelToolDefinitions.length;
      const header = isDefault
        ? `Using smart defaults: ${effective.join(', ')} (${toolCount} tools)\nSet enabledWorkflows in config.yaml or use toggle-workflow to customize.\nUse "toggle-workflow all on" to enable everything.\n`
        : effective.includes('all')
          ? `All workflows enabled (${bazelToolDefinitions.length} tools).\n`
          : `Enabled workflows: ${effective.join(', ')} (${toolCount} tools)\n`;
      return toolText(`${header}\n${lines.join('\n\n')}`);
    }
    case 'bazel_toggle_workflow': {
      const id = args.id as string;
      const enabled = args.enabled as boolean;
      if (!id) throw new Error('id is required.');
      if (typeof enabled !== 'boolean') throw new Error('enabled must be a boolean.');

      if (id === 'all') {
        if (enabled) {
          setEnabledWorkflows(['all']);
          return toolText(`All workflows enabled. All ${bazelToolDefinitions.length} tools will be advertised.`);
        }
        setEnabledWorkflows(DEFAULT_WORKFLOWS);
        const enabledNames = getEnabledToolNames(DEFAULT_WORKFLOWS);
        return toolText(`Reset to default workflows: ${DEFAULT_WORKFLOWS.join(', ')}.\nAdvertised tools: ${enabledNames ? enabledNames.size : 'all'}`);
      }

      validateWorkflowIds([id]);

      let current = getEnabledWorkflows();
      if (!current || current.includes('all')) {
        current = enabled ? WORKFLOWS.map((w) => w.id) : WORKFLOWS.map((w) => w.id).filter((i) => i !== id);
      } else {
        current = [...current];
      }
      const set = new Set(current);
      if (enabled) {
        set.add(id);
      } else {
        set.delete(id);
      }
      const updated = [...set].filter((i) => i !== 'all');
      if (updated.length >= WORKFLOWS.length) {
        setEnabledWorkflows(['all']);
        return toolText(`Workflow "${id}" enabled. All ${bazelToolDefinitions.length} tools will be advertised.`);
      }
      setEnabledWorkflows(updated);
      const enabledNames = getEnabledToolNames(updated);
      return toolText(`Workflow "${id}" ${enabled ? 'enabled' : 'disabled'}.\nActive workflows: ${updated.join(', ')}\nAdvertised tools: ${enabledNames ? enabledNames.size : 'all'}`);
    }
    default:
      return undefined;
  }
}
