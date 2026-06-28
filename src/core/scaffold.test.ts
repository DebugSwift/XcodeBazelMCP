import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { getAvailableTemplates, scaffold } from './scaffold.js';

const testDir = join(tmpdir(), `xbmcp-scaffold-test-${Date.now()}`);

afterEach(() => {
  try { rmSync(testDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('scaffold templates list', () => {
  it('returns all 6 templates', () => {
    const templates = getAvailableTemplates();
    expect(templates).toHaveLength(6);
    expect(templates.map((t) => t.id)).toEqual([
      'ios_app', 'ios_test', 'ios_app_with_tests',
      'macos_app', 'macos_test', 'macos_app_with_tests',
    ]);
  });
});

describe('scaffold ios_app', () => {
  it('creates MODULE.bazel, BUILD, Swift sources, and config', () => {
    const outDir = join(testDir, 'ios-app');
    const result = scaffold({ outputPath: outDir, name: 'TestApp', template: 'ios_app' });

    expect(result.filesCreated).toContain('MODULE.bazel');
    expect(result.filesCreated).toContain('.bazelrc');
    expect(result.filesCreated).toContain('.bazelversion');
    expect(result.filesCreated).toContain('TestApp/BUILD.bazel');
    expect(result.filesCreated).toContain('TestApp/Info.plist');
    expect(result.filesCreated).toContain('TestApp/Sources/TestAppApp.swift');
    expect(result.filesCreated).toContain('TestApp/Sources/ContentView.swift');
    expect(result.filesCreated).toContain('.xcodebazelmcp/config.yaml');

    const moduleBazel = readFileSync(join(outDir, 'MODULE.bazel'), 'utf8');
    expect(moduleBazel).toContain('rules_apple');
    expect(moduleBazel).toContain('testapp');

    const build = readFileSync(join(outDir, 'TestApp/BUILD.bazel'), 'utf8');
    expect(build).toContain('ios_application');
    expect(build).toContain('com.example.TestApp');
    expect(build).toContain('17.0');
  });
});

describe('scaffold ios_app_with_tests', () => {
  it('creates both app and test targets', () => {
    const outDir = join(testDir, 'ios-app-test');
    const result = scaffold({ outputPath: outDir, name: 'MyApp', template: 'ios_app_with_tests' });

    expect(result.filesCreated).toContain('MyApp/BUILD.bazel');
    expect(result.filesCreated).toContain('MyAppTests/BUILD.bazel');
    expect(result.filesCreated).toContain('MyAppTests/Sources/MyAppTests.swift');

    const testBuild = readFileSync(join(outDir, 'MyAppTests/BUILD.bazel'), 'utf8');
    expect(testBuild).toContain('ios_unit_test');
    expect(testBuild).toContain('test_host = "//MyApp:MyApp"');
  });
});

describe('scaffold macos_app', () => {
  it('uses macos_application rule and macOS defaults', () => {
    const outDir = join(testDir, 'mac-app');
    const result = scaffold({ outputPath: outDir, name: 'MacApp', template: 'macos_app' });

    expect(result.filesCreated).toContain('MacApp/BUILD.bazel');

    const build = readFileSync(join(outDir, 'MacApp/BUILD.bazel'), 'utf8');
    expect(build).toContain('macos_application');
    expect(build).toContain('14.0');
  });
});

describe('scaffold ios_test', () => {
  it('creates a standalone test target', () => {
    const outDir = join(testDir, 'ios-test');
    const result = scaffold({ outputPath: outDir, name: 'MyLib', template: 'ios_test' });

    expect(result.filesCreated).toContain('MyLibTests/BUILD.bazel');
    expect(result.filesCreated).toContain('MyLibTests/Sources/MyLibTests.swift');

    const build = readFileSync(join(outDir, 'MyLibTests/BUILD.bazel'), 'utf8');
    expect(build).toContain('ios_unit_test');
  });
});

describe('scaffold macos_app_with_tests', () => {
  it('creates macOS app and test targets', () => {
    const outDir = join(testDir, 'mac-app-test');
    const result = scaffold({ outputPath: outDir, name: 'MacApp', template: 'macos_app_with_tests' });

    expect(result.filesCreated).toContain('MacApp/BUILD.bazel');
    expect(result.filesCreated).toContain('MacAppTests/BUILD.bazel');

    const testBuild = readFileSync(join(outDir, 'MacAppTests/BUILD.bazel'), 'utf8');
    expect(testBuild).toContain('macos_unit_test');
  });
});

describe('scaffold macos_test', () => {
  it('creates a standalone macOS test target', () => {
    const outDir = join(testDir, 'mac-test');
    const result = scaffold({ outputPath: outDir, name: 'Mac', template: 'macos_test' });

    expect(result.filesCreated).toContain('MacTests/BUILD.bazel');
    const build = readFileSync(join(outDir, 'MacTests/BUILD.bazel'), 'utf8');
    expect(build).toContain('macos_unit_test');
  });
});

describe('scaffold custom options', () => {
  it('uses custom bundleId and minimumOs', () => {
    const outDir = join(testDir, 'custom');
    scaffold({
      outputPath: outDir,
      name: 'Custom',
      template: 'ios_app',
      bundleId: 'org.custom.app',
      minimumOs: '16.0',
    });

    const build = readFileSync(join(outDir, 'Custom/BUILD.bazel'), 'utf8');
    expect(build).toContain('org.custom.app');
    expect(build).toContain('16.0');
  });

  it('generates .gitignore', () => {
    const outDir = join(testDir, 'gitignore');
    scaffold({ outputPath: outDir, name: 'GI', template: 'ios_app' });
    expect(existsSync(join(outDir, '.gitignore'))).toBe(true);
  });

  it('generates .bazelversion', () => {
    const outDir = join(testDir, 'bversion');
    scaffold({ outputPath: outDir, name: 'BV', template: 'ios_app' });
    const content = readFileSync(join(outDir, '.bazelversion'), 'utf8');
    expect(content.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('scaffold guards', () => {
  it('throws if workspace already exists', () => {
    const outDir = join(testDir, 'existing');
    scaffold({ outputPath: outDir, name: 'First', template: 'ios_app' });

    expect(() => scaffold({ outputPath: outDir, name: 'Second', template: 'ios_app' })).toThrow(
      'already exists',
    );
  });

  it('throws on an unknown template instead of producing a partial project', () => {
    const outDir = join(testDir, 'bad-template');
    expect(() =>
      // @ts-expect-error intentionally passing an invalid template
      scaffold({ outputPath: outDir, name: 'Bad', template: 'ios_widget' }),
    ).toThrow('Unknown template');
    expect(existsSync(join(outDir, 'MODULE.bazel'))).toBe(false);
  });

  it('rejects an invalid project name', () => {
    const outDir = join(testDir, 'bad-name');
    expect(() => scaffold({ outputPath: outDir, name: '1Bad', template: 'ios_app' })).toThrow(
      'Invalid project name',
    );
  });

  it('writes a custom bazelVersion to .bazelversion and an absolute config path', () => {
    const outDir = join(testDir, 'bazel-version');
    scaffold({ outputPath: outDir, name: 'App', template: 'ios_app', bazelVersion: '8.0.0' });
    expect(readFileSync(join(outDir, '.bazelversion'), 'utf8').trim()).toBe('8.0.0');
    expect(readFileSync(join(outDir, '.xcodebazelmcp', 'config.yaml'), 'utf8')).toContain(`workspacePath: ${outDir}`);
  });

  it('iOS Info.plist includes LSRequiresIPhoneOS / UILaunchScreen; macOS does not', () => {
    const iosDir = join(testDir, 'ios-plist');
    scaffold({ outputPath: iosDir, name: 'IApp', template: 'ios_app' });
    const iosPlist = readFileSync(join(iosDir, 'IApp', 'Info.plist'), 'utf8');
    expect(iosPlist).toContain('LSRequiresIPhoneOS');
    expect(iosPlist).toContain('UILaunchScreen');

    const macDir = join(testDir, 'mac-plist');
    scaffold({ outputPath: macDir, name: 'MApp', template: 'macos_app' });
    const macPlist = readFileSync(join(macDir, 'MApp', 'Info.plist'), 'utf8');
    expect(macPlist).not.toContain('LSRequiresIPhoneOS');
  });

  it('rejects an injection-prone bundleId', () => {
    const outDir = join(testDir, 'bad-bundle');
    expect(() =>
      scaffold({ outputPath: outDir, name: 'App', template: 'ios_app', bundleId: 'com.x"\n evil' }),
    ).toThrow('Invalid bundleId');
    expect(existsSync(join(outDir, 'MODULE.bazel'))).toBe(false);
  });

  it('rejects a non-numeric minimumOs', () => {
    const outDir = join(testDir, 'bad-os');
    expect(() =>
      scaffold({ outputPath: outDir, name: 'App', template: 'ios_app', minimumOs: 'latest' }),
    ).toThrow('Invalid minimumOs');
  });

  it('honors a custom families list and rejects invalid families', () => {
    const outDir = join(testDir, 'families');
    scaffold({ outputPath: outDir, name: 'IPhoneOnly', template: 'ios_app', families: ['iphone'] });
    const build = readFileSync(join(outDir, 'IPhoneOnly', 'BUILD.bazel'), 'utf8');
    expect(build).toContain('families = ["iphone"]');

    expect(() =>
      scaffold({ outputPath: join(testDir, 'bad-fam'), name: 'X', template: 'ios_app', families: ['tv'] }),
    ).toThrow('Invalid family');
  });

  it('rejects a malformed rulesVersion', () => {
    const outDir = join(testDir, 'bad-rules');
    expect(() =>
      scaffold({ outputPath: outDir, name: 'App', template: 'ios_app', rulesVersion: 'HEAD' }),
    ).toThrow('Invalid rulesVersion');
  });
});
