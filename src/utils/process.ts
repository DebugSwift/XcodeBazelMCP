import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type { CommandResult, FailureKind } from '../types/index.js';

export interface RunCommandOptions {
  cwd: string;
  timeoutSeconds?: number;
  maxOutput: number;
  env?: NodeJS.ProcessEnv;
  /** Correlation id threaded into the result (and the command log). */
  id?: string;
}

export interface StreamChunk {
  stream: 'stdout' | 'stderr';
  data: string;
}

/**
 * Accumulates text while keeping only the first `head` and last `tail` portion
 * of the stream. For Bazel/Swift the actionable diagnostic (`error:`, the
 * `FAILED:`/`ERROR:` summary) lands at the END, so head-only truncation would
 * discard it. This keeps both ends and reports how much was dropped.
 */
export class BoundedCapture {
  private head = '';
  private tail = '';
  private readonly headLimit: number;
  private readonly tailLimit: number;
  private total = 0;

  constructor(maxOutput: number) {
    const cap = Math.max(2, maxOutput);
    // Bias toward the tail — that's where the real error usually is.
    this.headLimit = Math.floor(cap * 0.4);
    this.tailLimit = cap - this.headLimit;
  }

  push(text: string): void {
    if (!text) return;
    this.total += text.length;
    if (this.head.length < this.headLimit) {
      const room = this.headLimit - this.head.length;
      this.head += text.slice(0, room);
      text = text.slice(room);
    }
    if (!text) return;
    this.tail += text;
    if (this.tail.length > this.tailLimit) {
      this.tail = this.tail.slice(this.tail.length - this.tailLimit);
    }
  }

  get truncated(): boolean {
    return this.total > this.headLimit + this.tailLimit;
  }

  get bytesDropped(): number {
    return Math.max(0, this.total - this.headLimit - this.tailLimit);
  }

  result(): string {
    if (!this.truncated) return this.head + this.tail;
    return `${this.head}\n…[${this.bytesDropped} characters dropped — showing head + tail]…\n${this.tail}`;
  }
}

function classifyClose(timedOut: boolean, exitCode: number | null, signal: NodeJS.Signals | null): FailureKind {
  if (timedOut) return 'timeout';
  if (exitCode === 0) return 'ok';
  if (exitCode === null && signal) return 'signal';
  return 'nonzero-exit';
}

export function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions,
): Promise<CommandResult> {
  const timeoutSeconds = Math.max(1, Number(options.timeoutSeconds || 600));
  const timeoutMs = timeoutSeconds * 1000;
  const started = Date.now();

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const combined = new BoundedCapture(options.maxOutput);
    const stdoutCap = new BoundedCapture(options.maxOutput);
    const stderrCap = new BoundedCapture(options.maxOutput);
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      const text = stdoutDecoder.write(chunk);
      combined.push(text);
      stdoutCap.push(text);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = stderrDecoder.write(chunk);
      combined.push(text);
      stderrCap.push(text);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      const code = (err as NodeJS.ErrnoException).code;
      resolve({
        command,
        args,
        exitCode: -1,
        durationMs: Date.now() - started,
        output: String(err),
        truncated: false,
        stdout: '',
        stderr: String(err),
        failureKind: 'spawn-error',
        spawnErrorCode: code,
        timeoutSeconds,
        id: options.id,
      });
    });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      const flushOut = stdoutDecoder.end();
      const flushErr = stderrDecoder.end();
      if (flushOut) { combined.push(flushOut); stdoutCap.push(flushOut); }
      if (flushErr) { combined.push(flushErr); stderrCap.push(flushErr); }
      resolve({
        command,
        args,
        exitCode: exitCode ?? -1,
        signal,
        durationMs: Date.now() - started,
        output: combined.result(),
        truncated: combined.truncated,
        stdout: stdoutCap.result(),
        stderr: stderrCap.result(),
        failureKind: classifyClose(timedOut, exitCode, signal),
        timedOut: timedOut || undefined,
        timeoutSeconds,
        bytesDropped: combined.bytesDropped || undefined,
        id: options.id,
      });
    });
  });
}

export async function* runCommandStreaming(
  command: string,
  args: string[],
  options: RunCommandOptions,
): AsyncGenerator<StreamChunk | CommandResult> {
  const timeoutSeconds = Math.max(1, Number(options.timeoutSeconds || 600));
  const timeoutMs = timeoutSeconds * 1000;
  const started = Date.now();

  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const combined = new BoundedCapture(options.maxOutput);
  const stdoutCap = new BoundedCapture(options.maxOutput);
  const stderrCap = new BoundedCapture(options.maxOutput);
  const stdoutDecoder = new StringDecoder('utf8');
  const stderrDecoder = new StringDecoder('utf8');
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
  }, timeoutMs);

  type QueueItem = StreamChunk | { type: 'error'; error: Error } | { type: 'close'; exitCode: number | null; signal?: NodeJS.Signals | null };
  const queue: QueueItem[] = [];
  let resolve: (() => void) | null = null;
  let done = false;

  const push = (item: QueueItem) => {
    queue.push(item);
    if (resolve) {
      resolve();
      resolve = null;
    }
  };

  child.stdout.on('data', (chunk: Buffer) => {
    const data = stdoutDecoder.write(chunk);
    if (!data) return;
    combined.push(data);
    stdoutCap.push(data);
    push({ stream: 'stdout', data });
  });
  child.stderr.on('data', (chunk: Buffer) => {
    const data = stderrDecoder.write(chunk);
    if (!data) return;
    combined.push(data);
    stderrCap.push(data);
    push({ stream: 'stderr', data });
  });
  child.on('error', (err) => {
    clearTimeout(timer);
    done = true;
    push({ type: 'error', error: err });
  });
  child.on('close', (exitCode, signal) => {
    clearTimeout(timer);
    const flushOut = stdoutDecoder.end();
    const flushErr = stderrDecoder.end();
    if (flushOut) { combined.push(flushOut); stdoutCap.push(flushOut); }
    if (flushErr) { combined.push(flushErr); stderrCap.push(flushErr); }
    done = true;
    push({ type: 'close', exitCode, signal });
  });

  while (true) {
    while (queue.length > 0) {
      const item = queue.shift()!;
      if ('stream' in item) {
        yield item as StreamChunk;
      } else if ('type' in item && item.type === 'error') {
        const code = (item.error as NodeJS.ErrnoException).code;
        yield {
          command,
          args,
          exitCode: -1,
          durationMs: Date.now() - started,
          output: String(item.error),
          truncated: false,
          stdout: '',
          stderr: String(item.error),
          failureKind: 'spawn-error',
          spawnErrorCode: code,
          timeoutSeconds,
          id: options.id,
        } satisfies CommandResult;
        return;
      } else if ('type' in item && item.type === 'close') {
        yield {
          command,
          args,
          exitCode: item.exitCode ?? -1,
          signal: item.signal,
          durationMs: Date.now() - started,
          output: combined.result(),
          truncated: combined.truncated,
          stdout: stdoutCap.result(),
          stderr: stderrCap.result(),
          failureKind: classifyClose(timedOut, item.exitCode, item.signal ?? null),
          timedOut: timedOut || undefined,
          timeoutSeconds,
          bytesDropped: combined.bytesDropped || undefined,
          id: options.id,
        } satisfies CommandResult;
        return;
      }
    }
    if (done && queue.length === 0) return;
    await new Promise<void>((r) => { resolve = r; });
  }
}
