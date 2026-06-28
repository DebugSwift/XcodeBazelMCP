import { startMcpServer } from './server/index.js';
import { bazelToolDefinitions } from './tools/index.js';
import {
  parseDiscover, parseSimSelector, parseLongPress, parseSwipe, parsePinch, parseDrag,
  parseSimErase, parseSimShutdown, parseSimLocation, parseSimAppearance,
  parseBuildAndRun, parseInstall, parseLaunch, parseBuild, parseTest,
  parseQuery, parseDeps, parseRdeps, parseTargetInfo,
  parseStopApp, parseScreenshot, parseVideoStart, parseStatusBar,
  parsePrivacy, parsePush, parseLogStart, parseSetDefaults,
  parseScaffold, parseSpmPath, parseSpmBuild, parseSpmTest, parseSpmRun, parseSpmInit,
  parseMacosBuild, parseMacosRun, parseMacosTest, parseMacosDiscover,
  parsePlatformBuild, parsePlatformRun, parsePlatformTest, parsePlatformDiscover,
  parseLldbAttach, parseLldbBreakpoint, parseLldbVars, parseLldbThreads,
  parseDeviceSelector, parseDeviceBuildAndRun, parseDeviceInstall, parseDeviceLaunch,
  parseDeviceStop, parseDeviceTest, parseDeviceScreenshot,
  parseMacosLaunch, parseMacosStop, parseMacosInstall, parseMacosLog,
} from './cli/parsers.js';
import {
  printTool, runSkillInit, runUpgrade, runDaemon,
  runVideoRecord, runLogStream, runSetupWizard, runCheckUpdate,
} from './cli/commands.js';
import { printHelp } from './cli/help.js';

const argv = process.argv.slice(2);
const command = argv[0] || 'help';

