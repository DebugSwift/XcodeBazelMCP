import { afterEach, describe, expect, it } from 'vitest';
import { bazelToolDefinitions, callBazelTool } from './bazel-tools.js';
import { clearDefaults, setDefaults, setEnabledWorkflows } from '../runtime/config.js';
import { extractText } from '../cli/commands.js';

describe('Bazel MCP tool definitions', () => {
  it('registers every public Bazel iOS tool exactly once', () => {
    const names = bazelToolDefinitions.map((tool) => tool.name);
    const expected = [
      'bazel_ios_set_workspace',
      'bazel_ios_health',
      'bazel_ios_discover_targets',
      'bazel_ios_build',
      'bazel_ios_build_and_run',
      'bazel_ios_install_app',
      'bazel_ios_launch_app',
      'bazel_ios_test',
      'bazel_ios_query',
      'bazel_ios_target_info',
      'bazel_ios_list_simulators',
      'bazel_ios_boot_simulator',
      'bazel_ios_shutdown_simulator',
      'bazel_ios_erase_simulator',
      'bazel_ios_set_simulator_location',
      'bazel_ios_set_simulator_appearance',
      'bazel_ios_open_simulator',
      'bazel_ios_set_defaults',
      'bazel_ios_show_defaults',
      'bazel_ios_list_profiles',
      'bazel_ios_clean',
      'bazel_ios_deps',
      'bazel_ios_rdeps',
      'bazel_ios_test_coverage',
      'bazel_ios_log_capture_start',
      'bazel_ios_log_capture_stop',
      'bazel_ios_agent_debug_log_clear',
      'bazel_ios_agent_debug_log_read',
      'bazel_ios_agent_debug_log_pull',
      'bazel_ios_agent_debug_repro',
      'bazel_ios_last_command',
      'bazel_ios_bsp_status',
      'bazel_ios_stop_app',
      'bazel_ios_get_app_path',
      'bazel_ios_get_bundle_id',
      'bazel_ios_screenshot',
      'bazel_ios_video_record_start',
      'bazel_ios_video_record_stop',
      'bazel_ios_set_status_bar',
      'bazel_ios_privacy',
      'bazel_ios_push_notification',
      'bazel_ios_open_url',
      'bazel_ios_ui_dump',
      'bazel_ios_list_devices',
      'bazel_ios_device_build_and_run',
      'bazel_ios_device_install_app',
      'bazel_ios_device_launch_app',
      'bazel_ios_device_stop_app',
      'bazel_ios_device_test',
      'bazel_ios_device_screenshot',
      'bazel_ios_device_log_start',
      'bazel_ios_device_log_stop',
      'bazel_ios_device_info',
      'bazel_ios_device_pair',
      'bazel_ios_device_unpair',
      'bazel_ios_device_list_pairs',
      'bazel_ios_lldb_attach',
      'bazel_ios_lldb_detach',
      'bazel_ios_lldb_breakpoint',
      'bazel_ios_lldb_backtrace',
      'bazel_ios_lldb_variables',
      'bazel_ios_lldb_expression',
      'bazel_ios_lldb_step',
      'bazel_ios_lldb_threads',
      'bazel_ios_lldb_command',
      'bazel_ios_lldb_sessions',
      'bazel_macos_build',
      'bazel_macos_run',
      'bazel_macos_test',
      'bazel_macos_discover_targets',
      'bazel_macos_coverage',
      'bazel_macos_clean',
      'bazel_macos_launch',
      'bazel_macos_stop',
      'bazel_macos_install',
      'bazel_macos_app_path',
      'bazel_macos_bundle_id',
      'bazel_macos_log',
      'bazel_macos_screenshot',
      'bazel_tvos_build',
      'bazel_tvos_test',
      'bazel_tvos_run',
      'bazel_tvos_discover_targets',
      'bazel_watchos_build',
      'bazel_watchos_test',
      'bazel_watchos_run',
      'bazel_watchos_discover_targets',
      'bazel_visionos_build',
      'bazel_visionos_test',
      'bazel_visionos_run',
      'bazel_visionos_discover_targets',
      'swift_package_build',
      'swift_package_test',
      'swift_package_run',
      'swift_package_clean',
      'swift_package_resolve',
      'swift_package_dump',
      'swift_package_init',
      'bazel_scaffold',
      'bazel_scaffold_list_templates',
      'bazel_daemon_start',
      'bazel_daemon_stop',
      'bazel_daemon_status',
      'bazel_check_update',
      'bazel_upgrade',
      'bazel_list_workflows',
      'bazel_toggle_workflow',
      'bazel_ios_tap',
      'bazel_ios_double_tap',
      'bazel_ios_long_press',
      'bazel_ios_swipe',
      'bazel_ios_pinch',
      'bazel_ios_type_text',
      'bazel_ios_key_press',
      'bazel_ios_drag',
      'bazel_ios_accessibility_snapshot',
    ];
    expect([...names].sort()).toEqual([...expected].sort());
    expect(new Set(names).size).toBe(names.length);
    expect(bazelToolDefinitions.length).toBe(116);
  });

  it('advertises startupArgs on every Bazel command tool that can need startup flags', () => {
    for (const toolName of [
      'bazel_ios_discover_targets',
      'bazel_ios_build',
      'bazel_ios_build_and_run',
      'bazel_ios_test',
      'bazel_ios_query',
      'bazel_ios_target_info',
      'bazel_ios_clean',
      'bazel_ios_deps',
      'bazel_ios_rdeps',
      'bazel_ios_test_coverage',
      'bazel_ios_bsp_status',
      'bazel_macos_build',
      'bazel_macos_run',
      'bazel_macos_test',
      'bazel_macos_discover_targets',
      'bazel_macos_coverage',
      'bazel_macos_clean',
      'bazel_ios_device_test',
      'bazel_tvos_build',
      'bazel_tvos_run',
      'bazel_tvos_test',
      'bazel_tvos_discover_targets',
      'bazel_watchos_build',
      'bazel_watchos_run',
      'bazel_watchos_test',
      'bazel_watchos_discover_targets',
      'bazel_visionos_build',
      'bazel_visionos_run',
      'bazel_visionos_test',
      'bazel_visionos_discover_targets',
    ]) {
      const tool = bazelToolDefinitions.find((definition) => definition.name === toolName);
      const properties = tool?.inputSchema.properties as Record<string, unknown> | undefined;

      const startupArgs = properties?.startupArgs as Record<string, unknown> | undefined;

      expect(startupArgs?.type, `${toolName} should expose startupArgs as an array`).toBe('array');
      expect(startupArgs?.items, `${toolName} should expose string startupArgs`).toEqual({
        type: 'string',
      });
    }
  });

  it('marks required arguments in public schemas', () => {
    expect(findTool('bazel_ios_set_workspace').inputSchema.required).toEqual(['workspacePath']);
    expect(findTool('bazel_ios_build').inputSchema.required).toEqual(['target']);
    expect(findTool('bazel_ios_build_and_run').inputSchema.required).toEqual(['target']);
    expect(findTool('bazel_ios_install_app').inputSchema.required).toEqual(['appPath']);
    expect(findTool('bazel_ios_launch_app').inputSchema.required).toEqual(['bundleId']);
    expect(findTool('bazel_ios_test').inputSchema.required).toEqual(['target']);
    expect(findTool('bazel_ios_query').inputSchema.required).toEqual(['expression']);
    expect(findTool('bazel_ios_target_info').inputSchema.required).toEqual(['target']);
    expect(findTool('bazel_ios_erase_simulator').inputSchema.required).toEqual(['simulatorId']);
    expect(findTool('bazel_ios_set_simulator_location').inputSchema.required).toEqual(['latitude', 'longitude']);
    expect(findTool('bazel_ios_set_simulator_appearance').inputSchema.required).toEqual(['appearance']);
    expect(findTool('bazel_ios_deps').inputSchema.required).toEqual(['target']);
    expect(findTool('bazel_ios_rdeps').inputSchema.required).toEqual(['target']);
    expect(findTool('bazel_ios_test_coverage').inputSchema.required).toEqual(['target']);
    expect(findTool('bazel_ios_log_capture_stop').inputSchema.required).toEqual(['captureId']);
    expect(findTool('bazel_ios_stop_app').inputSchema.required).toEqual(['bundleId']);
    expect(findTool('bazel_ios_get_app_path').inputSchema.required).toEqual(['target']);
    expect(findTool('bazel_ios_get_bundle_id').inputSchema.required).toEqual(['appPath']);
    expect(findTool('bazel_ios_screenshot').inputSchema.required).toEqual(['outputPath']);
    expect(findTool('bazel_ios_video_record_start').inputSchema.required).toEqual(['outputPath']);
    expect(findTool('bazel_ios_video_record_stop').inputSchema.required).toEqual(['recordingId']);
    expect(findTool('bazel_ios_privacy').inputSchema.required).toEqual(['action', 'service']);
    expect(findTool('bazel_ios_push_notification').inputSchema.required).toEqual(['bundleId']);
    expect(findTool('bazel_ios_open_url').inputSchema.required).toEqual(['url']);
    expect(findTool('bazel_ios_device_build_and_run').inputSchema.required).toEqual(['target']);
    expect(findTool('bazel_ios_device_install_app').inputSchema.required).toEqual(['appPath']);
    expect(findTool('bazel_ios_device_launch_app').inputSchema.required).toEqual(['bundleId']);
    expect(findTool('bazel_ios_device_stop_app').inputSchema.required).toEqual(['bundleId']);
    expect(findTool('bazel_ios_device_test').inputSchema.required).toEqual(['target']);
    expect(findTool('bazel_ios_device_screenshot').inputSchema.required).toEqual(['outputPath']);
    expect(findTool('bazel_ios_device_log_stop').inputSchema.required).toEqual(['captureId']);
    expect(findTool('bazel_macos_coverage').inputSchema.required).toEqual(['target']);
    expect(findTool('bazel_macos_app_path').inputSchema.required).toEqual(['target']);
    expect(findTool('bazel_macos_bundle_id').inputSchema.required).toEqual(['appPath']);
    expect(findTool('bazel_macos_screenshot').inputSchema.required).toEqual(['outputPath']);
    expect(findTool('bazel_toggle_workflow').inputSchema.required).toEqual(['id', 'enabled']);
    expect(findTool('bazel_ios_lldb_detach').inputSchema.required).toEqual(['sessionId']);
    expect(findTool('bazel_ios_lldb_breakpoint').inputSchema.required).toEqual(['sessionId', 'action']);
    expect(findTool('bazel_ios_lldb_backtrace').inputSchema.required).toEqual(['sessionId']);
    expect(findTool('bazel_ios_lldb_variables').inputSchema.required).toEqual(['sessionId']);
    expect(findTool('bazel_ios_lldb_expression').inputSchema.required).toEqual(['sessionId', 'expression']);
    expect(findTool('bazel_ios_lldb_step').inputSchema.required).toEqual(['sessionId', 'action']);
    expect(findTool('bazel_ios_lldb_threads').inputSchema.required).toEqual(['sessionId']);
    expect(findTool('bazel_ios_lldb_command').inputSchema.required).toEqual(['sessionId', 'command']);
    expect(findTool('bazel_macos_build').inputSchema.required).toEqual(['target']);
    expect(findTool('bazel_macos_run').inputSchema.required).toEqual(['target']);
    expect(findTool('bazel_macos_test').inputSchema.required).toEqual(['target']);
    expect(findTool('bazel_scaffold').inputSchema.required).toEqual(['outputPath', 'name', 'template']);
    expect(findTool('bazel_ios_tap').inputSchema.required).toEqual(['x', 'y']);
    expect(findTool('bazel_ios_double_tap').inputSchema.required).toEqual(['x', 'y']);
    expect(findTool('bazel_ios_long_press').inputSchema.required).toEqual(['x', 'y']);
    expect(findTool('bazel_ios_swipe').inputSchema.required).toEqual(['direction']);
    expect(findTool('bazel_ios_pinch').inputSchema.required).toEqual(['x', 'y', 'scale']);
    expect(findTool('bazel_ios_type_text').inputSchema.required).toEqual(['text']);
    expect(findTool('bazel_ios_key_press').inputSchema.required).toEqual(['key']);
    expect(findTool('bazel_ios_drag').inputSchema.required).toEqual(['fromX', 'fromY', 'toX', 'toY']);
    expect(findTool('bazel_tvos_build').inputSchema.required).toEqual(['target']);
    expect(findTool('bazel_tvos_test').inputSchema.required).toEqual(['target']);
    expect(findTool('bazel_tvos_run').inputSchema.required).toEqual(['target']);
    expect(findTool('bazel_watchos_build').inputSchema.required).toEqual(['target']);
    expect(findTool('bazel_watchos_test').inputSchema.required).toEqual(['target']);
    expect(findTool('bazel_watchos_run').inputSchema.required).toEqual(['target']);
    expect(findTool('bazel_visionos_build').inputSchema.required).toEqual(['target']);
    expect(findTool('bazel_visionos_test').inputSchema.required).toEqual(['target']);
    expect(findTool('bazel_visionos_run').inputSchema.required).toEqual(['target']);
  });

  it('exposes deviceId on device interaction tools', () => {
    for (const toolName of [
      'bazel_ios_device_build_and_run',
      'bazel_ios_device_install_app',
      'bazel_ios_device_launch_app',
      'bazel_ios_device_stop_app',
      'bazel_ios_device_test',
      'bazel_ios_device_screenshot',
      'bazel_ios_device_log_start',
      'bazel_ios_device_info',
      'bazel_ios_device_pair',
      'bazel_ios_device_unpair',
    ]) {
      const tool = findTool(toolName);
      const properties = tool.inputSchema.properties as Record<string, unknown>;
      expect(properties.deviceId, `${toolName} should expose deviceId`).toBeDefined();
    }
  });

  it('exposes sessionId on LLDB tools that require it', () => {
    for (const toolName of [
      'bazel_ios_lldb_detach',
      'bazel_ios_lldb_breakpoint',
      'bazel_ios_lldb_backtrace',
      'bazel_ios_lldb_variables',
      'bazel_ios_lldb_expression',
      'bazel_ios_lldb_step',
      'bazel_ios_lldb_threads',
      'bazel_ios_lldb_command',
    ]) {
      const tool = findTool(toolName);
      const properties = tool.inputSchema.properties as Record<string, unknown>;
      expect(properties.sessionId, `${toolName} should expose sessionId`).toBeDefined();
    }
  });

  it('exposes launchArgs on build-and-run and launch tools', () => {
    for (const toolName of ['bazel_ios_build_and_run', 'bazel_ios_launch_app']) {
      const tool = findTool(toolName);
      const properties = tool.inputSchema.properties as Record<string, unknown>;
      const launchArgs = properties.launchArgs as Record<string, unknown>;
      expect(launchArgs?.type, `${toolName} should expose launchArgs`).toBe('array');
    }
  });

  it('exposes simulatorId on simulator interaction tools', () => {
    for (const toolName of [
      'bazel_ios_build_and_run',
      'bazel_ios_install_app',
      'bazel_ios_launch_app',
      'bazel_ios_stop_app',
      'bazel_ios_screenshot',
      'bazel_ios_video_record_start',
      'bazel_ios_set_status_bar',
      'bazel_ios_privacy',
      'bazel_ios_push_notification',
      'bazel_ios_open_url',
      'bazel_ios_ui_dump',
    ]) {
      const tool = findTool(toolName);
      const properties = tool.inputSchema.properties as Record<string, unknown>;
      expect(properties.simulatorId, `${toolName} should expose simulatorId`).toBeDefined();
    }
  });

  it('exposes streaming flag on long-running Bazel command tools', () => {
    for (const toolName of [
      'bazel_ios_build',
      'bazel_ios_build_and_run',
      'bazel_ios_device_build_and_run',
      'bazel_ios_device_test',
      'bazel_ios_test',
      'bazel_ios_clean',
      'bazel_macos_build',
      'bazel_macos_run',
      'bazel_macos_test',
      'bazel_tvos_build',
      'bazel_tvos_run',
      'bazel_tvos_test',
      'bazel_watchos_build',
      'bazel_watchos_run',
      'bazel_watchos_test',
      'bazel_visionos_build',
      'bazel_visionos_run',
      'bazel_visionos_test',
      'swift_package_build',
      'swift_package_test',
    ]) {
      const tool = findTool(toolName);
      const properties = tool.inputSchema.properties as Record<string, unknown>;
      const streaming = properties.streaming as Record<string, unknown>;
      expect(streaming?.type, `${toolName} should expose streaming flag`).toBe('boolean');
      expect(streaming?.default, `${toolName} streaming should default to false`).toBe(false);
    }
  });

  it('exposes packagePath on all Swift Package tools', () => {
    for (const toolName of [
      'swift_package_build',
      'swift_package_test',
      'swift_package_run',
      'swift_package_clean',
      'swift_package_resolve',
      'swift_package_dump',
      'swift_package_init',
    ]) {
      const tool = findTool(toolName);
      const properties = tool.inputSchema.properties as Record<string, unknown>;
      expect(properties.packagePath, `${toolName} should expose packagePath`).toBeDefined();
    }
  });

  it('exposes runArgs on swift_package_run', () => {
    const tool = findTool('swift_package_run');
    const properties = tool.inputSchema.properties as Record<string, unknown>;
    const runArgs = properties.runArgs as Record<string, unknown>;
    expect(runArgs?.type).toBe('array');
  });

  it('rejects unknown tool names before doing work', async () => {
    await expect(callBazelTool('does_not_exist', {})).rejects.toThrow('Unknown tool: does_not_exist');
  });
});

