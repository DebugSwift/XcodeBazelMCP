import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { runCommand } from '../utils/process.js';

export const AGENT_DEBUG_ENV_LOG_PATH = 'AGENT_DEBUG_LOG_PATH';
export const AGENT_DEBUG_ENV_SESSION_ID = 'AGENT_DEBUG_SESSION_ID';
export const AGENT_DEBUG_SIM_REL_PATH = 'Documents/agent-debug.ndjson';

export interface AgentDebugLogEntry {
  sessionId?: string;
  id?: string;
  timestamp?: number;
  location?: string;
  message?: string;
  data?: Record<string, unknown>;
  runId?: string;
  hypothesisId?: string;
  [key: string]: unknown;
}

export interface AgentDebugParseError {
  line: number;
  raw: string;
  error: string;
}

export interface AgentDebugReadOptions {
  logPath: string;
  hypothesisId?: string;
  runId?: string;
  limit?: number;
}

export interface AgentDebugReadResult {
  logPath: string;
  exists: boolean;
  lineCount: number;
  entries: AgentDebugLogEntry[];
  byHypothesisId: Record<string, AgentDebugLogEntry[]>;
  byRunId: Record<string, AgentDebugLogEntry[]>;
  hypothesisStatusHints: Record<string, 'CONFIRMED' | 'REJECTED' | 'INCONCLUSIVE' | 'UNKNOWN'>;
  parseErrors: AgentDebugParseError[];
}

export function agentDebugLaunchEnv(logPath: string, sessionId: string): Record<string, string> {
  return {
    [AGENT_DEBUG_ENV_LOG_PATH]: logPath,
    [AGENT_DEBUG_ENV_SESSION_ID]: sessionId,
  };
}

export function clearAgentDebugLog(logPath: string): { logPath: string; cleared: boolean; existed: boolean } {
  const existed = existsSync(logPath);
  if (existed) {
    unlinkSync(logPath);
  }
  return { logPath, cleared: true, existed };
}

export function parseAgentDebugNdjson(content: string): {
  entries: AgentDebugLogEntry[];
  parseErrors: AgentDebugParseError[];
} {
  const entries: AgentDebugLogEntry[] = [];
  const parseErrors: AgentDebugParseError[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as AgentDebugLogEntry;
      entries.push(parsed);
    } catch (err) {
      parseErrors.push({ line: i + 1, raw, error: (err as Error).message });
    }
  }

  return { entries, parseErrors };
}

function inferHypothesisStatus(entries: AgentDebugLogEntry[]): 'CONFIRMED' | 'REJECTED' | 'INCONCLUSIVE' | 'UNKNOWN' {
  for (const entry of entries) {
    const blob = `${entry.message ?? ''} ${JSON.stringify(entry.data ?? {})}`.toUpperCase();
    if (blob.includes('CONFIRMED')) return 'CONFIRMED';
    if (blob.includes('REJECTED')) return 'REJECTED';
    if (blob.includes('INCONCLUSIVE')) return 'INCONCLUSIVE';
  }
  return 'UNKNOWN';
}

export function readAgentDebugLog(options: AgentDebugReadOptions): AgentDebugReadResult {
  const { logPath, hypothesisId, runId, limit } = options;
  if (!existsSync(logPath)) {
    return {
      logPath,
      exists: false,
      lineCount: 0,
      entries: [],
      byHypothesisId: {},
      byRunId: {},
      hypothesisStatusHints: {},
      parseErrors: [],
    };
  }

  const content = readFileSync(logPath, 'utf-8');
  const { entries: allEntries, parseErrors } = parseAgentDebugNdjson(content);

  let entries = allEntries;
  if (hypothesisId) entries = entries.filter((e) => e.hypothesisId === hypothesisId);
  if (runId) entries = entries.filter((e) => e.runId === runId);
  if (typeof limit === 'number' && limit > 0) entries = entries.slice(-limit);

  const byHypothesisId: Record<string, AgentDebugLogEntry[]> = {};
  const byRunId: Record<string, AgentDebugLogEntry[]> = {};
  for (const entry of allEntries) {
    if (entry.hypothesisId) {
      (byHypothesisId[entry.hypothesisId] ??= []).push(entry);
    }
    if (entry.runId) {
      (byRunId[entry.runId] ??= []).push(entry);
    }
  }

  const hypothesisStatusHints: Record<string, 'CONFIRMED' | 'REJECTED' | 'INCONCLUSIVE' | 'UNKNOWN'> = {};
  for (const [hid, group] of Object.entries(byHypothesisId)) {
    hypothesisStatusHints[hid] = inferHypothesisStatus(group);
  }

  const lineCount = content.split('\n').filter((l) => l.trim()).length;

  return {
    logPath,
    exists: true,
    lineCount,
    entries,
    byHypothesisId,
    byRunId,
    hypothesisStatusHints,
    parseErrors,
  };
}

export function agentDebugLogResourceUri(logPath: string): string {
  return `xcodebazel://agent-debug-log?path=${encodeURIComponent(logPath)}`;
}

