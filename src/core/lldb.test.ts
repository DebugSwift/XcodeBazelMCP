import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import {
  attachByName,
  attachToProcess,
  continueExecution,
  deleteBreakpoint,
  detach,
  evaluateExpression,
  getBacktrace,
  getSession,
  getThreadList,
  getVariables,
  killAllSessions,
  listBreakpoints,
  listSessions,
  runLldbCommand,
  selectFrame,
  selectThread,
  setBreakpoint,
  stepInto,
  stepOut,
  stepOver,
} from './lldb.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

const { spawn } = await import('node:child_process');
const mockSpawn = vi.mocked(spawn);

class MockChildProcess extends EventEmitter {
  stdin: {
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  stdout: EventEmitter;
  stderr: EventEmitter;
  killed = false;
  exitCode: number | null = null;
  pid?: number;

  constructor() {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.stdin = {
      write: vi.fn((input: string) => {
        const marker = input.match(/^script print\("(.+)"\)\n?$/);
        const output = marker ? `${marker[1]}\n` : `output for ${input.trim()}\n`;
        this.stdout.emit('data', Buffer.from(output));
        return true;
      }),
      end: vi.fn(),
    };
    this.pid = 12345;
    process.nextTick(() => {
      this.stdout.emit('data', Buffer.from('(lldb) '));
    });
  }

  kill() {
    this.killed = true;
    this.exitCode = 0;
    this.emit('exit', 0);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listSessions', () => {
  it('returns empty array when no sessions', () => {
    const sessions = listSessions();
    expect(sessions).toEqual([]);
  });

  it('returns active sessions', async () => {
    const mockChild = new MockChildProcess();
    mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

    const { sessionId } = await attachToProcess(1234, 'MyApp');

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const sessions = listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ sessionId, pid: 1234, processName: 'MyApp' });
  });
});

describe('killAllSessions', () => {
  it('terminates and clears every live session', async () => {
    const mockChild = new MockChildProcess();
    mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);
    await attachToProcess(1234, 'MyApp');
    expect(listSessions().length).toBeGreaterThan(0);

    killAllSessions();

    expect(mockChild.killed).toBe(true);
    expect(listSessions()).toEqual([]);
  });
});

describe('getSession', () => {
  it('throws when session not found', () => {
    expect(() => getSession('unknown-id')).toThrow('Unknown LLDB session');
  });

  it('returns session when found', async () => {
    const mockChild = new MockChildProcess();
    mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

    const { sessionId } = await attachToProcess(1234, 'MyApp');

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const session = getSession(sessionId);
    expect(session.pid).toBe(1234);
    expect(session.processName).toBe('MyApp');
  });
});

describe('attachToProcess', () => {
  it('spawns xcrun lldb', async () => {
    const mockChild = new MockChildProcess();
    mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

    const promise = attachToProcess(1234, 'MyApp');

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await promise;

    expect(mockSpawn).toHaveBeenCalledWith('xcrun', ['lldb', '--no-use-colors'], expect.any(Object));
  });

  it('sends attach command to lldb', async () => {
    const mockChild = new MockChildProcess();
    mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

    const promise = attachToProcess(1234, 'MyApp');

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await promise;

    expect(mockChild.stdin.write).toHaveBeenCalledWith('process attach --pid 1234\n');
  });

  it('returns session info', async () => {
    const mockChild = new MockChildProcess();
    mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

    const promise = attachToProcess(1234, 'MyApp', 'simulator');

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    const result = await promise;

    expect(result.sessionId).toMatch(/^lldb-\d+$/);
    expect(result.output).toContain('process attach --pid 1234');
  });
});

describe('attachByName', () => {
  it('sends attach -n command', async () => {
    const mockChild = new MockChildProcess();
    mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

    const promise = attachByName('MyApp', false, 'simulator');

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await promise;

    expect(mockChild.stdin.write).toHaveBeenCalledWith('process attach --name "MyApp"\n');
  });
});

describe('detach', () => {
  it('sends detach command', async () => {
    const mockChild = new MockChildProcess();
    mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

    const { sessionId } = await attachToProcess(1234, 'MyApp');

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const promise = detach(sessionId);

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await promise;

    expect(mockChild.stdin.write).toHaveBeenCalledWith('process detach\n');
  });
});

describe('setBreakpoint', () => {
  it('sends breakpoint set command with file and line', async () => {
    const mockChild = new MockChildProcess();
    mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

    const { sessionId } = await attachToProcess(1234, 'MyApp');

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const promise = setBreakpoint(sessionId, { file: 'main.swift', line: 42 });

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await promise;

    expect(mockChild.stdin.write).toHaveBeenCalledWith('breakpoint set --file "main.swift" --line 42\n');
  });

  it('evaluateExpression rejects a multi-line expression (injection guard)', async () => {
    const mockChild = new MockChildProcess();
    mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);
    const { sessionId } = await attachToProcess(1234, 'MyApp');
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(evaluateExpression(sessionId, 'foo\nprocess kill')).rejects.toThrow('single line');
  });

  it('rejects a file/symbol containing a newline or quote (injection guard)', async () => {
    const mockChild = new MockChildProcess();
    mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);
    const { sessionId } = await attachToProcess(1234, 'MyApp');
    await new Promise((resolve) => setTimeout(resolve, 50));

    await expect(setBreakpoint(sessionId, { file: 'a.swift"\nprocess kill' })).rejects.toThrow(
      'must not contain newlines or double quotes',
    );
    await expect(setBreakpoint(sessionId, { symbol: 'foo\nquit' })).rejects.toThrow(
      'must not contain newlines or double quotes',
    );
  });

  it('sends breakpoint set command with function name', async () => {
    const mockChild = new MockChildProcess();
    mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

    const { sessionId } = await attachToProcess(1234, 'MyApp');

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const promise = setBreakpoint(sessionId, { symbol: 'myFunction' });

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await promise;

    expect(mockChild.stdin.write).toHaveBeenCalledWith('breakpoint set --name "myFunction"\n');
  });
});