switch (command) {
  case '-h':
  case '--help':
    printHelp();
    break;
  case 'version':
  case '--version':
  case '-v': {
    const { getCurrentVersion } = await import('./core/upgrade.js');
    console.log(getCurrentVersion());
    break;
  }
  case 'mcp':
    await startMcpServer();
    break;
  case 'tools':
    for (const tool of bazelToolDefinitions) {
      console.log(`${tool.name}\n  ${tool.description}`);
    }
    break;
  case 'doctor':
    await printTool('bazel_ios_health', {});
    break;
  case 'discover':
    await printTool('bazel_ios_discover_targets', parseDiscover(argv.slice(1)));
    break;
  case 'build':
    await printTool('bazel_ios_build', parseBuild(argv.slice(1)));
    break;
  case 'run':
    await printTool('bazel_ios_build_and_run', parseBuildAndRun(argv.slice(1)));
    break;
  case 'install':
    await printTool('bazel_ios_install_app', parseInstall(argv.slice(1)));
    break;
  case 'launch':
    await printTool('bazel_ios_launch_app', parseLaunch(argv.slice(1)));
    break;
  case 'test':
    await printTool('bazel_ios_test', parseTest(argv.slice(1)));
    break;
  case 'clean':
    await printTool('bazel_ios_clean', {
      expunge: argv.includes('--expunge'),
      streaming: argv.includes('--stream'),
    });
    break;
  case 'defaults':
    await printTool('bazel_ios_show_defaults', {});
    break;
  case 'set-defaults':
    await printTool('bazel_ios_set_defaults', parseSetDefaults(argv.slice(1)));
    break;
  case 'profiles':
    await printTool('bazel_ios_list_profiles', {});
    break;
  case 'query':
    await printTool('bazel_ios_query', parseQuery(argv.slice(1)));
    break;
  case 'simulators':
    await printTool('bazel_ios_list_simulators', { onlyBooted: argv.includes('--booted') });
    break;
  case 'sim-boot':
    await printTool('bazel_ios_boot_simulator', parseSimSelector(argv.slice(1)));
    break;
  case 'sim-shutdown':
    await printTool('bazel_ios_shutdown_simulator', parseSimShutdown(argv.slice(1)));
    break;
  case 'sim-erase':
    await printTool('bazel_ios_erase_simulator', parseSimErase(argv.slice(1)));
    break;
  case 'sim-location':
    await printTool('bazel_ios_set_simulator_location', parseSimLocation(argv.slice(1)));
    break;
  case 'sim-appearance':
    await printTool('bazel_ios_set_simulator_appearance', parseSimAppearance(argv.slice(1)));
    break;
  case 'sim-open':
    await printTool('bazel_ios_open_simulator', parseSimSelector(argv.slice(1)));
    break;
  case 'deps':
    await printTool('bazel_ios_deps', parseDeps(argv.slice(1)));
    break;
  case 'rdeps':
    await printTool('bazel_ios_rdeps', parseRdeps(argv.slice(1)));
    break;
  case 'coverage':
    await printTool('bazel_ios_test_coverage', parseTest(argv.slice(1)));
    break;
  case 'target-info':
    await printTool('bazel_ios_target_info', parseTargetInfo(argv.slice(1)));
    break;
  case 'bsp-status':
    await printTool('bazel_ios_bsp_status', { querySetupTargets: argv.includes('--query-targets') });
    break;
  case 'last-command':
    await printTool('bazel_ios_last_command', {});
    break;
  case 'command-log': {
    const { readRecentCommands, commandLogPath } = await import('./core/command-log.js');
    const limitIdx = argv.indexOf('--limit');
    const limit = limitIdx >= 0 ? Number(argv[limitIdx + 1]) || 20 : 20;
    const entries = readRecentCommands(limit);
    if (entries.length === 0) {
      console.log(`No commands logged yet. Log file: ${commandLogPath()}`);
    } else {
      console.log(`Recent commands (${entries.length}) — ${commandLogPath()}\n`);
      for (const e of entries) {
        const when = new Date(e.timestamp).toISOString();
        const status = e.exitCode === 0 ? 'OK' : `FAIL(${e.failureKind || e.exitCode})`;
        console.log(`${when}  [${e.id || '--------'}]  ${status}  ${(e.durationMs / 1000).toFixed(1)}s  ${e.argv.join(' ')}`);
      }
    }
    break;
  }
  case 'stop':
    await printTool('bazel_ios_stop_app', parseStopApp(argv.slice(1)));
    break;
  case 'uninstall':
    await printTool('bazel_ios_uninstall_app', parseStopApp(argv.slice(1)));
    break;
  case 'app-path':
    await printTool('bazel_ios_get_app_path', parseTargetInfo(argv.slice(1)));
    break;
  case 'bundle-id':
    await printTool('bazel_ios_get_bundle_id', { appPath: argv[1] });
    break;
  case 'screenshot':
    await printTool('bazel_ios_screenshot', parseScreenshot(argv.slice(1)));
    break;
  case 'video-start':
  case 'video-record':
    await runVideoRecord(parseVideoStart(argv.slice(1)));
    break;
  case 'video-stop':
    console.log('video-stop is only available in MCP server mode (video recordings are in-memory).');
    console.log('In CLI mode, use "video-record" which records until Ctrl+C.');
    break;
  case 'status-bar':
    await printTool('bazel_ios_set_status_bar', parseStatusBar(argv.slice(1)));
    break;
  case 'privacy':
    await printTool('bazel_ios_privacy', parsePrivacy(argv.slice(1)));
    break;
  case 'push':
    await printTool('bazel_ios_push_notification', parsePush(argv.slice(1)));
    break;
  case 'open-url':
    await printTool('bazel_ios_open_url', { url: argv[1], ...parseSimSelector(argv.slice(2)) });
    break;
  case 'ui-dump':
    await printTool('bazel_ios_ui_dump', parseSimSelector(argv.slice(1)));
    break;
  case 'add-media': {
    const mediaPaths = argv.slice(1).filter((a) => !a.startsWith('--'));
    await printTool('bazel_ios_add_media', { paths: mediaPaths, ...parseSimSelector(argv.slice(1)) });
    break;
  }
  case 'app-container':
    await printTool('bazel_ios_get_app_container', {
      bundleId: argv[1],
      kind: argv.includes('--kind') ? argv[argv.indexOf('--kind') + 1] : undefined,
      ...parseSimSelector(argv.slice(2)),
    });
    break;
  case 'tap':
    await printTool('bazel_ios_tap', { x: Number(argv[1]), y: Number(argv[2]), ...parseSimSelector(argv.slice(3)) });
    break;
  case 'double-tap':
    await printTool('bazel_ios_double_tap', { x: Number(argv[1]), y: Number(argv[2]), ...parseSimSelector(argv.slice(3)) });
    break;
  case 'long-press':
    await printTool('bazel_ios_long_press', parseLongPress(argv.slice(1)));
    break;
  case 'swipe':
    await printTool('bazel_ios_swipe', parseSwipe(argv.slice(1)));
    break;
  case 'pinch':
    await printTool('bazel_ios_pinch', parsePinch(argv.slice(1)));
    break;
  case 'type':
  case 'type-text':
    await printTool('bazel_ios_type_text', { text: argv[1], ...parseSimSelector(argv.slice(2)) });
    break;
  case 'key-press':
    await printTool('bazel_ios_key_press', { key: argv[1], ...parseSimSelector(argv.slice(2)) });
    break;
  case 'drag':
    await printTool('bazel_ios_drag', parseDrag(argv.slice(1)));
    break;
  case 'accessibility-snapshot':
  case 'a11y':
    await printTool('bazel_ios_accessibility_snapshot', parseSimSelector(argv.slice(1)));
    break;
  case 'devices':
    await printTool('bazel_ios_list_devices', { onlyConnected: !argv.includes('--all') });
    break;
  case 'device-run':
    await printTool('bazel_ios_device_build_and_run', parseDeviceBuildAndRun(argv.slice(1)));
    break;
  case 'device-install':
    await printTool('bazel_ios_device_install_app', parseDeviceInstall(argv.slice(1)));
    break;
  case 'device-launch':
    await printTool('bazel_ios_device_launch_app', parseDeviceLaunch(argv.slice(1)));
    break;
  case 'device-stop':
    await printTool('bazel_ios_device_stop_app', parseDeviceStop(argv.slice(1)));
    break;
  case 'device-uninstall':
    await printTool('bazel_ios_device_uninstall_app', parseDeviceStop(argv.slice(1)));
    break;
  case 'device-list-apps':
    await printTool('bazel_ios_device_list_apps', parseDeviceSelector(argv.slice(1)));
    break;
  case 'device-test':
    await printTool('bazel_ios_device_test', parseDeviceTest(argv.slice(1)));
    break;
  case 'device-screenshot':
    await printTool('bazel_ios_device_screenshot', parseDeviceScreenshot(argv.slice(1)));
    break;
  case 'device-app-path':
    await printTool('bazel_ios_device_get_app_path', parseTargetInfo(argv.slice(1)));
    break;
  case 'device-log-start':
    await printTool('bazel_ios_device_log_start', parseDeviceSelector(argv.slice(1)));
    break;
  case 'device-log-stop':
    await printTool('bazel_ios_device_log_stop', { captureId: argv[1] });
    break;
  case 'device-info':
    await printTool('bazel_ios_device_info', parseDeviceSelector(argv.slice(1)));
    break;
  case 'device-pair':
    await printTool('bazel_ios_device_pair', parseDeviceSelector(argv.slice(1)));
    break;
  case 'device-unpair':
    await printTool('bazel_ios_device_unpair', parseDeviceSelector(argv.slice(1)));
    break;
  case 'device-list-pairs':
    await printTool('bazel_ios_device_list_pairs', {});
    break;
  case 'macos-coverage':
    await printTool('bazel_macos_coverage', parsePlatformTest(argv.slice(1)));
    break;
  case 'macos-clean':
    await printTool('bazel_macos_clean', { expunge: argv.includes('--expunge') });
    break;
  case 'macos-launch':
    await printTool('bazel_macos_launch', parseMacosLaunch(argv.slice(1)));
    break;
  case 'macos-stop':
    await printTool('bazel_macos_stop', parseMacosStop(argv.slice(1)));
    break;
  case 'macos-install':
    await printTool('bazel_macos_install', parseMacosInstall(argv.slice(1)));
    break;
  case 'macos-app-path':
    await printTool('bazel_macos_app_path', { target: argv[1] });
    break;
  case 'macos-bundle-id':
    await printTool('bazel_macos_bundle_id', { appPath: argv[1] });
    break;
  case 'macos-log':
    await printTool('bazel_macos_log', parseMacosLog(argv.slice(1)));
    break;
  case 'macos-screenshot':
    await printTool('bazel_macos_screenshot', { outputPath: argv[1], windowOnly: argv.includes('--window') });
    break;
  case 'daemon':
    await runDaemon(argv.slice(1));
    break;
  case 'daemon-start':
    await printTool('bazel_daemon_start', {});
    break;
  case 'daemon-stop':
    await printTool('bazel_daemon_stop', {});
    break;
  case 'daemon-status':
    await printTool('bazel_daemon_status', {});
    break;
  case 'scaffold':
  case 'new':
    await printTool('bazel_scaffold', parseScaffold(argv.slice(1)));
    break;
  case 'scaffold-templates':
  case 'templates':
    await printTool('bazel_scaffold_list_templates', {});
    break;
  case 'spm-build':
  case 'swift-build':
    await printTool('swift_package_build', parseSpmBuild(argv.slice(1)));
    break;
  case 'spm-test':
  case 'swift-test':
    await printTool('swift_package_test', parseSpmTest(argv.slice(1)));
    break;
  case 'spm-run':
  case 'swift-run':
    await printTool('swift_package_run', parseSpmRun(argv.slice(1)));
    break;
  case 'spm-clean':
  case 'swift-clean':
    await printTool('swift_package_clean', parseSpmPath(argv.slice(1)));
    break;
  case 'spm-resolve':
  case 'swift-resolve':
    await printTool('swift_package_resolve', parseSpmPath(argv.slice(1)));
    break;
  case 'spm-dump':
  case 'swift-dump':
    await printTool('swift_package_dump', parseSpmPath(argv.slice(1)));
    break;
  case 'spm-init':
  case 'swift-init':
    await printTool('swift_package_init', parseSpmInit(argv.slice(1)));
    break;
  case 'macos-build':
    await printTool('bazel_macos_build', parseMacosBuild(argv.slice(1)));
    break;
  case 'macos-run':
    await printTool('bazel_macos_run', parseMacosRun(argv.slice(1)));
    break;
  case 'macos-test':
    await printTool('bazel_macos_test', parseMacosTest(argv.slice(1)));
    break;
  case 'macos-discover':
    await printTool('bazel_macos_discover_targets', parseMacosDiscover(argv.slice(1)));
    break;
  case 'tvos-build':
    await printTool('bazel_tvos_build', parsePlatformBuild(argv.slice(1)));
    break;
  case 'tvos-run':
    await printTool('bazel_tvos_run', parsePlatformRun(argv.slice(1)));
    break;
  case 'tvos-test':
    await printTool('bazel_tvos_test', parsePlatformTest(argv.slice(1)));
    break;
  case 'tvos-discover':
    await printTool('bazel_tvos_discover_targets', parsePlatformDiscover(argv.slice(1)));
    break;
  case 'watchos-build':
    await printTool('bazel_watchos_build', parsePlatformBuild(argv.slice(1)));
    break;
  case 'watchos-run':
    await printTool('bazel_watchos_run', parsePlatformRun(argv.slice(1)));
    break;
  case 'watchos-test':
    await printTool('bazel_watchos_test', parsePlatformTest(argv.slice(1)));
    break;
  case 'watchos-discover':
    await printTool('bazel_watchos_discover_targets', parsePlatformDiscover(argv.slice(1)));
    break;
  case 'visionos-build':
    await printTool('bazel_visionos_build', parsePlatformBuild(argv.slice(1)));
    break;
  case 'visionos-run':
    await printTool('bazel_visionos_run', parsePlatformRun(argv.slice(1)));
    break;
  case 'visionos-test':
    await printTool('bazel_visionos_test', parsePlatformTest(argv.slice(1)));
    break;
  case 'visionos-discover':
    await printTool('bazel_visionos_discover_targets', parsePlatformDiscover(argv.slice(1)));
    break;
  case 'lldb-attach':
    await printTool('bazel_ios_lldb_attach', parseLldbAttach(argv.slice(1)));
    break;
  case 'lldb-detach':
    await printTool('bazel_ios_lldb_detach', { sessionId: argv[1] });
    break;
  case 'lldb-break':
    await printTool('bazel_ios_lldb_breakpoint', parseLldbBreakpoint(argv.slice(1)));
    break;
  case 'lldb-bt':
    await printTool('bazel_ios_lldb_backtrace', { sessionId: argv[1] });
    break;
  case 'lldb-vars':
    await printTool('bazel_ios_lldb_variables', parseLldbVars(argv.slice(1)));
    break;
  case 'lldb-expr':
    await printTool('bazel_ios_lldb_expression', { sessionId: argv[1], expression: argv.slice(2).join(' ') });
    break;
  case 'lldb-step':
    await printTool('bazel_ios_lldb_step', { sessionId: argv[1], action: argv[2] || 'over' });
    break;
  case 'lldb-threads':
    await printTool('bazel_ios_lldb_threads', parseLldbThreads(argv.slice(1)));
    break;
  case 'lldb-cmd':
    await printTool('bazel_ios_lldb_command', { sessionId: argv[1], command: argv.slice(2).join(' ') });
    break;
  case 'lldb-sessions':
    await printTool('bazel_ios_lldb_sessions', {});
    break;
  case 'log-start':
    await runLogStream(parseLogStart(argv.slice(1)));
    break;
  case 'log-stop':
    console.log('log-stop is only available in MCP server mode (log captures are in-memory).');
    console.log('In CLI mode, use "log-start" which streams directly and stops on Ctrl+C.');
    break;
  case 'upgrade':
  case 'update':
  case 'self-update':
    await runUpgrade(argv.slice(1));
    break;
  case 'check-update':
    await runCheckUpdate(argv.includes('--exit-code'));
    break;
  case 'workflows':
    await printTool('bazel_list_workflows', {});
    break;
  case 'toggle-workflow':
    await printTool('bazel_toggle_workflow', { id: argv[1], enabled: argv[2] !== 'off' && argv[2] !== 'false' && argv[2] !== 'disable' });
    break;
  case 'xcode-mcp-status':
    await printTool('bazel_xcode_native_mcp_status', {});
    break;
  case 'devicehub':
  case 'device-hub':
    await printTool('bazel_xcode_open_device_hub', {});
    break;
  case 'xcode-export-skills':
    await printTool('bazel_xcode_export_skills', {
      outputDir: argv.includes('--output-dir') ? argv[argv.indexOf('--output-dir') + 1] : undefined,
      replaceExisting: argv.includes('--replace-existing'),
    });
    break;
  case 'setup':
    await runSetupWizard();
    break;
  case 'init':
    runSkillInit();
    break;
  default:
    printHelp();
}