describe('Session defaults integration', () => {
  afterEach(() => clearDefaults());

  it('merges session default target into show_defaults output', async () => {
    setDefaults({ target: '//:DefaultApp', simulatorName: 'iPhone 16 Pro' });
    const result = await callBazelTool('bazel_ios_show_defaults', {});
    const text = result.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    expect(text).toContain('//:DefaultApp');
    expect(text).toContain('iPhone 16 Pro');
  });

  it('does not override explicitly provided args', async () => {
    setDefaults({ target: '//:DefaultApp' });
    const result = await callBazelTool('bazel_ios_show_defaults', {});
    const text = result.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    expect(text).toContain('//:DefaultApp');
  });

  it('clear removes all defaults', async () => {
    setDefaults({ target: '//:DefaultApp', buildMode: 'debug' });
    clearDefaults();
    const result = await callBazelTool('bazel_ios_show_defaults', {});
    const text = result.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    expect(text).toContain('No session defaults set.');
  });
});

describe('Workflow tools', () => {
  afterEach(() => {
    clearDefaults();
    setEnabledWorkflows(undefined);
  });

  it('bazel_list_workflows returns all workflow categories', async () => {
    const result = await callBazelTool('bazel_list_workflows', {});
    const text = extractText(result);
    expect(text).toContain('build');
    expect(text).toContain('test');
    expect(text).toContain('simulator');
    expect(text).toContain('session');
  });

  it('bazel_toggle_workflow enables a workflow', async () => {
    const result = await callBazelTool('bazel_toggle_workflow', { id: 'all', enabled: true });
    const text = extractText(result);
    expect(text).toContain('All workflows enabled');
  });

  it('bazel_toggle_workflow disables a workflow', async () => {
    const result = await callBazelTool('bazel_toggle_workflow', { id: 'device', enabled: false });
    const text = extractText(result);
    expect(text).toContain('disabled');
  });

  it('bazel_toggle_workflow rejects unknown id', async () => {
    await expect(callBazelTool('bazel_toggle_workflow', { id: 'nonexistent', enabled: true }))
      .rejects.toThrow('Unknown workflow');
  });

  it('bazel_toggle_workflow requires boolean enabled', async () => {
    await expect(callBazelTool('bazel_toggle_workflow', { id: 'build', enabled: 'yes' }))
      .rejects.toThrow('enabled must be a boolean');
  });
});

