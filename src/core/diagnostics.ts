import type { CommandResult } from '../types/index.js';

export type FailureCategory =
  | 'timeout'
  | 'spawn_error'
  | 'analysis_error'
  | 'build_file_error'
  | 'missing_dependency'
  | 'link_error'
  | 'compile_error'
  | 'test_failure'
  | 'unknown';

export interface FailureDiagnostics {
  category: FailureCategory;
  diagnostics: string[];
  invocationUrl?: string;
}

const INVOCATION_RE = /https?:\/\/\S*invocation\/\S+/i;

/** Pull a BuildBuddy / BES invocation URL out of Bazel output (one click to full remote logs). */
export function extractInvocationUrl(text: string): string | undefined {
  const match = text.match(INVOCATION_RE);
  if (!match) return undefined;
  // Trim trailing punctuation that often follows a URL in prose.
  return match[0].replace(/[)\].,;'"]+$/, '');
}

const DIAGNOSTIC_LINE_RE =
  /(ERROR:|error:|fatal error:|FAILED:|Undefined symbols?|duplicate symbol|ld: |linker command failed|no such target|no such package|not declared|is not visible|\*\* (BUILD|TEST) FAILED \*\*|Analysis (of|failed))/;

function pickDiagnosticLines(text: string, limit = 12): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || !DIAGNOSTIC_LINE_RE.test(line)) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
    if (lines.length >= limit) break;
  }
  return lines;
}

function categorize(text: string): FailureCategory {
  if (/ERROR:.*[Aa]nalysis of target/.test(text) || /[Aa]nalysis failed/.test(text)) {
    return 'analysis_error';
  }
  if (/no such package/i.test(text) || /error loading package/i.test(text) || /\/BUILD(\.bazel)?:\d+/.test(text)) {
    return 'build_file_error';
  }
  if (/no such target/i.test(text) || /is not visible to target/i.test(text) || /which is not visible/i.test(text) || /missing dependency/i.test(text) || /undeclared inclusion/i.test(text)) {
    return 'missing_dependency';
  }
  if (/Undefined symbols?/i.test(text) || /duplicate symbol/i.test(text) || /\bld: /.test(text) || /linker command failed/i.test(text)) {
    return 'link_error';
  }
  if (/\.swift:\d+:\d+: error:/.test(text) || /\berror: /.test(text) || /fatal error:/.test(text)) {
    return 'compile_error';
  }
  if (/Executed \d+ tests?/i.test(text) || /Test Suite .* failed/i.test(text) || /\*\* TEST FAILED \*\*/.test(text) || /\d+ (?:test )?fails?\b/i.test(text) || /XCTAssert/.test(text)) {
    return 'test_failure';
  }
  return 'unknown';
}

type ClassifiableResult = Pick<
  CommandResult,
  'exitCode' | 'stdout' | 'stderr' | 'output' | 'timedOut' | 'failureKind' | 'spawnErrorCode'
>;

// formatCommandResult and structuredCommandResult are usually called on the same
// result object; cache by reference so the regex scan over (potentially large)
// output runs at most once per result.
const classifyCache = new WeakMap<object, FailureDiagnostics | undefined>();

/**
 * Classify a failed command and surface the top diagnostic lines so an agent
 * can jump straight to the cause instead of re-reading a multi-thousand-line
 * dump. Returns undefined for successful commands.
 */
export function classifyFailure(result: ClassifiableResult): FailureDiagnostics | undefined {
  const cached = classifyCache.get(result);
  if (cached !== undefined || classifyCache.has(result)) return cached;
  const computed = computeClassification(result);
  classifyCache.set(result, computed);
  return computed;
}

function computeClassification(result: ClassifiableResult): FailureDiagnostics | undefined {
  if (result.failureKind === 'ok' || (result.exitCode === 0 && !result.timedOut)) {
    return undefined;
  }

  // Prefer stderr (where Bazel/Swift write diagnostics); fall back to combined.
  const haystack = [result.stderr, result.output].filter((s): s is string => Boolean(s)).join('\n');
  const invocationUrl = extractInvocationUrl(haystack);

  if (result.timedOut || result.failureKind === 'timeout') {
    return { category: 'timeout', diagnostics: pickDiagnosticLines(haystack, 6), invocationUrl };
  }
  if (result.failureKind === 'spawn-error') {
    const code = result.spawnErrorCode ? ` (${result.spawnErrorCode})` : '';
    return { category: 'spawn_error', diagnostics: [`Failed to spawn command${code}: ${result.output}`.trim()], invocationUrl };
  }

  return {
    category: categorize(haystack),
    diagnostics: pickDiagnosticLines(haystack),
    invocationUrl,
  };
}
