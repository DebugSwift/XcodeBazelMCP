import type { CommandResult, ToolCallResult } from '../types/index.js';
import { classifyFailure } from '../core/diagnostics.js';

/** Human-readable meanings for Bazel's documented exit codes. */
const BAZEL_EXIT_CODES: Record<number, string> = {
  1: 'build/command failed',
  2: 'command-line / usage error',
  3: 'tests failed or did not pass',
  4: 'no tests found for the given pattern',
  8: 'build interrupted',
  36: 'local environment issue',
  37: 'unhandled internal Bazel error',
};

function bazelExitHint(result: CommandResult): string | undefined {
  const bin = result.command.split('/').pop() || result.command;
  if (!/^bazel(isk)?$/.test(bin)) return undefined;
  const meaning = BAZEL_EXIT_CODES[result.exitCode];
  return meaning ? `Bazel exit ${result.exitCode}: ${meaning}.` : undefined;
}

export function toolText(text: string, isError = false): ToolCallResult {
  return {
    content: [{ type: 'text', text }],
    isError: isError || undefined,
  };
}

export function toolResult(
  text: string,
  structured: Record<string, unknown>,
  isError = false,
): ToolCallResult {
  return {
    content: [{ type: 'text', text }],
    isError: isError || undefined,
    structuredContent: structured,
  };
}

export function formatCommandResult(commandResult: CommandResult): string {
  const commandLine = [commandResult.command, ...commandResult.args].join(' ');
  const failed = commandResult.exitCode !== 0 || commandResult.timedOut === true;
  const status = failed ? 'FAILED' : 'OK';
  const signal = commandResult.signal ? ` signal=${commandResult.signal}` : '';
  const kind = failed && commandResult.failureKind && commandResult.failureKind !== 'nonzero-exit'
    ? ` kind=${commandResult.failureKind}`
    : '';

  const lines = [
    `${status} exit=${commandResult.exitCode}${signal}${kind} duration=${(
      commandResult.durationMs / 1000
    ).toFixed(1)}s`,
    `$ ${commandLine}`,
    '',
    commandResult.output.trim() || '(no output)',
  ];

  if (commandResult.timedOut) {
    lines.push(`\n⏱  TIMED OUT after ${commandResult.timeoutSeconds ?? '?'}s — increase timeoutSeconds or narrow the target.`);
  }
  if (commandResult.truncated) {
    const dropped = commandResult.bytesDropped
      ? `: ~${commandResult.bytesDropped} characters dropped (head + tail kept)`
      : '';
    lines.push(`[output truncated${dropped}]`);
  }

  if (failed) {
    const exitHint = bazelExitHint(commandResult);
    if (exitHint) lines.push('', exitHint);
    const failure = classifyFailure(commandResult);
    // Only surface the diagnostics block when it adds signal — avoids a bare
    // "Failure category: unknown" line on trivial (e.g. simctl) failures.
    if (failure && (failure.category !== 'unknown' || failure.diagnostics.length > 0 || failure.invocationUrl)) {
      lines.push('', `Failure category: ${failure.category}`);
      if (failure.diagnostics.length > 0) {
        lines.push('Top diagnostics:');
        for (const d of failure.diagnostics.slice(0, 8)) lines.push(`  • ${d}`);
      }
      if (failure.invocationUrl) lines.push(`Remote logs: ${failure.invocationUrl}`);
    }
    if (commandResult.context) {
      lines.push('', 'Context:');
      for (const [k, v] of Object.entries(commandResult.context)) lines.push(`  ${k}: ${v}`);
    }
  }

  return lines.join('\n');
}

export function structuredCommandResult(result: CommandResult): Record<string, unknown> {
  const failure = classifyFailure(result);
  return {
    ok: result.exitCode === 0 && !result.timedOut,
    exitCode: result.exitCode,
    signal: result.signal || undefined,
    failureKind: result.failureKind,
    timedOut: result.timedOut || undefined,
    timeoutSeconds: result.timedOut ? result.timeoutSeconds : undefined,
    spawnErrorCode: result.spawnErrorCode,
    durationMs: result.durationMs,
    command: [result.command, ...result.args].join(' '),
    id: result.id,
    output: result.output,
    stderr: result.stderr,
    truncated: result.truncated,
    bytesDropped: result.bytesDropped,
    context: result.context,
    category: failure?.category,
    diagnostics: failure?.diagnostics,
    invocationUrl: failure?.invocationUrl,
  };
}