describe('Set defaults tool', () => {
  afterEach(() => clearDefaults());

  it('bazel_ios_set_defaults sets and shows target', async () => {
    const result = await callBazelTool('bazel_ios_set_defaults', { target: '//:App' });
    const text = extractText(result);
    expect(text).toContain('target: //:App');
  });

  it('bazel_ios_set_defaults clear works', async () => {
    setDefaults({ target: '//:App' });
    const result = await callBazelTool('bazel_ios_set_defaults', { clear: true });
    const text = extractText(result);
    expect(text).toContain('cleared');
  });

  it('bazel_ios_list_profiles returns empty when no profiles', async () => {
    const result = await callBazelTool('bazel_ios_list_profiles', {});
    const text = extractText(result);
    expect(text).toContain('No profiles configured');
  });

  it('bazel_ios_agent_debug_log_clear and read round-trip', async () => {
    const { mkdtempSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'xbmcp-adbg-'));
    const logPath = join(dir, 'debug.log');

    const clearResult = await callBazelTool('bazel_ios_agent_debug_log_clear', { logPath });
    expect(clearResult.isError).toBeFalsy();
    expect(existsSync(logPath)).toBe(false);

    const { writeFileSync } = await import('node:fs');
    writeFileSync(logPath, '{"hypothesisId":"H1","message":"ok"}\n');

    const readResult = await callBazelTool('bazel_ios_agent_debug_log_read', { logPath, hypothesisId: 'H1' });
    const parsed = JSON.parse(extractText(readResult));
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.hypothesisStatusHints.H1).toBe('UNKNOWN');
  });

  it('bazel_ios_last_command returns no command initially', async () => {
    const result = await callBazelTool('bazel_ios_last_command', {});
    const text = extractText(result);
    expect(text).toContain('No command has run yet');
  });

  it('bazel_scaffold_list_templates returns templates', async () => {
    const result = await callBazelTool('bazel_scaffold_list_templates', {});
    const text = extractText(result);
    expect(text).toContain('ios_app');
    expect(text).toContain('macos_app');
  });

  it('bazel_ios_lldb_sessions returns empty list', async () => {
    const result = await callBazelTool('bazel_ios_lldb_sessions', {});
    const text = extractText(result);
    expect(text).toContain('No active');
  });

  it('bazel_check_update returns version info', async () => {
    const result = await callBazelTool('bazel_check_update', {});
    const text = extractText(result);
    expect(text).toMatch(/\d+\.\d+\.\d+/);
  });
});

function findTool(name: string) {
  const tool = bazelToolDefinitions.find((definition) => definition.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool;
}
