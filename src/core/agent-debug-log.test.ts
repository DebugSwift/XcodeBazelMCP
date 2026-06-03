import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  agentDebugLaunchEnv,
  clearAgentDebugLog,
  parseAgentDebugLogUri,
  readAgentDebugLog,
  parseAgentDebugNdjson,
  extractNdjsonFromLogCapture,
} from './agent-debug-log.js';

describe('agent-debug-log', () => {
  let tempDir: string;
  let logPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'xbmcp-agent-debug-'));
    logPath = join(tempDir, 'debug.log');
  });

  afterEach(() => {
    if (existsSync(logPath)) unlinkSync(logPath);
  });

  it('agentDebugLaunchEnv sets expected keys', () => {
    expect(agentDebugLaunchEnv('/tmp/debug.log', 'abc123')).toEqual({
      AGENT_DEBUG_LOG_PATH: '/tmp/debug.log',
      AGENT_DEBUG_SESSION_ID: 'abc123',
    });
  });

  it('clearAgentDebugLog removes existing file', () => {
    writeFileSync(logPath, '{"message":"x"}\n');
    const result = clearAgentDebugLog(logPath);
    expect(result.existed).toBe(true);
    expect(result.cleared).toBe(true);
    expect(existsSync(logPath)).toBe(false);
  });

  it('readAgentDebugLog parses NDJSON and groups by hypothesis', () => {
    writeFileSync(
      logPath,
      [
        '{"hypothesisId":"A","runId":"r1","message":"CONFIRMED fix"}',
        '{"hypothesisId":"B","runId":"r1","message":"REJECTED bad path"}',
        'not-json',
      ].join('\n'),
    );

    const result = readAgentDebugLog({ logPath });
    expect(result.exists).toBe(true);
    expect(result.entries).toHaveLength(2);
    expect(result.parseErrors).toHaveLength(1);
    expect(result.byHypothesisId.A).toHaveLength(1);
    expect(result.hypothesisStatusHints.A).toBe('CONFIRMED');
    expect(result.hypothesisStatusHints.B).toBe('REJECTED');
  });

  it('readAgentDebugLog filters by hypothesisId and runId', () => {
    writeFileSync(
      logPath,
      '{"hypothesisId":"A","runId":"r1"}\n{"hypothesisId":"A","runId":"r2"}\n',
    );
    const filtered = readAgentDebugLog({ logPath, hypothesisId: 'A', runId: 'r2' });
    expect(filtered.entries).toHaveLength(1);
    expect(filtered.entries[0].runId).toBe('r2');
  });

  it('parseAgentDebugLogUri extracts path query', () => {
    expect(parseAgentDebugLogUri('xcodebazel://agent-debug-log?path=%2Ftmp%2Fx.log')).toBe('/tmp/x.log');
    expect(parseAgentDebugLogUri('xcodebazel://last-command')).toBeNull();
  });

  it('parseAgentDebugNdjson handles empty lines', () => {
    const { entries, parseErrors } = parseAgentDebugNdjson('\n\n{"a":1}\n\n');
    expect(entries).toHaveLength(1);
    expect(parseErrors).toHaveLength(0);
  });

  it('extractNdjsonFromLogCapture filters json lines with hypothesisId', () => {
    const text = '{"hypothesisId":"H1"}\nplain text\n{"foo":1}\n';
    const filtered = extractNdjsonFromLogCapture(text, { jsonLinesOnly: true });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].hypothesisId).toBe('H1');
  });

  it('read missing log returns exists false', () => {
    const result = readAgentDebugLog({ logPath: join(tempDir, 'missing.log') });
    expect(result.exists).toBe(false);
    expect(result.entries).toEqual([]);
  });
});
