import { requireLabel } from './bazel.js';
import {
  formatDeviceError,
  installAppOnDevice,
  launchAppOnDevice,
  resolveDevice,
} from './devices.js';
import { findAppBundle, readBundleId } from './simulators.js';
import { getConfig } from '../runtime/config.js';
import type { CommandResult, ToolCallResult } from '../types/index.js';
import { formatCommandResult, toolResult, toolText } from '../utils/output.js';

export async function deployBuiltAppToDevice(params: {
  target: string;
  buildResult: CommandResult;
  deviceId?: string;
  deviceName?: string;
  launchArgs?: string[];
  launchEnv?: Record<string, string>;
}): Promise<ToolCallResult> {
  const config = getConfig();
  const label = requireLabel(params.target);
  const appPath = findAppBundle(config.workspacePath, label);
  if (!appPath) {
    return toolText(
      `${formatCommandResult(params.buildResult)}\n\nBuild succeeded but .app bundle not found in bazel-bin. Check the target produces an ios_application.`,
      true,
    );
  }

  const device = await resolveDevice({
    deviceId: params.deviceId,
    deviceName: params.deviceName,
  });

  const installResult = await installAppOnDevice(device.udid, appPath);
  if (installResult.exitCode !== 0) {
    let bundleId: string | undefined;
    try { bundleId = readBundleId(appPath); } catch { /* best effort */ }

    const hint = formatDeviceError(installResult.output);
    const lines = [
      formatCommandResult(params.buildResult),
      '',
      'Build succeeded but install failed.',
      `App: ${appPath}`,
      bundleId ? `Bundle ID: ${bundleId}` : '',
      `Device: ${device.name} (${device.udid})`,
      '',
      formatCommandResult(installResult),
      '',
      'Retry without rebuilding:',
      `  bazel_ios_device_install_app appPath="${appPath}" deviceName="${device.name}"`,
      bundleId ? `  bazel_ios_device_launch_app bundleId="${bundleId}" deviceName="${device.name}"` : '',
    ].filter(Boolean);
    if (hint) lines.push('', hint);

    return toolResult(lines.join('\n'), {
      build: 'ok',
      install: 'failed',
      appPath,
      bundleId,
      deviceId: device.udid,
      deviceName: device.name,
      installError: installResult.output.trim(),
      retryTools: ['bazel_ios_device_install_app', 'bazel_ios_device_launch_app'],
    }, true);
  }

  let bundleId: string;
  try {
    bundleId = readBundleId(appPath);
  } catch (err) {
    return toolText(
      `${formatCommandResult(params.buildResult)}\n\nBuild and install succeeded but failed to read bundle ID: ${(err as Error).message}`,
      true,
    );
  }

  const launchResult = await launchAppOnDevice(
    device.udid,
    bundleId,
    params.launchArgs || [],
    params.launchEnv || {},
  );

  const lines = [
    formatCommandResult(params.buildResult),
    '',
    `App: ${appPath}`,
    `Bundle ID: ${bundleId}`,
    `Device: ${device.name} (${device.udid}) — iOS ${device.osVersion}`,
    `Install: OK`,
    `Launch: ${launchResult.exitCode === 0 ? 'OK' : 'FAILED'}`,
  ];
  if (launchResult.output.trim()) {
    lines.push('', launchResult.output.trim());
  }
  const launchHint = launchResult.exitCode !== 0 ? formatDeviceError(launchResult.output) : undefined;
  if (launchHint) lines.push('', launchHint);

  return toolResult(lines.join('\n'), {
    build: 'ok',
    install: 'ok',
    launch: launchResult.exitCode === 0 ? 'ok' : 'failed',
    appPath,
    bundleId,
    deviceId: device.udid,
    deviceName: device.name,
  }, launchResult.exitCode !== 0);
}