export interface AgentDebugLogResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export function discoverAgentDebugLogPaths(searchRoots: string[]): string[] {
  const seen = new Set<string>();
  const discovered: Array<{ path: string; mtimeMs: number }> = [];

  for (const root of searchRoots) {
    const cursorDir = join(resolve(root), '.cursor');
    if (!existsSync(cursorDir)) continue;
    for (const entry of readdirSync(cursorDir)) {
      if (!entry.startsWith('debug-') || !entry.endsWith('.log')) continue;
      const logPath = resolve(cursorDir, entry);
      if (seen.has(logPath)) continue;
      seen.add(logPath);
      discovered.push({ path: logPath, mtimeMs: statSync(logPath).mtimeMs });
    }
  }

  return discovered.sort((a, b) => b.mtimeMs - a.mtimeMs).map((entry) => entry.path);
}

export function listAgentDebugLogResources(searchRoots: string[]): AgentDebugLogResource[] {
  const logPaths = discoverAgentDebugLogPaths(searchRoots);
  if (logPaths.length === 0) {
    return [
      {
        uri: 'xcodebazel://agent-debug-log',
        name: 'Agent debug NDJSON log',
        description:
          'Structured agent debug log. Use bazel_ios_agent_debug_log_read or pass ?path=<absolute-log-path> on the URI.',
        mimeType: 'application/json',
      },
    ];
  }

  return logPaths.map((logPath, index) => ({
    uri: agentDebugLogResourceUri(logPath),
    name: index === 0 ? 'Agent debug NDJSON log' : `Agent debug log (${logPath.split('/').pop()})`,
    description: `NDJSON debug log at ${logPath}`,
    mimeType: 'application/json',
  }));
}

export function readAgentDebugLogResourceHelp(searchRoots: string[]): Record<string, unknown> {
  const discoveredPaths = discoverAgentDebugLogPaths(searchRoots);
  return {
    kind: 'agent-debug-log-help',
    message:
      'Provide ?path=<absolute-log-path> on the URI, or use bazel_ios_agent_debug_log_read / bazel_ios_agent_debug_log_pull.',
    template: 'xcodebazel://agent-debug-log?path={path}',
    discoveredPaths,
    suggestedUris: discoveredPaths.map(agentDebugLogResourceUri),
  };
}

export function parseAgentDebugLogUri(uri: string): string | null {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== 'xcodebazel:' || parsed.hostname !== 'agent-debug-log') return null;
    const path = parsed.searchParams.get('path');
    return path || null;
  } catch {
    return null;
  }
}

export interface PullAgentDebugLogOptions {
  bundleId: string;
  simulatorId: string;
  destPath?: string;
  simRelPath?: string;
}

export async function pullAgentDebugLogFromSimulator(
  options: PullAgentDebugLogOptions,
): Promise<{
  bundleId: string;
  simulatorId: string;
  containerPath: string;
  sourcePath: string;
  destPath?: string;
  read: AgentDebugReadResult;
  commandOutput: string;
}> {
  const simRelPath = options.simRelPath ?? AGENT_DEBUG_SIM_REL_PATH;
  const result = await runCommand(
    'xcrun',
    ['simctl', 'get_app_container', options.simulatorId, options.bundleId, 'data'],
    { cwd: process.cwd(), timeoutSeconds: 30, maxOutput: 10_000 },
  );

  if (result.exitCode !== 0) {
    throw new Error(
      `simctl get_app_container failed (exit ${result.exitCode}): ${result.output.trim() || 'no output'}`,
    );
  }

  const containerPath = result.output.trim();
  const sourcePath = join(containerPath, simRelPath);

  let read: AgentDebugReadResult;
  let destPath: string | undefined;

  if (options.destPath) {
    destPath = options.destPath;
    const parent = dirname(destPath);
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
    if (existsSync(sourcePath)) {
      copyFileSync(sourcePath, destPath);
    } else {
      writeFileSync(destPath, '');
    }
    read = readAgentDebugLog({ logPath: destPath });
  } else {
    read = readAgentDebugLog({ logPath: sourcePath });
  }

  return {
    bundleId: options.bundleId,
    simulatorId: options.simulatorId,
    containerPath,
    sourcePath,
    destPath,
    read,
    commandOutput: result.output.trim(),
  };
}

export function extractNdjsonFromLogCapture(
  output: string,
  options?: { messageContains?: string; jsonLinesOnly?: boolean },
): AgentDebugLogEntry[] {
  const { entries } = parseAgentDebugNdjson(output);
  if (!options?.messageContains && !options?.jsonLinesOnly) return entries;

  const needle = options.messageContains?.toLowerCase();
  return entries.filter((entry) => {
    if (needle) {
      const hay = `${entry.message ?? ''} ${JSON.stringify(entry.data ?? {})}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (options.jsonLinesOnly && !entry.hypothesisId && !entry.sessionId) return false;
    return true;
  });
}
