import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Default toolchain/dependency pins for generated projects (centralized so they're easy to bump). */
const DEFAULT_BAZEL_VERSION = '7.6.1';
const DEFAULT_RULES_APPLE_VERSION = '3.16.1';
const RULES_SWIFT_VERSION = '2.6.0';
const APPLE_SUPPORT_VERSION = '1.21.1';

export type ScaffoldTemplate =
  | 'ios_app'
  | 'ios_test'
  | 'ios_app_with_tests'
  | 'macos_app'
  | 'macos_test'
  | 'macos_app_with_tests';

export interface ScaffoldOptions {
  outputPath: string;
  name: string;
  template: ScaffoldTemplate;
  bundleId?: string;
  minimumOs?: string;
  rulesVersion?: string;
  bazelVersion?: string;
  /** iOS device families for ios_application (default: iphone + ipad). */
  families?: string[];
}

export interface ScaffoldResult {
  filesCreated: string[];
  outputPath: string;
  template: ScaffoldTemplate;
}

export function getAvailableTemplates(): Array<{ id: ScaffoldTemplate; description: string }> {
  return [
    { id: 'ios_app', description: 'Minimal Bazel iOS application (SwiftUI)' },
    { id: 'ios_test', description: 'Bazel iOS unit test target' },
    { id: 'ios_app_with_tests', description: 'Bazel iOS application with unit test target' },
    { id: 'macos_app', description: 'Minimal Bazel macOS application (SwiftUI)' },
    { id: 'macos_test', description: 'Bazel macOS unit test target' },
    { id: 'macos_app_with_tests', description: 'Bazel macOS application with unit test target' },
  ];
}

export function scaffold(options: ScaffoldOptions): ScaffoldResult {
  const { outputPath, name, template } = options;

  if (!name || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) {
    throw new Error(`Invalid project name "${name}". Use alphanumeric characters, hyphens, and underscores only.`);
  }

  const validTemplates = getAvailableTemplates().map((t) => t.id);
  if (!validTemplates.includes(template)) {
    throw new Error(`Unknown template "${template}". Available: ${validTemplates.join(', ')}`);
  }

  const bundleId = options.bundleId || `com.example.${name}`;
  if (!/^[A-Za-z0-9.-]+$/.test(bundleId)) {
    throw new Error(`Invalid bundleId "${bundleId}". Use reverse-DNS style: letters, numbers, dots, and hyphens only.`);
  }
  const minimumOs = options.minimumOs || (template.startsWith('macos') ? '14.0' : '17.0');
  if (!/^\d+(\.\d+){0,2}$/.test(minimumOs)) {
    throw new Error(`Invalid minimumOs "${minimumOs}". Use a version like 17.0.`);
  }
  if (options.rulesVersion !== undefined && !/^\d+(\.\d+){0,2}$/.test(options.rulesVersion)) {
    throw new Error(`Invalid rulesVersion "${options.rulesVersion}". Use a version like 3.16.1.`);
  }
  const bazelVersion = options.bazelVersion || DEFAULT_BAZEL_VERSION;
  if (!/^\d+(\.\d+){0,2}$/.test(bazelVersion)) {
    throw new Error(`Invalid bazelVersion "${bazelVersion}". Use a version like 7.6.1.`);
  }
  const families = options.families && options.families.length > 0 ? options.families : ['iphone', 'ipad'];
  const validFamilies = ['iphone', 'ipad'];
  for (const f of families) {
    if (!validFamilies.includes(f)) throw new Error(`Invalid family "${f}". Allowed: ${validFamilies.join(', ')}.`);
  }

  if (existsSync(join(outputPath, 'MODULE.bazel')) || existsSync(join(outputPath, 'WORKSPACE'))) {
    throw new Error(`A Bazel workspace already exists in ${outputPath}. Aborting to avoid overwriting.`);
  }

  const filesCreated: string[] = [];
  const write = (relPath: string, content: string) => {
    const fullPath = join(outputPath, relPath);
    const dir = join(outputPath, relPath.split('/').slice(0, -1).join('/'));
    if (dir !== outputPath && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(fullPath, content);
    filesCreated.push(relPath);
  };

  if (!existsSync(outputPath)) {
    mkdirSync(outputPath, { recursive: true });
  }

  const rulesAppleVersion = options.rulesVersion || DEFAULT_RULES_APPLE_VERSION;

  write('MODULE.bazel', moduleBazel(name, rulesAppleVersion));
  write('.bazelrc', bazelrc(template));
  write('.bazelversion', `${bazelVersion}\n`);
  write('.gitignore', bazelGitignore());

  switch (template) {
    case 'ios_app':
      writeIosApp(write, name, bundleId, minimumOs, families);
      break;
    case 'ios_test':
      writeIosTest(write, name, minimumOs);
      break;
    case 'ios_app_with_tests':
      writeIosApp(write, name, bundleId, minimumOs, families);
      writeIosAppTest(write, name, minimumOs);
      break;
    case 'macos_app':
      writeMacosApp(write, name, bundleId, minimumOs);
      break;
    case 'macos_test':
      writeMacosTest(write, name, minimumOs);
      break;
    case 'macos_app_with_tests':
      writeMacosApp(write, name, bundleId, minimumOs);
      writeMacosAppTest(write, name, minimumOs);
      break;
  }

  // Absolute path so the config resolves correctly regardless of the cwd the
  // server/CLI is later launched from.
  write('.xcodebazelmcp/config.yaml', `workspacePath: ${resolve(outputPath)}\nbazelPath: bazel\n`);

  return { filesCreated, outputPath, template };
}

function moduleBazel(name: string, rulesAppleVersion: string): string {
  const needsAppleRules = true;
  const lines = [
    `module(name = "${name.toLowerCase()}", version = "0.0.1")`,
    '',
  ];

  if (needsAppleRules) {
    lines.push(
      `bazel_dep(name = "rules_apple", version = "${rulesAppleVersion}")`,
      `bazel_dep(name = "rules_swift", version = "${RULES_SWIFT_VERSION}")`,
      `bazel_dep(name = "apple_support", version = "${APPLE_SUPPORT_VERSION}")`,
      '',
    );
  }

  return lines.join('\n');
}

function bazelrc(template: ScaffoldTemplate): string {
  const lines = [
    '# Common settings',
    'common --enable_bzlmod',
    '',
    '# Build settings',
    'build --verbose_failures',
    '',
  ];

  if (template.startsWith('ios')) {
    lines.push(
      '# iOS simulator settings',
      'build:sim --ios_multi_cpus=sim_arm64',
      '',
      '# iOS device settings',
      'build:device --ios_multi_cpus=arm64',
      '',
    );
  }

  lines.push(
    '# Debug / Release configs',
    'build:debug --compilation_mode=dbg',
    'build:release --compilation_mode=opt --strip=always',
    '',
    '# Caching (uncomment and configure to speed up rebuilds)',
    '# build --disk_cache=~/.cache/bazel-disk',
    '# build --remote_cache=grpc://your-cache:9092',
    '',
  );

  return lines.join('\n');
}

function bazelGitignore(): string {
  return [
    '/bazel-*',
    '/.build',
    '*.xcodeproj',
    '*.xcworkspace',
    '.DS_Store',
    '',
  ].join('\n');
}

type WriteFunc = (relPath: string, content: string) => void;

function writeIosApp(write: WriteFunc, name: string, bundleId: string, minimumOs: string, families: string[]): void {
  const familiesLiteral = families.map((f) => `"${f}"`).join(', ');
  write(`${name}/BUILD.bazel`, `load("@rules_apple//apple:ios.bzl", "ios_application")
load("@rules_swift//swift:swift.bzl", "swift_library")

swift_library(
    name = "${name}Lib",
    srcs = glob(["Sources/**/*.swift"]),
    module_name = "${name}",
    visibility = ["//visibility:public"],
)

ios_application(
    name = "${name}",
    bundle_id = "${bundleId}",
    families = [${familiesLiteral}],
    infoplists = ["Info.plist"],
    minimum_os_version = "${minimumOs}",
    deps = [":${name}Lib"],
)
`);

  write(`${name}/Info.plist`, infoPlist(name, bundleId, true));

  write(`${name}/Sources/${name}App.swift`, `import SwiftUI

@main
struct ${name}App: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
`);

  write(`${name}/Sources/ContentView.swift`, `import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack {
            Image(systemName: "globe")
                .imageScale(.large)
                .foregroundStyle(.tint)
            Text("Hello, world!")
        }
        .padding()
    }
}
`);
}

function writeIosTest(write: WriteFunc, name: string, minimumOs: string): void {
  const testName = `${name}Tests`;
  write(`${testName}/BUILD.bazel`, `load("@rules_apple//apple:ios.bzl", "ios_unit_test")
load("@rules_swift//swift:swift.bzl", "swift_library")

swift_library(
    name = "${testName}Lib",
    testonly = True,
    srcs = glob(["Sources/**/*.swift"]),
    module_name = "${testName}",
)

ios_unit_test(
    name = "${testName}",
    minimum_os_version = "${minimumOs}",
    deps = [":${testName}Lib"],
)
`);

  write(`${testName}/Sources/${testName}.swift`, `import XCTest

final class ${testName}: XCTestCase {
    func testExample() {
        XCTAssertTrue(true, "Example test passes")
    }
}
`);
}

function writeIosAppTest(write: WriteFunc, name: string, minimumOs: string): void {
  const testName = `${name}Tests`;
  write(`${testName}/BUILD.bazel`, `load("@rules_apple//apple:ios.bzl", "ios_unit_test")
load("@rules_swift//swift:swift.bzl", "swift_library")

swift_library(
    name = "${testName}Lib",
    testonly = True,
    srcs = glob(["Sources/**/*.swift"]),
    module_name = "${testName}",
    deps = ["//${name}:${name}Lib"],
)

ios_unit_test(
    name = "${testName}",
    minimum_os_version = "${minimumOs}",
    test_host = "//${name}:${name}",
    deps = [":${testName}Lib"],
)
`);

  write(`${testName}/Sources/${testName}.swift`, `import XCTest
@testable import ${name}

final class ${testName}: XCTestCase {
    func testContentViewExists() {
        let view = ContentView()
        XCTAssertNotNil(view)
    }
}
`);
}

function writeMacosApp(write: WriteFunc, name: string, bundleId: string, minimumOs: string): void {
  write(`${name}/BUILD.bazel`, `load("@rules_apple//apple:macos.bzl", "macos_application")
load("@rules_swift//swift:swift.bzl", "swift_library")

swift_library(
    name = "${name}Lib",
    srcs = glob(["Sources/**/*.swift"]),
    module_name = "${name}",
    visibility = ["//visibility:public"],
)

macos_application(
    name = "${name}",
    bundle_id = "${bundleId}",
    infoplists = ["Info.plist"],
    minimum_os_version = "${minimumOs}",
    deps = [":${name}Lib"],
)
`);

  write(`${name}/Info.plist`, infoPlist(name, bundleId, false));

  write(`${name}/Sources/${name}App.swift`, `import SwiftUI

@main
struct ${name}App: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
`);

  write(`${name}/Sources/ContentView.swift`, `import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack {
            Image(systemName: "globe")
                .imageScale(.large)
                .foregroundStyle(.tint)
            Text("Hello, world!")
        }
        .padding()
    }
}
`);
}

function writeMacosTest(write: WriteFunc, name: string, minimumOs: string): void {
  const testName = `${name}Tests`;
  write(`${testName}/BUILD.bazel`, `load("@rules_apple//apple:macos.bzl", "macos_unit_test")
load("@rules_swift//swift:swift.bzl", "swift_library")

swift_library(
    name = "${testName}Lib",
    testonly = True,
    srcs = glob(["Sources/**/*.swift"]),
    module_name = "${testName}",
)

macos_unit_test(
    name = "${testName}",
    minimum_os_version = "${minimumOs}",
    deps = [":${testName}Lib"],
)
`);

  write(`${testName}/Sources/${testName}.swift`, `import XCTest

final class ${testName}: XCTestCase {
    func testExample() {
        XCTAssertTrue(true, "Example test passes")
    }
}
`);
}

function writeMacosAppTest(write: WriteFunc, name: string, minimumOs: string): void {
  const testName = `${name}Tests`;
  write(`${testName}/BUILD.bazel`, `load("@rules_apple//apple:macos.bzl", "macos_unit_test")
load("@rules_swift//swift:swift.bzl", "swift_library")

swift_library(
    name = "${testName}Lib",
    testonly = True,
    srcs = glob(["Sources/**/*.swift"]),
    module_name = "${testName}",
    deps = ["//${name}:${name}Lib"],
)

macos_unit_test(
    name = "${testName}",
    minimum_os_version = "${minimumOs}",
    test_host = "//${name}:${name}",
    deps = [":${testName}Lib"],
)
`);

  write(`${testName}/Sources/${testName}.swift`, `import XCTest
@testable import ${name}

final class ${testName}: XCTestCase {
    func testContentViewExists() {
        let view = ContentView()
        XCTAssertNotNil(view)
    }
}
`);
}

function infoPlist(name: string, bundleId: string, isIos: boolean): string {
  // iOS apps need LSRequiresIPhoneOS and a launch-screen key or the app warns /
  // is rejected; macOS apps don't.
  const iosKeys = isIos
    ? `    <key>LSRequiresIPhoneOS</key>
    <true/>
    <key>UILaunchScreen</key>
    <dict/>
`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>${name}</string>
    <key>CFBundleIdentifier</key>
    <string>${bundleId}</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
${iosKeys}</dict>
</plist>
`;
}
