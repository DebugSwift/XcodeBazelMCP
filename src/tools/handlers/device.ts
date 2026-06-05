import type { JsonObject, ToolCallResult, ToolDefinition, BuildArgs } from '../../types/index.js';
import {
  asStringArray,
  buildCommandArgs,
  configArgs,
  requireLabel,
  runBazel,
  testFilterArgs,
} from '../../core/bazel.js';
import { deployBuiltAppToDevice } from '../../core/device-deploy.js';
import {
  deviceInfo,
  formatDeviceError,
  installAppOnDevice,
  launchAppOnDevice,
  listDevicePairs,
  listDevices,
  pairDevice,
  resolveDevice,
  screenshotDevice,
  startDeviceLogCapture,
  terminateAppOnDevice,
  unpairDevice,
} from '../../core/devices.js';
import { findAppBundle, readBundleId } from '../../core/simulators.js';
import { getConfig } from '../../runtime/config.js';
import { formatCommandResult, structuredCommandResult, toolResult, toolText } from '../../utils/output.js';
import { deviceLogCaptures, stringOrUndefined, numberOrUndefined } from '../helpers.js';
import { STREAMING_PROPERTY } from '../schema-constants.js';

export const definitions: ToolDefinition[] = [
  {
    name: 'bazel_ios_list_devices',
    description: 'List connected physical iOS devices via devicectl.',
    inputSchema: {
      type: 'object',
      properties: {
        onlyConnected: { type: 'boolean', description: 'Only show connected devices (default: true).' },
      },
    },
  },
  {
    name: 'bazel_ios_device_build_and_run',
    description:
      'Build a Bazel iOS app for device (arm64), install it on a connected device, and launch it.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Bazel target label, for example //:MyApp.' },
        buildMode: {
          type: 'string',
          enum: ['none', 'debug', 'release', 'release_with_symbols'],
        },
        deviceId: { type: 'string', description: 'Device UDID. If omitted, uses the first connected device.' },
        deviceName: { type: 'string', description: 'Device name (alternative to deviceId).' },
        configs: { type: 'array', items: { type: 'string' } },
        startupArgs: { type: 'array', items: { type: 'string' } },
        extraArgs: { type: 'array', items: { type: 'string' } },
        launchArgs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Arguments passed to the launched app process.',
        },
        launchEnv: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Environment variables injected into the launched app on device.',
        },
        timeoutSeconds: { type: 'number' },
        streaming: STREAMING_PROPERTY,
      },
      required: ['target'],
    },
  },
  {
    name: 'bazel_ios_device_get_app_path',
    description: 'Return the .app bundle path for a previously built Bazel device target.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Bazel target label (e.g. //app:app).' },
      },
      required: ['target'],
    },
  },
  {
    name: 'bazel_ios_device_install_app',
    description: 'Install a previously built .app bundle onto a connected physical iOS device.',
    inputSchema: {
      type: 'object',
      properties: {
        appPath: { type: 'string', description: 'Absolute path to the .app bundle.' },
        deviceId: { type: 'string', description: 'Device UDID.' },
        deviceName: { type: 'string', description: 'Device name (alternative to deviceId).' },
      },
      required: ['appPath'],
    },
  },
  {
    name: 'bazel_ios_device_launch_app',
    description: 'Launch an installed app on a connected physical iOS device by bundle identifier.',
    inputSchema: {
      type: 'object',
      properties: {
        bundleId: { type: 'string', description: 'App bundle identifier.' },
        deviceId: { type: 'string', description: 'Device UDID.' },
        deviceName: { type: 'string', description: 'Device name (alternative to deviceId).' },
        launchArgs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Arguments passed to the app process.',
        },
        launchEnv: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Environment variables injected into the launched app.',
        },
      },
      required: ['bundleId'],
    },
  },
  {
    name: 'bazel_ios_device_stop_app',
    description: 'Terminate a running app on a connected physical iOS device by bundle identifier.',
    inputSchema: {
      type: 'object',
      properties: {
        bundleId: { type: 'string', description: 'App bundle identifier (e.g. com.example.MyApp).' },
        deviceId: { type: 'string', description: 'Device UDID.' },
        deviceName: { type: 'string', description: 'Device name (alternative to deviceId).' },
      },
      required: ['bundleId'],
    },
  },
  {
    name: 'bazel_ios_device_test',
    description:
      'Run Bazel iOS tests on a connected physical device. Builds with arm64 and runs via `bazel test` with `--test_arg` targeting the device.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Bazel test target label.' },
        testFilter: { type: 'string', description: 'Optional test filter. Supports pipe-separated values (e.g. "SuiteA|SuiteB") to run multiple suites.' },
        deviceId: { type: 'string', description: 'Device UDID.' },
        deviceName: { type: 'string', description: 'Device name.' },
        configs: { type: 'array', items: { type: 'string' } },
        startupArgs: { type: 'array', items: { type: 'string' } },
        extraArgs: { type: 'array', items: { type: 'string' } },
        timeoutSeconds: { type: 'number' },
        streaming: STREAMING_PROPERTY,
      },
      required: ['target'],
    },
  },
  {
    name: 'bazel_ios_device_screenshot',
    description: 'Take a screenshot of a connected physical iOS device screen.',
    inputSchema: {
      type: 'object',
      properties: {
        outputPath: { type: 'string', description: 'File path to save the screenshot.' },
        deviceId: { type: 'string', description: 'Device UDID.' },
        deviceName: { type: 'string', description: 'Device name.' },
      },
      required: ['outputPath'],
    },
  },
  {
    name: 'bazel_ios_device_log_start',
    description: 'Start capturing logs from a connected physical iOS device. Tries pymobiledevice3 first (iOS 17+ via CoreDevice tunnel), falls back to idevicesyslog for older devices.',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: 'Device UDID.' },
        deviceName: { type: 'string', description: 'Device name.' },
        processName: { type: 'string', description: 'Filter logs to this process name.' },
      },
    },
  },
  {
    name: 'bazel_ios_device_log_stop',
    description: 'Stop an active device log capture and return captured output.',
    inputSchema: {
      type: 'object',
      properties: {
        captureId: { type: 'string', description: 'Log capture ID from device_log_start.' },
      },
      required: ['captureId'],
    },
  },
  {
    name: 'bazel_ios_device_info',
    description: 'Get detailed information about a connected physical iOS device (model, OS, capacity, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: 'Device UDID.' },
        deviceName: { type: 'string', description: 'Device name.' },
      },
    },
  },
  {
    name: 'bazel_ios_device_pair',
    description: 'Pair with a physical iOS device for development.',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: 'Device UDID to pair with.' },
        deviceName: { type: 'string', description: 'Device name.' },
      },
    },
  },
  {
    name: 'bazel_ios_device_unpair',
    description: 'Unpair a previously paired physical iOS device.',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: 'Device UDID to unpair.' },
        deviceName: { type: 'string', description: 'Device name.' },
      },
    },
  },
  {
    name: 'bazel_ios_device_list_pairs',
    description: 'List all paired physical iOS devices.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

const HANDLED = new Set(definitions.map(d => d.name));

export function canHandle(name: string): boolean {
  return HANDLED.has(name);
}

export async function handle(name: string, args: JsonObject): Promise<ToolCallResult | undefined> {
  switch (name) {
    case 'bazel_ios_list_devices': {
      const onlyConnected = args.onlyConnected !== false;
      const { command, devices } = await listDevices();
      if (command.exitCode !== 0) {
        return toolText(formatCommandResult(command), true);
      }
      const filtered = onlyConnected ? devices.filter((d) => d.state === 'connected') : devices;
      const grouped: Record<string, typeof filtered> = {};
      for (const d of filtered) {
        const plat = d.platform || 'Unknown';
        (grouped[plat] ||= []).push(d);
      }
      const lines = ['📱 Physical Devices', ''];
      for (const [platform, devs] of Object.entries(grouped)) {
        lines.push(`${platform} Devices:`, '');
        for (const d of devs) {
          const icon = d.platform === 'watchOS' ? '⌚️' : '📱';
          const status = d.state === 'connected' ? '✓' : '✗';
          lines.push(`  ${icon} [${status}] ${d.name}`);
          lines.push(`    OS: ${d.osVersion}`);
          lines.push(`    hardware UDID: ${d.udid}`);
          if (d.coreDeviceIdentifier && d.coreDeviceIdentifier !== d.udid) {
            lines.push(`    CoreDevice ID: ${d.coreDeviceIdentifier}`);
          }
          if (d.connectionType && d.connectionType !== 'unknown') {
            lines.push(`    Connection: ${d.connectionType}`);
          }
          lines.push('');
        }
      }
      lines.push(`✅ ${filtered.length} device${filtered.length !== 1 ? 's' : ''} found.`);
      lines.push('', 'Hints');
      lines.push('  Pass hardware UDID or CoreDevice ID as deviceId, or use deviceName.');
      lines.push('  Run bazel_ios_health before long device builds to verify signing and connectivity.');
      return toolResult(lines.join('\n'), { devices: filtered });
    }
    case 'bazel_ios_device_build_and_run': {
      const buildArgs = { ...args, platform: 'device' } as BuildArgs;
      const buildResult = await runBazel(
        buildCommandArgs(buildArgs),
        numberOrUndefined(buildArgs.timeoutSeconds) || 1_800,
        asStringArray(buildArgs.startupArgs, 'startupArgs'),
      );
      if (buildResult.exitCode !== 0) {
        return toolText(formatCommandResult(buildResult), true);
      }

      return deployBuiltAppToDevice({
        target: requireLabel(buildArgs.target),
        buildResult,
        deviceId: stringOrUndefined(args.deviceId),
        deviceName: stringOrUndefined(args.deviceName),
        launchArgs: asStringArray(args.launchArgs, 'launchArgs'),
        launchEnv: (args.launchEnv as Record<string, string> | undefined) || {},
      });
    }
    case 'bazel_ios_device_get_app_path': {
      const target = requireLabel(args.target);
      const config = getConfig();
      const appPath = findAppBundle(config.workspacePath, target);
      if (!appPath) {
        return toolText(`No .app bundle found for ${target}. Build the target first (platform=device).`, true);
      }
      return toolText(appPath);
    }
    case 'bazel_ios_device_install_app': {
      if (typeof args.appPath !== 'string' || !args.appPath.trim()) {
        throw new Error('appPath is required.');
      }
      const device = await resolveDevice({
        deviceId: stringOrUndefined(args.deviceId),
        deviceName: stringOrUndefined(args.deviceName),
      });
      const installResult = await installAppOnDevice(device.udid, args.appPath);

      let bundleId = '(unknown)';
      try { bundleId = readBundleId(args.appPath); } catch { /* best effort */ }

      const hint = installResult.exitCode !== 0 ? formatDeviceError(installResult.output) : undefined;
      const lines = [
        `Device: ${device.name} (${device.udid}) — iOS ${device.osVersion}`,
        `Bundle ID: ${bundleId}`,
        '',
        formatCommandResult(installResult),
      ];
      if (hint) lines.push('', hint);
      return toolText(lines.join('\n'), installResult.exitCode !== 0);
    }
    case 'bazel_ios_device_launch_app': {
      if (typeof args.bundleId !== 'string' || !args.bundleId.trim()) {
        throw new Error('bundleId is required.');
      }
      const device = await resolveDevice({
        deviceId: stringOrUndefined(args.deviceId),
        deviceName: stringOrUndefined(args.deviceName),
      });
      const launchResult = await launchAppOnDevice(
        device.udid,
        args.bundleId,
        asStringArray(args.launchArgs, 'launchArgs'),
        (args.launchEnv as Record<string, string> | undefined) || {},
      );
      return toolText(
        `Device: ${device.name} (${device.udid})\n${formatCommandResult(launchResult)}`,
        launchResult.exitCode !== 0,
      );
    }
    case 'bazel_ios_device_stop_app': {
      if (typeof args.bundleId !== 'string') throw new Error('bundleId is required.');
      const device = await resolveDevice({
        deviceId: stringOrUndefined(args.deviceId),
        deviceName: stringOrUndefined(args.deviceName),
      });
      const result = await terminateAppOnDevice(device.udid, args.bundleId);
      return toolText(
        `App ${args.bundleId} terminated on ${device.name} (${device.udid})\n${formatCommandResult(result)}`,
        result.exitCode !== 0,
      );
    }
    case 'bazel_ios_device_test': {
      const target = requireLabel(args.target as string);
      const device = await resolveDevice({
        deviceId: stringOrUndefined(args.deviceId),
        deviceName: stringOrUndefined(args.deviceName),
      });
      const testArgs = [
        'test',
        '--ios_multi_cpus=arm64',
        ...configArgs(args.configs),
        ...asStringArray(args.extraArgs, 'extraArgs'),
      ];
      testArgs.push(...testFilterArgs(args.testFilter));
      testArgs.push(`--test_arg=--destination`, `--test_arg=id=${device.udid}`);
      testArgs.push(target);
      const result = await runBazel(
        testArgs,
        numberOrUndefined(args.timeoutSeconds) || 1_800,
        asStringArray(args.startupArgs, 'startupArgs'),
      );
      return toolResult(
        formatCommandResult(result),
        { ...structuredCommandResult(result), target, device: device.name },
        result.exitCode !== 0,
      );
    }
    case 'bazel_ios_device_screenshot': {
      if (typeof args.outputPath !== 'string') throw new Error('outputPath is required.');
      const device = await resolveDevice({
        deviceId: stringOrUndefined(args.deviceId),
        deviceName: stringOrUndefined(args.deviceName),
      });
      const result = await screenshotDevice(device.udid, args.outputPath);
      return toolText(
        `Screenshot saved to ${args.outputPath}\nDevice: ${device.name} (${device.udid})\n${formatCommandResult(result)}`,
        result.exitCode !== 0,
      );
    }
    case 'bazel_ios_device_log_start': {
      const device = await resolveDevice({
        deviceId: stringOrUndefined(args.deviceId),
        deviceName: stringOrUndefined(args.deviceName),
      });
      const captureId = `device-log-${Date.now()}`;
      const capture = await startDeviceLogCapture(
        device.udid,
        args.processName ? String(args.processName) : undefined,
      );
      deviceLogCaptures.set(captureId, { child: capture.child, getCaptured: capture.getCaptured, tool: capture.tool });

      const note = capture.tool === 'pymobiledevice3'
        ? 'Using pymobiledevice3 (CoreDevice tunnel). Ensure `sudo pymobiledevice3 remote tunneld` is running.'
        : 'Using idevicesyslog (legacy). On iOS 17+ this may not capture logs — install pymobiledevice3 and run `sudo pymobiledevice3 remote tunneld` for full support.';
      return toolText(`Device log capture started.\nCapture ID: ${captureId}\nDevice: ${device.name} (${device.udid})\nBackend: ${capture.tool}\n\n${note}`);
    }
    case 'bazel_ios_device_log_stop': {
      if (typeof args.captureId !== 'string') throw new Error('captureId is required.');
      const entry = deviceLogCaptures.get(args.captureId);
      if (!entry) throw new Error(`No active log capture with ID: ${args.captureId}`);
      entry.child.kill('SIGINT');
      await new Promise((r) => setTimeout(r, 500));
      const output = entry.getCaptured();
      deviceLogCaptures.delete(args.captureId);
      return toolText(`Log capture stopped.\nCapture ID: ${args.captureId}\n\n${output || '(no output captured)'}`);
    }
    case 'bazel_ios_device_info': {
      const device = await resolveDevice({
        deviceId: stringOrUndefined(args.deviceId),
        deviceName: stringOrUndefined(args.deviceName),
      });
      const result = await deviceInfo(device.udid);
      return toolResult(
        formatCommandResult(result),
        { ...structuredCommandResult(result), device: device.name },
        result.exitCode !== 0,
      );
    }
    case 'bazel_ios_device_pair': {
      const device = await resolveDevice({
        deviceId: stringOrUndefined(args.deviceId),
        deviceName: stringOrUndefined(args.deviceName),
      });
      const result = await pairDevice(device.udid);
      return toolText(
        `Pair request sent to ${device.name} (${device.udid})\n${formatCommandResult(result)}`,
        result.exitCode !== 0,
      );
    }
    case 'bazel_ios_device_unpair': {
      const device = await resolveDevice({
        deviceId: stringOrUndefined(args.deviceId),
        deviceName: stringOrUndefined(args.deviceName),
      });
      const result = await unpairDevice(device.udid);
      return toolText(
        `Unpair request sent to ${device.name} (${device.udid})\n${formatCommandResult(result)}`,
        result.exitCode !== 0,
      );
    }
    case 'bazel_ios_device_list_pairs': {
      const result = await listDevicePairs();
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