describe('deleteBreakpoint', () => {
  it('sends breakpoint delete command', async () => {
    const mockChild = new MockChildProcess();
    mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

    const { sessionId } = await attachToProcess(1234, 'MyApp');

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const promise = deleteBreakpoint(sessionId, 3);

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await promise;

    expect(mockChild.stdin.write).toHaveBeenCalledWith('breakpoint delete 3\n');
  });
});

describe('listBreakpoints', () => {
  it('sends breakpoint list command', async () => {
    const mockChild = new MockChildProcess();
    mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

    const { sessionId } = await attachToProcess(1234, 'MyApp');

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const promise = listBreakpoints(sessionId);

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await promise;

    expect(mockChild.stdin.write).toHaveBeenCalledWith('breakpoint list\n');
  });
});

describe('continueExecution', () => {
  it('sends continue command', async () => {
    const mockChild = new MockChildProcess();
    mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

    const { sessionId } = await attachToProcess(1234, 'MyApp');

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const promise = continueExecution(sessionId);

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await promise;

    expect(mockChild.stdin.write).toHaveBeenCalledWith('continue\n');
  });
});

describe('stepOver', () => {
  it('sends next command', async () => {
    const mockChild = new MockChildProcess();
    mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

    const { sessionId } = await attachToProcess(1234, 'MyApp');

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const promise = stepOver(sessionId);

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await promise;

    expect(mockChild.stdin.write).toHaveBeenCalledWith('next\n');
  });
});

describe('stepInto', () => {
  it('sends step command', async () => {
    const mockChild = new MockChildProcess();
    mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

    const { sessionId } = await attachToProcess(1234, 'MyApp');

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const promise = stepInto(sessionId);

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await promise;

    expect(mockChild.stdin.write).toHaveBeenCalledWith('step\n');
  });
});

describe('stepOut', () => {
  it('sends finish command', async () => {
    const mockChild = new MockChildProcess();
    mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

    const { sessionId } = await attachToProcess(1234, 'MyApp');

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const promise = stepOut(sessionId);

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await promise;

    expect(mockChild.stdin.write).toHaveBeenCalledWith('finish\n');
  });
});

describe('getBacktrace', () => {
  it('sends bt command', async () => {
    const mockChild = new MockChildProcess();
    mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

    const { sessionId } = await attachToProcess(1234, 'MyApp');

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const promise = getBacktrace(sessionId);

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await promise;

    expect(mockChild.stdin.write).toHaveBeenCalledWith('thread backtrace\n');
  });
});

describe('getVariables', () => {
  it('sends frame variable command', async () => {
    const mockChild = new MockChildProcess();
    mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

    const { sessionId } = await attachToProcess(1234, 'MyApp');

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const promise = getVariables(sessionId);

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await promise;

    expect(mockChild.stdin.write).toHaveBeenCalledWith('frame variable\n');
  });
});

describe('evaluateExpression', () => {
  it('sends expression command', async () => {
    const mockChild = new MockChildProcess();
    mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

    const { sessionId } = await attachToProcess(1234, 'MyApp');

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const promise = evaluateExpression(sessionId, 'myVariable + 10');

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await promise;

    expect(mockChild.stdin.write).toHaveBeenCalledWith('expression -- myVariable + 10\n');
  });
});

describe('getThreadList', () => {
  it('sends thread list command', async () => {
    const mockChild = new MockChildProcess();
    mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

    const { sessionId } = await attachToProcess(1234, 'MyApp');

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const promise = getThreadList(sessionId);

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await promise;

    expect(mockChild.stdin.write).toHaveBeenCalledWith('thread list\n');
  });
});

describe('selectThread', () => {
  it('sends thread select command', async () => {
    const mockChild = new MockChildProcess();
    mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

    const { sessionId } = await attachToProcess(1234, 'MyApp');

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const promise = selectThread(sessionId, 5);

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await promise;

    expect(mockChild.stdin.write).toHaveBeenCalledWith('thread select 5\n');
  });
});

describe('selectFrame', () => {
  it('sends frame select command', async () => {
    const mockChild = new MockChildProcess();
    mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

    const { sessionId } = await attachToProcess(1234, 'MyApp');

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const promise = selectFrame(sessionId, 2);

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await promise;

    expect(mockChild.stdin.write).toHaveBeenCalledWith('frame select 2\n');
  });
});

describe('runLldbCommand', () => {
  it('sends custom command', async () => {
    const mockChild = new MockChildProcess();
    mockSpawn.mockReturnValue(mockChild as unknown as ChildProcess);

    const { sessionId } = await attachToProcess(1234, 'MyApp');

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const promise = runLldbCommand(sessionId, 'settings list');

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('(lldb) '));
    }, 10);

    await promise;

    expect(mockChild.stdin.write).toHaveBeenCalledWith('settings list\n');
  });
});
