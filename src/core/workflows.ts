interface WorkflowInfo {
  id: string;
  name: string;
  description: string;
  tools: string[];
}

export const WORKFLOWS: WorkflowInfo[] = [
  {
    id: 'build',
    name: 'iOS Build',
    description: 'Build iOS targets for simulator or device.',
    tools: ['bazel_ios_build', 'bazel_ios_build_and_run'],
  },
  {
    id: 'test',
    name: 'iOS Test',
    description: 'Run and analyze iOS tests with optional coverage.',
    tools: ['bazel_ios_test', 'bazel_ios_test_coverage'],
  },
  {
    id: 'simulator',
    name: 'Simulator Management',
    description: 'List, boot, shutdown, erase simulators and control location/appearance.',
    tools: [
      'bazel_ios_list_simulators', 'bazel_ios_boot_simulator',
      'bazel_ios_shutdown_simulator', 'bazel_ios_erase_simulator',
      'bazel_ios_set_simulator_location', 'bazel_ios_set_simulator_appearance',
      'bazel_ios_open_simulator', 'bazel_ios_set_status_bar',
      'bazel_ios_privacy', 'bazel_ios_ui_dump',
    ],
  },
  {
    id: 'app_lifecycle',
    name: 'App Lifecycle',
    description: 'Install, launch, and stop apps on simulator.',
    tools: [
      'bazel_ios_install_app', 'bazel_ios_launch_app', 'bazel_ios_stop_app',
      'bazel_ios_get_app_path', 'bazel_ios_get_bundle_id',
    ],
  },
  {
    id: 'capture',
    name: 'Capture & Recording',
    description: 'Screenshot, video recording, and log capture on simulator.',
    tools: [
      'bazel_ios_screenshot', 'bazel_ios_video_record_start',
      'bazel_ios_video_record_stop', 'bazel_ios_log_capture_start',
      'bazel_ios_log_capture_stop',
    ],
  },
  {
    id: 'agent_debug',
    name: 'Agent Debug (Cursor)',
    description: 'NDJSON agent debug logs: clear, read, pull from simulator, one-shot repro.',
    tools: [
      'bazel_ios_agent_debug_log_clear',
      'bazel_ios_agent_debug_log_read',
      'bazel_ios_agent_debug_log_pull',
      'bazel_ios_agent_debug_repro',
    ],
  },
  {
    id: 'ui_automation',
    name: 'UI Automation',
    description: 'Tap, swipe, type, drag, and inspect accessibility tree on simulator.',
    tools: [
      'bazel_ios_tap', 'bazel_ios_double_tap', 'bazel_ios_long_press',
      'bazel_ios_swipe', 'bazel_ios_pinch', 'bazel_ios_type_text',
      'bazel_ios_key_press', 'bazel_ios_drag', 'bazel_ios_accessibility_snapshot',
    ],
  },
  {
    id: 'deep_links',
    name: 'Deep Links & Push',
    description: 'Open URLs and send push notifications on simulator.',
    tools: ['bazel_ios_open_url', 'bazel_ios_push_notification'],
  },
  {
    id: 'device',
    name: 'Physical Device',
    description: 'Build, install, launch, test, and manage physical iOS devices.',
    tools: [
      'bazel_ios_list_devices', 'bazel_ios_device_build_and_run',
      'bazel_ios_device_install_app', 'bazel_ios_device_launch_app',
      'bazel_ios_device_stop_app', 'bazel_ios_device_test',
      'bazel_ios_device_screenshot', 'bazel_ios_device_log_start',
      'bazel_ios_device_log_stop', 'bazel_ios_device_info',
      'bazel_ios_device_pair', 'bazel_ios_device_unpair',
      'bazel_ios_device_list_pairs',
    ],
  },
  {
    id: 'lldb',
    name: 'LLDB Debugging',
    description: 'Attach debugger, set breakpoints, inspect variables, step through code.',
    tools: [
      'bazel_ios_lldb_attach', 'bazel_ios_lldb_detach',
      'bazel_ios_lldb_breakpoint', 'bazel_ios_lldb_backtrace',
      'bazel_ios_lldb_variables', 'bazel_ios_lldb_expression',
      'bazel_ios_lldb_step', 'bazel_ios_lldb_threads',
      'bazel_ios_lldb_command', 'bazel_ios_lldb_sessions',
    ],
  },
  {
    id: 'macos',
    name: 'macOS',
    description: 'Build, run, test, and manage macOS targets.',
    tools: [
      'bazel_macos_build', 'bazel_macos_run', 'bazel_macos_test',
      'bazel_macos_discover_targets', 'bazel_macos_coverage',
      'bazel_macos_clean', 'bazel_macos_launch', 'bazel_macos_stop',
      'bazel_macos_install', 'bazel_macos_app_path',
      'bazel_macos_bundle_id', 'bazel_macos_log', 'bazel_macos_screenshot',
    ],
  },
  {
    id: 'tvos',
    name: 'tvOS',
    description: 'Build, run, test, and discover tvOS targets.',
    tools: [
      'bazel_tvos_build', 'bazel_tvos_run',
      'bazel_tvos_test', 'bazel_tvos_discover_targets',
    ],
  },
  {
    id: 'watchos',
    name: 'watchOS',
    description: 'Build, run, test, and discover watchOS targets.',
    tools: [
      'bazel_watchos_build', 'bazel_watchos_run',
      'bazel_watchos_test', 'bazel_watchos_discover_targets',
    ],
  },
  {
    id: 'visionos',
    name: 'visionOS',
    description: 'Build, run, test, and discover visionOS targets.',
    tools: [
      'bazel_visionos_build', 'bazel_visionos_run',
      'bazel_visionos_test', 'bazel_visionos_discover_targets',
    ],
  },
  {
    id: 'spm',
    name: 'Swift Package Manager',
    description: 'Build, test, run, clean, and inspect Swift packages.',
    tools: [
      'swift_package_build', 'swift_package_test', 'swift_package_run',
      'swift_package_clean', 'swift_package_resolve', 'swift_package_dump',
      'swift_package_init',
    ],
  },
  {
    id: 'project',
    name: 'Project Discovery & Query',
    description: 'Discover targets, query the build graph, inspect dependencies.',
    tools: [
      'bazel_ios_discover_targets', 'bazel_ios_query',
      'bazel_ios_target_info', 'bazel_ios_deps', 'bazel_ios_rdeps',
      'bazel_ios_bsp_status',
    ],
  },
  {
    id: 'scaffold',
    name: 'Project Scaffolding',
    description: 'Generate new Bazel projects from templates.',
    tools: ['bazel_scaffold', 'bazel_scaffold_list_templates'],
  },
  {
    id: 'session',
    name: 'Session & Config',
    description: 'Workspace management, defaults, profiles, health checks.',
    tools: [
      'bazel_ios_set_workspace', 'bazel_ios_health',
      'bazel_ios_set_defaults', 'bazel_ios_show_defaults',
      'bazel_ios_list_profiles', 'bazel_ios_last_command',
      'bazel_ios_clean',
    ],
  },
  {
    id: 'daemon',
    name: 'Per-workspace Daemon',
    description: 'Background daemon for stateful operations.',
    tools: ['bazel_daemon_start', 'bazel_daemon_stop', 'bazel_daemon_status'],
  },
  {
    id: 'update',
    name: 'Self-update',
    description: 'Check for and install updates.',
    tools: ['bazel_check_update', 'bazel_upgrade'],
  },
];

