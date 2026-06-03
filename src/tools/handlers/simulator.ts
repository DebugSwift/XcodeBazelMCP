import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { JsonObject, ToolCallResult, ToolDefinition, InstallAppArgs, LaunchAppArgs } from '../../types/index.js';
import { asStringArray, requireLabel } from '../../core/bazel.js';
import {
  bootSimulator,
  bootSimulatorIfNeeded,
  clearStatusBar,
  eraseSimulator,
  findAppBundle,
  getSimulatorUiState,
  installApp,
  launchApp,
  listSimulators,
  openSimulatorApp,
  openUrl,
  readBundleId,
  sendPushNotification,
  setPrivacy,
  setSimulatorAppearance,
  setSimulatorLocation,
  setStatusBar,
  shutdownAllSimulators,
  shutdownSimulator,
  startVideoRecording,
  takeScreenshot,
  terminateApp,
} from '../../core/simulators.js';
import { formatCommandResult, toolText } from '../../utils/output.js';
import { getConfig } from '../../runtime/config.js';
import {
  logCaptures,
  nextLogCaptureId,
  videoRecordings,
  nextVideoRecordingId,
  resolveSimulatorFromArgs,
  prependWarning,
  stringOrUndefined,
} from '../helpers.js';

export const definitions: ToolDefinition[] = [
  {
    name: 'bazel_ios_list_simulators',
    description: 'List available iOS Simulator devices from simctl.',
    inputSchema: {
      type: 'object',
      properties: {
        onlyBooted: { type: 'boolean' },
      },
    },
  },
  {
    name: 'bazel_ios_boot_simulator',
    description: 'Boot an iOS simulator device.',
    inputSchema: {
      type: 'object',
      properties: {
        simulatorId: { type: 'string', description: 'Simulator UDID.' },
        simulatorName: { type: 'string', description: 'Simulator device name.' },
      },
    },
  },
  {
    name: 'bazel_ios_shutdown_simulator',
    description: 'Shutdown a running iOS simulator.',
    inputSchema: {
      type: 'object',
      properties: {
        simulatorId: { type: 'string', description: 'Simulator UDID.' },
        all: { type: 'boolean', description: 'Shutdown all booted simulators.' },
      },
    },
  },
  {
    name: 'bazel_ios_erase_simulator',
    description: 'Erase all content and settings from a simulator, restoring it to factory state.',
    inputSchema: {
      type: 'object',
      properties: {
        simulatorId: { type: 'string', description: 'Simulator UDID.' },
      },
      required: ['simulatorId'],
    },
  },
  {
    name: 'bazel_ios_set_simulator_location',
    description: 'Set the simulated GPS location on a booted simulator.',
    inputSchema: {
      type: 'object',
      properties: {
        simulatorId: { type: 'string', description: 'Simulator UDID (default: first booted).' },
        simulatorName: { type: 'string', description: 'Simulator name (alternative to simulatorId).' },
        latitude: { type: 'number', description: 'GPS latitude.' },
        longitude: { type: 'number', description: 'GPS longitude.' },
      },
      required: ['latitude', 'longitude'],
    },
  },
  {
    name: 'bazel_ios_set_simulator_appearance',
    description: 'Set the simulator UI appearance to light or dark mode.',
    inputSchema: {
      type: 'object',
      properties: {
        simulatorId: { type: 'string', description: 'Simulator UDID (default: first booted).' },
        simulatorName: { type: 'string', description: 'Simulator name (alternative to simulatorId).' },
        appearance: { type: 'string', enum: ['light', 'dark'], description: 'Appearance mode.' },
      },
      required: ['appearance'],
    },
  },
  {
    name: 'bazel_ios_open_simulator',
    description: 'Open Simulator.app and optionally bring a specific device to the foreground.',
    inputSchema: {
      type: 'object',
      properties: {
        simulatorId: { type: 'string', description: 'Simulator UDID to focus.' },
      },
    },
  },
  {
    name: 'bazel_ios_set_status_bar',
    description: 'Override the simulator status bar (time, battery, network, etc.). Useful for consistent screenshots.',
    inputSchema: {
      type: 'object',
      properties: {
        simulatorId: { type: 'string', description: 'Simulator UDID (default: first booted).' },
        simulatorName: { type: 'string', description: 'Simulator name (alternative to simulatorId).' },
        time: { type: 'string', description: 'Override time display (e.g. "9:41").' },
        batteryLevel: { type: 'number', description: 'Battery level 0-100.' },
        batteryState: { type: 'string', enum: ['charging', 'charged', 'discharging'], description: 'Battery state.' },
        networkType: { type: 'string', enum: ['wifi', '3g', '4g', '5g', 'lte', 'lte-a', 'lte+'], description: 'Cellular data type.' },
        wifiBars: { type: 'number', description: 'Wi-Fi signal bars 0-3.' },
        cellularBars: { type: 'number', description: 'Cellular signal bars 0-4.' },
        clear: { type: 'boolean', description: 'Clear all overrides instead of setting them.' },
      },
    },
  },
  {
    name: 'bazel_ios_privacy',
    description: 'Grant, revoke, or reset privacy permissions for an app on a simulator.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['grant', 'revoke', 'reset'], description: 'Privacy action.' },
        service: { type: 'string', description: 'Privacy service (e.g. photos, camera, microphone, location, contacts, calendar).' },
        bundleId: { type: 'string', description: 'App bundle identifier. Required for grant/revoke, optional for reset.' },
        simulatorId: { type: 'string', description: 'Simulator UDID (default: first booted).' },
        simulatorName: { type: 'string', description: 'Simulator name (alternative to simulatorId).' },
      },
      required: ['action', 'service'],
    },
  },
  {
    name: 'bazel_ios_ui_dump',
    description: 'Get the current UI state of a booted simulator (appearance, increase contrast).',
    inputSchema: {
      type: 'object',
      properties: {
        simulatorId: { type: 'string', description: 'Simulator UDID (default: first booted).' },
        simulatorName: { type: 'string', description: 'Simulator name (alternative to simulatorId).' },
      },
    },
  },
  {
    name: 'bazel_ios_install_app',
    description: 'Install a previously built .app bundle onto an iOS simulator.',
    inputSchema: {
      type: 'object',
      properties: {
        appPath: {
          type: 'string',
          description: 'Absolute path to the .app bundle.',
        },
        simulatorId: { type: 'string', description: 'Simulator UDID.' },
        simulatorName: { type: 'string', description: 'Simulator name to boot if none booted.' },
      },
      required: ['appPath'],
    },
  },
  {
    name: 'bazel_ios_launch_app',
    description: 'Launch an installed app on an iOS simulator by bundle identifier.',
    inputSchema: {
      type: 'object',
      properties: {
        bundleId: { type: 'string', description: 'App bundle identifier.' },
        simulatorId: { type: 'string', description: 'Simulator UDID.' },
        launchArgs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Arguments passed to the app process.',
        },
        launchEnv: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Environment variables for the app process.',
        },
      },
      required: ['bundleId'],
    },
  },
  {
    name: 'bazel_ios_stop_app',
    description: 'Terminate a running app on a booted simulator by bundle identifier.',
    inputSchema: {
      type: 'object',
      properties: {
        bundleId: { type: 'string', description: 'App bundle identifier (e.g. com.example.MyApp).' },
        simulatorId: { type: 'string', description: 'Simulator UDID (default: first booted).' },
        simulatorName: { type: 'string', description: 'Simulator name (alternative to simulatorId).' },
      },
      required: ['bundleId'],
    },
  },
  {
    name: 'bazel_ios_get_app_path',
    description: 'Return the .app bundle path for a previously built Bazel target.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Bazel target label (e.g. //app:app).' },
      },
      required: ['target'],
    },
  },
  {
    name: 'bazel_ios_get_bundle_id',
    description: 'Extract CFBundleIdentifier from a built .app bundle.',
    inputSchema: {
      type: 'object',
      properties: {
        appPath: { type: 'string', description: 'Path to the .app bundle, or a Bazel target label to auto-locate it.' },
      },
      required: ['appPath'],
    },
  },
  {
    name: 'bazel_ios_screenshot',
    description: 'Capture a screenshot from a booted simulator and save to a file.',
    inputSchema: {
      type: 'object',
      properties: {
        outputPath: { type: 'string', description: 'File path to save the screenshot (e.g. /tmp/screen.png).' },
        simulatorId: { type: 'string', description: 'Simulator UDID (default: first booted).' },
        simulatorName: { type: 'string', description: 'Simulator name (alternative to simulatorId).' },
        mask: { type: 'string', enum: ['alpha', 'black', 'ignored'], description: 'Device mask style (default: ignored).' },
      },
      required: ['outputPath'],
    },
  },
  {
    name: 'bazel_ios_video_record_start',
    description: 'Start recording video from a booted simulator. Returns a recording ID to stop later.',
    inputSchema: {
      type: 'object',
      properties: {
        outputPath: { type: 'string', description: 'File path for the video (e.g. /tmp/recording.mp4).' },
        simulatorId: { type: 'string', description: 'Simulator UDID (default: first booted).' },
        simulatorName: { type: 'string', description: 'Simulator name (alternative to simulatorId).' },
      },
      required: ['outputPath'],
    },
  },
  {
    name: 'bazel_ios_video_record_stop',
    description: 'Stop an active video recording and finalize the file.',
    inputSchema: {
      type: 'object',
      properties: {
        recordingId: { type: 'string', description: 'Recording ID returned by video_record_start.' },
      },
      required: ['recordingId'],
    },
  },
  {
    name: 'bazel_ios_log_capture_start',
    description: 'Start capturing device logs from a booted simulator. Returns a capture ID.',
    inputSchema: {
      type: 'object',
      properties: {
        simulatorId: { type: 'string', description: 'Simulator UDID (default: first booted).' },
        processName: { type: 'string', description: 'Filter logs by process name.' },
        subsystem: { type: 'string', description: 'Filter logs by os_log subsystem (e.g. com.example.MyApp).' },
        level: { type: 'string', enum: ['default', 'info', 'debug'], description: 'Minimum log level.' },
        messageContains: {
          type: 'string',
          description: 'On stop, keep only NDJSON entries whose message/data contains this substring.',
        },
        jsonLinesOnly: {
          type: 'boolean',
          description: 'On stop, parse NDJSON lines and return structured agent debug entries only.',
        },
      },
    },
  },
  {
    name: 'bazel_ios_log_capture_stop',
    description: 'Stop a running log capture and return captured logs.',
    inputSchema: {
      type: 'object',
      properties: {
        captureId: { type: 'string', description: 'Capture ID returned by log_capture_start.' },
      },
      required: ['captureId'],
    },
  },
  {
    name: 'bazel_ios_push_notification',
    description: 'Send a simulated push notification to an app on a booted simulator.',
    inputSchema: {
      type: 'object',
      properties: {
        bundleId: { type: 'string', description: 'App bundle identifier.' },
        title: { type: 'string', description: 'Notification title.' },
        body: { type: 'string', description: 'Notification body text.' },
        badge: { type: 'number', description: 'Badge count.' },
        payloadPath: { type: 'string', description: 'Path to a JSON payload file (alternative to title/body/badge).' },
        simulatorId: { type: 'string', description: 'Simulator UDID (default: first booted).' },
        simulatorName: { type: 'string', description: 'Simulator name (alternative to simulatorId).' },
      },
      required: ['bundleId'],
    },
  },
  {
    name: 'bazel_ios_open_url',
    description: 'Open a URL on a booted simulator (deep links, universal links, web URLs).',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to open.' },
        simulatorId: { type: 'string', description: 'Simulator UDID (default: first booted).' },
        simulatorName: { type: 'string', description: 'Simulator name (alternative to simulatorId).' },
      },
      required: ['url'],
    },
  },
];

