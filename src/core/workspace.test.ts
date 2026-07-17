import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertBazelWorkspace, discoverBazelWorkspace, isBazelWorkspace, readBspStatus } from './workspace.js';

const dirs: string[] = [];
function makeTmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'ws-test-'));
  dirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

describe('isBazelWorkspace', () => {
  it('returns true when MODULE.bazel exists', () => {
    const tmp = makeTmp();
    writeFileSync(join(tmp, 'MODULE.bazel'), 'module(name = "test")');
    expect(isBazelWorkspace(tmp)).toBe(true);
  });

  it('returns false for a plain directory', () => {
    const tmp = makeTmp();
    expect(isBazelWorkspace(tmp)).toBe(false);
  });
});

describe('discoverBazelWorkspace', () => {
  it('walks up from a nested directory to find the Bazel root', () => {
    const root = makeTmp();
    const nested = join(root, 'Apps', 'Dasher', 'Tests');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, 'MODULE.bazel'), 'module(name = "test")');

    expect(discoverBazelWorkspace([nested])).toBe(root);
  });
});

describe('assertBazelWorkspace', () => {
  it('throws when path does not exist', () => {
    expect(() => assertBazelWorkspace('/no/such/path')).toThrowError(
      'Workspace does not exist or is not a directory',
    );
  });

  it('throws when path is a file', () => {
    const tmp = makeTmp();
    const file = join(tmp, 'file');
    writeFileSync(file, '');
    expect(() => assertBazelWorkspace(file)).toThrowError(
      'Workspace does not exist or is not a directory',
    );
  });

  it('throws when dir has no Bazel markers', () => {
    const tmp = makeTmp();
    expect(() => assertBazelWorkspace(tmp)).toThrowError(
      'Workspace has no MODULE.bazel, WORKSPACE, or WORKSPACE.bazel',
    );
  });

  it.each(['MODULE.bazel', 'WORKSPACE', 'WORKSPACE.bazel'])('succeeds with %s', (marker) => {
    const tmp = makeTmp();
    writeFileSync(join(tmp, marker), '');
    expect(() => assertBazelWorkspace(tmp)).not.toThrow();
  });
});

describe('readBspStatus', () => {
  it('reports missing when no .bsp dir', () => {
    const tmp = makeTmp();
    const lines = readBspStatus(tmp);
    expect(lines).toContain(`workspace: ${tmp}`);
    expect(lines).toContain('.bsp/skbsp.json: missing');
    expect(lines).toHaveLength(2);
  });

  it('parses valid .bsp/skbsp.json', () => {
    const tmp = makeTmp();
    mkdirSync(join(tmp, '.bsp'));
    writeFileSync(
      join(tmp, '.bsp', 'skbsp.json'),
      JSON.stringify({ name: 'myBsp', argv: ['a', 'b'] }),
    );
    const lines = readBspStatus(tmp);
    expect(lines).toContain('.bsp/skbsp.json: found');
    expect(lines).toContain('name: myBsp');
    expect(lines).toContain('argv: a b');
  });

  it('handles malformed JSON', () => {
    const tmp = makeTmp();
    mkdirSync(join(tmp, '.bsp'));
    writeFileSync(join(tmp, '.bsp', 'skbsp.json'), '{bad json');
    const lines = readBspStatus(tmp);
    expect(lines).toContain('.bsp/skbsp.json: found');
    expect(lines.some((l) => l.startsWith('parse error:'))).toBe(true);
  });
});