const ALL_WORKFLOW_IDS = new Set(WORKFLOWS.map((w) => w.id));

export const DEFAULT_WORKFLOWS = [
  'build', 'test', 'simulator', 'app_lifecycle', 'project', 'session', 'agent_debug',
];

export function validateWorkflowIds(ids: string[]): string[] {
  const invalid = ids.filter((id) => !ALL_WORKFLOW_IDS.has(id));
  if (invalid.length > 0) {
    throw new Error(`Unknown workflow IDs: ${invalid.join(', ')}. Valid: ${[...ALL_WORKFLOW_IDS].join(', ')}`);
  }
  return ids;
}

export function getEnabledToolNames(enabledWorkflows?: string[]): Set<string> | null {
  if (!enabledWorkflows || enabledWorkflows.length === 0) return null;
  if (enabledWorkflows.includes('all')) return null;
  const enabled = new Set<string>();
  for (const wf of WORKFLOWS) {
    if (enabledWorkflows.includes(wf.id)) {
      for (const tool of wf.tools) enabled.add(tool);
    }
  }
  enabled.add('bazel_list_workflows');
  enabled.add('bazel_toggle_workflow');
  enabled.add('bazel_ios_set_workspace');
  enabled.add('bazel_ios_show_defaults');
  return enabled;
}

export function compactToolSchema(tool: { name: string; description: string; inputSchema: Record<string, unknown> }): {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
} {
  const schema = { ...tool.inputSchema };
  if (schema.properties && typeof schema.properties === 'object') {
    const compact: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(schema.properties as Record<string, Record<string, unknown>>)) {
      const rest = Object.fromEntries(Object.entries(val).filter(([k]) => k !== 'description'));
      compact[key] = rest;
    }
    schema.properties = compact;
  }
  return { name: tool.name, description: tool.description, inputSchema: schema };
}