const HANDLED = new Set(definitions.map(d => d.name));

export function canHandle(name: string): boolean {
  return HANDLED.has(name);
}

export async function handle(name: string, args: JsonObject): Promise<ToolCallResult | undefined> {
  switch (name) {
    case 'bazel_ios_list_simulators': {
      const { command, devices } = await listSimulators(Boolean(args.onlyBooted));
      if (command.exitCode !== 0) {
        return toolText(formatCommandResult(command), true);
      }
      return toolText(JSON.stringify(devices, null, 2));
    }
    case 'bazel_ios_boot_simulator': {
      const { sim, warning: simWarning } = await resolveSimulatorFromArgs(args);
      if (sim.state === 'Booted') {
        return toolText(prependWarning(`${sim.name} (${sim.udid}) is already booted.`, simWarning));
      }
      const bootResult = await bootSimulator(sim.udid);
      return toolText(
        prependWarning(`${sim.name} (${sim.udid})\n${formatCommandResult(bootResult)}`, simWarning),
        bootResult.exitCode !== 0,
      );
    }
    case 'bazel_ios_shutdown_simulator': {
      if (args.all === true) {
        const result = await shutdownAllSimulators();
        return toolText(formatCommandResult(result), result.exitCode !== 0);
      }
      const { devices } = await listSimulators(true);
      const udid = stringOrUndefined(args.simulatorId);
      if (!udid && devices.length === 0) {
        return toolText('No booted simulators to shutdown.');
      }
      if (!udid && devices.length > 1) {
        const list = devices.map((d) => `  - ${d.name} (${d.udid})`).join('\n');
        return toolText(
          `⚠️ Multiple simulators booted:\n${list}\n\nProvide a simulatorId to target a specific device, or use --all to shut down all.`,
          true,
        );
      }
      const targetUdid = udid || devices[0].udid;
      const targetName = devices.find((d) => d.udid === targetUdid)?.name || targetUdid;
      const result = await shutdownSimulator(targetUdid);
      return toolText(
        `${targetName} (${targetUdid})\n${formatCommandResult(result)}`,
        result.exitCode !== 0,
      );
    }
    case 'bazel_ios_erase_simulator': {
      if (typeof args.simulatorId !== 'string') throw new Error('simulatorId is required.');
      const result = await eraseSimulator(args.simulatorId);
      return toolText(formatCommandResult(result), result.exitCode !== 0);
    }
    case 'bazel_ios_set_simulator_location': {
      if (typeof args.latitude !== 'number' || typeof args.longitude !== 'number') {
        throw new Error('latitude and longitude are required numbers.');
      }
      const { sim, warning: simWarning } = await resolveSimulatorFromArgs(args);
      const result = await setSimulatorLocation(sim.udid, args.latitude, args.longitude);
      return toolText(
        prependWarning(`Location set on ${sim.name} (${sim.udid}) to ${args.latitude}, ${args.longitude}\n${formatCommandResult(result)}`, simWarning),
        result.exitCode !== 0,
      );
    }
    case 'bazel_ios_set_simulator_appearance': {
      if (args.appearance !== 'light' && args.appearance !== 'dark') {
        throw new Error('appearance must be "light" or "dark".');
      }
      const { sim, warning: simWarning } = await resolveSimulatorFromArgs(args);
      const result = await setSimulatorAppearance(sim.udid, args.appearance);
      return toolText(
        prependWarning(`Appearance set to ${args.appearance} on ${sim.name} (${sim.udid})\n${formatCommandResult(result)}`, simWarning),
        result.exitCode !== 0,
      );
    }
    case 'bazel_ios_open_simulator': {
      const result = await openSimulatorApp(stringOrUndefined(args.simulatorId));
      return toolText(formatCommandResult(result), result.exitCode !== 0);
    }
    case 'bazel_ios_set_status_bar': {
      const { sim, warning: simWarning } = await resolveSimulatorFromArgs(args);
      if (args.clear === true) {
        const result = await clearStatusBar(sim.udid);
        return toolText(prependWarning(`Status bar overrides cleared on ${sim.name}\n${formatCommandResult(result)}`, simWarning), result.exitCode !== 0);
      }
      const overrides: Record<string, string> = {};
      if (typeof args.time === 'string') overrides['time'] = args.time;
      if (typeof args.batteryLevel === 'number') overrides['batteryLevel'] = String(args.batteryLevel);
      if (typeof args.batteryState === 'string') overrides['batteryState'] = args.batteryState;
      if (typeof args.networkType === 'string') overrides['dataNetwork'] = args.networkType;
      if (typeof args.wifiBars === 'number') overrides['wifiBars'] = String(args.wifiBars);
      if (typeof args.cellularBars === 'number') overrides['cellularBars'] = String(args.cellularBars);
      if (Object.keys(overrides).length === 0) {
        return toolText('No overrides specified. Pass time, batteryLevel, batteryState, networkType, wifiBars, or cellularBars.', true);
      }
      const result = await setStatusBar(sim.udid, overrides);
      return toolText(
        prependWarning(`Status bar updated on ${sim.name}: ${JSON.stringify(overrides)}\n${formatCommandResult(result)}`, simWarning),
        result.exitCode !== 0,
      );
    }
    case 'bazel_ios_privacy': {
      const action = args.action as 'grant' | 'revoke' | 'reset';
      if (!['grant', 'revoke', 'reset'].includes(action)) throw new Error('action must be grant, revoke, or reset.');
      if (typeof args.service !== 'string') throw new Error('service is required.');
      if (action !== 'reset' && typeof args.bundleId !== 'string') throw new Error('bundleId is required for grant/revoke.');
      const { sim, warning: simWarning } = await resolveSimulatorFromArgs(args);
      const result = await setPrivacy(sim.udid, action, args.service, stringOrUndefined(args.bundleId));
      return toolText(
        prependWarning(`Privacy ${action} ${args.service} on ${sim.name}${args.bundleId ? ` for ${args.bundleId}` : ''}\n${formatCommandResult(result)}`, simWarning),
        result.exitCode !== 0,
      );
    }
    case 'bazel_ios_ui_dump': {
      const { sim, warning: simWarning } = await resolveSimulatorFromArgs(args);
      const { appearance, increaseContrast } = await getSimulatorUiState(sim.udid);
      const lines = [
        `Simulator: ${sim.name} (${sim.udid})`,
        `Appearance: ${appearance.output.trim()}`,
        `Increase Contrast: ${increaseContrast.output.trim()}`,
      ];
      return toolText(prependWarning(lines.join('\n'), simWarning));
    }
    case 'bazel_ios_install_app': {
      const installArgs = args as InstallAppArgs;
      if (typeof installArgs.appPath !== 'string' || !installArgs.appPath.trim()) {
        throw new Error('appPath is required.');
      }

      const { sim: simulator, warning: simWarning } = await resolveSimulatorFromArgs(installArgs as JsonObject);

      const bootResult = await bootSimulatorIfNeeded(simulator);
      if (bootResult && bootResult.exitCode !== 0) {
        return toolText(`Boot failed:\n${formatCommandResult(bootResult)}`, true);
      }

      const installResult = await installApp(simulator.udid, installArgs.appPath);

      let bundleId = '(unknown)';
      try {
        bundleId = readBundleId(installArgs.appPath);
      } catch {
        // best effort — don't mask the install result
      }

      const lines = [
        `Simulator: ${simulator.name} (${simulator.udid})`,
        bootResult ? `Boot: OK` : `Boot: already booted`,
        `Bundle ID: ${bundleId}`,
        '',
        formatCommandResult(installResult),
      ];

      return toolText(prependWarning(lines.join('\n'), simWarning), installResult.exitCode !== 0);
    }
    case 'bazel_ios_launch_app': {
      const launchAppArgs = args as LaunchAppArgs;
      if (typeof launchAppArgs.bundleId !== 'string' || !launchAppArgs.bundleId.trim()) {
        throw new Error('bundleId is required.');
      }

      const { sim, warning: simWarning } = await resolveSimulatorFromArgs(launchAppArgs as JsonObject);
      if (sim.state !== 'Booted') {
        throw new Error(`Simulator ${sim.name} (${sim.udid}) is not booted. Boot it first or provide a booted simulatorId.`);
      }

      const launchResult = await launchApp(
        sim.udid,
        launchAppArgs.bundleId,
        asStringArray(launchAppArgs.launchArgs, 'launchArgs'),
        (launchAppArgs.launchEnv as Record<string, string> | undefined) || {},
      );

      return toolText(
        prependWarning(`Launched ${launchAppArgs.bundleId} on ${sim.name} (${sim.udid})\n${formatCommandResult(launchResult)}`, simWarning),
        launchResult.exitCode !== 0,
      );
    }
    case 'bazel_ios_stop_app': {
      if (typeof args.bundleId !== 'string') throw new Error('bundleId is required.');
      const { sim, warning: simWarning } = await resolveSimulatorFromArgs(args);
      const result = await terminateApp(sim.udid, args.bundleId);
      return toolText(
        prependWarning(`App ${args.bundleId} terminated on ${sim.name} (${sim.udid})\n${formatCommandResult(result)}`, simWarning),
        result.exitCode !== 0,
      );
    }
    case 'bazel_ios_get_app_path': {
      const target = requireLabel(args.target);
      const config = getConfig();
      const appPath = findAppBundle(config.workspacePath, target);
      if (!appPath) {
        return toolText(`No .app bundle found for ${target}. Build the target first.`, true);
      }
      return toolText(appPath);
    }
    case 'bazel_ios_get_bundle_id': {
      if (typeof args.appPath !== 'string') throw new Error('appPath is required.');
      let appPath = args.appPath;
      if (appPath.startsWith('//')) {
        const config = getConfig();
        const found = findAppBundle(config.workspacePath, appPath);
        if (!found) return toolText(`No .app bundle found for ${appPath}. Build the target first.`, true);
        appPath = found;
      }
      const bundleId = readBundleId(appPath);
      return toolText(bundleId);
    }
    case 'bazel_ios_screenshot': {
      if (typeof args.outputPath !== 'string') throw new Error('outputPath is required.');
      const { sim, warning: simWarning } = await resolveSimulatorFromArgs(args);
      const mask = (args.mask as 'alpha' | 'black' | 'ignored') || 'ignored';
      const result = await takeScreenshot(sim.udid, args.outputPath, mask);
      return toolText(
        prependWarning(`Screenshot saved to ${args.outputPath}\nSimulator: ${sim.name} (${sim.udid})\n${formatCommandResult(result)}`, simWarning),
        result.exitCode !== 0,
      );
    }
    case 'bazel_ios_video_record_start': {
      if (typeof args.outputPath !== 'string') throw new Error('outputPath is required.');
      const { sim, warning: simWarning } = await resolveSimulatorFromArgs(args);
      const recordingId = `video-${nextVideoRecordingId()}`;
      const child = await startVideoRecording(sim.udid, args.outputPath);
      videoRecordings.set(recordingId, { child, outputPath: args.outputPath, simulatorId: sim.udid });
      return toolText(prependWarning(`Video recording started.\nRecording ID: ${recordingId}\nOutput: ${args.outputPath}\nSimulator: ${sim.name} (${sim.udid})`, simWarning));
    }
    case 'bazel_ios_video_record_stop': {
      if (typeof args.recordingId !== 'string') throw new Error('recordingId is required.');
      const recording = videoRecordings.get(args.recordingId);
      if (!recording) throw new Error(`Unknown recording ID: ${args.recordingId}`);
      recording.child.kill('SIGINT');
      videoRecordings.delete(args.recordingId);
      await new Promise((resolve) => setTimeout(resolve, 500));
      return toolText(`Video recording stopped (${args.recordingId}).\nSaved to: ${recording.outputPath}`);
    }
    case 'bazel_ios_log_capture_start': {
      const { sim, warning: simWarning } = await resolveSimulatorFromArgs(args);
      if (sim.state !== 'Booted') throw new Error(`Simulator ${sim.name} (${sim.udid}) is not booted. Boot it first.`);

      const captureId = `log-${nextLogCaptureId()}`;
      const logArgs = ['simctl', 'spawn', sim.udid, 'log', 'stream', '--style', 'compact'];
      if (typeof args.level === 'string') logArgs.push('--level', args.level);

      const predicates: string[] = [];
      if (typeof args.processName === 'string') predicates.push(`process == "${args.processName.replace(/"/g, '\\"')}"`);
      if (typeof args.subsystem === 'string') predicates.push(`subsystem == "${args.subsystem.replace(/"/g, '\\"')}"`);
      if (predicates.length > 0) {
        logArgs.push('--predicate', predicates.join(' OR '));
      }

      const child = spawn('xcrun', logArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      const maxLogSize = 500_000;
      const capture = {
        child,
        output: '',
        simulatorId: sim.udid,
        messageContains: stringOrUndefined(args.messageContains),
        jsonLinesOnly: args.jsonLinesOnly === true,
      };
      logCaptures.set(captureId, capture);
      child.stdout.on('data', (chunk: Buffer) => {
        if (capture.output.length < maxLogSize) capture.output += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (capture.output.length < maxLogSize) capture.output += chunk.toString();
      });

      return toolText(prependWarning(`Log capture started.\nCapture ID: ${captureId}\nSimulator: ${sim.name} (${sim.udid})`, simWarning));
    }
    case 'bazel_ios_log_capture_stop': {
      if (typeof args.captureId !== 'string') throw new Error('captureId is required.');
      const capture = logCaptures.get(args.captureId);
      if (!capture) throw new Error(`Unknown capture ID: ${args.captureId}`);

      capture.child.kill('SIGTERM');
      logCaptures.delete(args.captureId);

      const logOutput = capture.output || '(no logs captured)';
      const truncated = logOutput.length >= 500_000 ? '\n[log output truncated at 500KB]' : '';

      if (capture.jsonLinesOnly || capture.messageContains) {
        const { extractNdjsonFromLogCapture } = await import('../../core/agent-debug-log.js');
        const entries = extractNdjsonFromLogCapture(logOutput, {
          messageContains: capture.messageContains,
          jsonLinesOnly: capture.jsonLinesOnly,
        });
        return toolText(
          JSON.stringify(
            {
              captureId: args.captureId,
              simulatorId: capture.simulatorId,
              entryCount: entries.length,
              entries,
              truncated: logOutput.length >= 500_000,
            },
            null,
            2,
          ) + truncated,
        );
      }

      return toolText(`Log capture stopped (${args.captureId}).\nSimulator: ${capture.simulatorId}\n\n${logOutput}${truncated}`);
    }
    case 'bazel_ios_push_notification': {
      if (typeof args.bundleId !== 'string') throw new Error('bundleId is required.');
      const { sim, warning: simWarning } = await resolveSimulatorFromArgs(args);

      let payloadPath = stringOrUndefined(args.payloadPath);
      let tempPayload = false;
      if (!payloadPath) {
        const payload: Record<string, unknown> = { aps: {} };
        const aps = payload.aps as Record<string, unknown>;
        if (typeof args.title === 'string') {
          aps.alert = { title: args.title, body: args.body || '' };
        } else if (typeof args.body === 'string') {
          aps.alert = args.body;
        }
        if (typeof args.badge === 'number') aps.badge = args.badge;
        const { writeFileSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        payloadPath = join(tmpdir(), `mcp-push-${Date.now()}.json`);
        writeFileSync(payloadPath, JSON.stringify(payload));
        tempPayload = true;
      }

      const result = await sendPushNotification(sim.udid, args.bundleId, payloadPath);
      if (tempPayload) {
        try { const { unlinkSync } = await import('node:fs'); unlinkSync(payloadPath); } catch { /* best effort */ }
      }
      return toolText(
        prependWarning(`Push notification sent to ${args.bundleId} on ${sim.name}\n${formatCommandResult(result)}`, simWarning),
        result.exitCode !== 0,
      );
    }
    case 'bazel_ios_open_url': {
      if (typeof args.url !== 'string') throw new Error('url is required.');
      const { sim, warning: simWarning } = await resolveSimulatorFromArgs(args);
      const result = await openUrl(sim.udid, args.url);
      return toolText(
        prependWarning(`Opened ${args.url} on ${sim.name}\n${formatCommandResult(result)}`, simWarning),
        result.exitCode !== 0,
      );
    }
    default:
      return undefined;
  }
}

