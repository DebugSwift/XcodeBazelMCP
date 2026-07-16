import { describe, expect, it } from 'vitest';
import { augmentPathForToolchain, resolveBazelExecutable } from './resolve-toolchain.js';

describe('augmentPathForToolchain', () => {
  it('prepends Homebrew and local bin dirs when missing from PATH', () => {
    const env = augmentPathForToolchain({ PATH: '/usr/bin:/bin' });
    expect(env.PATH).toMatch(/^\/opt\/homebrew\/bin:/);
    expect(env.PATH).toContain('/usr/local/bin');
    expect(env.PATH).toContain('/usr/bin');
  });

  it('does not duplicate dirs already present in PATH', () => {
    const env = augmentPathForToolchain({ PATH: '/opt/homebrew/bin:/usr/bin' });
    expect(env.PATH?.split(':').filter((part) => part === '/opt/homebrew/bin')).toHaveLength(1);
  });
});

describe('resolveBazelExecutable', () => {
  it('resolves bare bazel to an absolute path on this machine', () => {
    const resolved = resolveBazelExecutable('bazel');
    expect(resolved).toMatch(/^\//);
    expect(resolved).toMatch(/bazel(isk)?$/);
  });

  it('preserves absolute configured paths', () => {
    expect(resolveBazelExecutable('/opt/homebrew/bin/bazel')).toBe('/opt/homebrew/bin/bazel');
  });
});
