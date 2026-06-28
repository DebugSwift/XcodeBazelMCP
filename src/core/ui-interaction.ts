import type { CommandResult } from '../types/index.js';
import { runCommand } from '../utils/process.js';

export type SwipeDirection = 'up' | 'down' | 'left' | 'right';

export interface TapOptions {
  simulatorUdid: string;
  x: number;
  y: number;
}

export interface DoubleTapOptions {
  simulatorUdid: string;
  x: number;
  y: number;
}

export interface LongPressOptions {
  simulatorUdid: string;
  x: number;
  y: number;
  durationSeconds?: number;
}

export interface SwipeOptions {
  simulatorUdid: string;
  direction: SwipeDirection;
  x?: number;
  y?: number;
  distance?: number;
  velocity?: number;
}

export interface PinchOptions {
  simulatorUdid: string;
  x: number;
  y: number;
  scale: number;
  velocity?: number;
}

export interface TypeTextOptions {
  simulatorUdid: string;
  text: string;
}

export interface KeyPressOptions {
  simulatorUdid: string;
  key: string;
}

export interface DragOptions {
  simulatorUdid: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  durationSeconds?: number;
}

let _idbPath: string | null | undefined;

async function findIdb(): Promise<string | null> {
  if (_idbPath !== undefined) return _idbPath;
  const envPath = process.env.IDB_PATH;
  if (envPath) { _idbPath = envPath; return envPath; }
  try {
    const result = await runCommand('which', ['idb'], { cwd: process.cwd(), timeoutSeconds: 5, maxOutput: 1000 });
    _idbPath = result.exitCode === 0 ? result.output.trim() : null;
  } catch {
    _idbPath = null;
  }
  return _idbPath;
}

async function idbCommand(args: string[], timeout = 15): Promise<CommandResult> {
  const idb = await findIdb();
  if (!idb) throw new Error('idb (Facebook IDB) not found. Install with: brew install idb-companion');
  return runCommand(idb, args, { cwd: process.cwd(), timeoutSeconds: timeout, maxOutput: 200_000 });
}

function swiftTouchScript(actions: string): string {
  return `
import CoreGraphics
import Foundation

func mouseEvent(_ type: CGEventType, _ x: Double, _ y: Double) {
    guard let e = CGEvent(mouseEventSource: nil, mouseType: type,
                          mouseCursorPosition: CGPoint(x: x, y: y),
                          mouseButton: .left) else { return }
    e.post(tap: .cghidEventTap)
}

func tap(_ x: Double, _ y: Double) {
    mouseEvent(.mouseMoved, x, y)
    usleep(10_000)
    mouseEvent(.leftMouseDown, x, y)
    usleep(50_000)
    mouseEvent(.leftMouseUp, x, y)
}

func drag(_ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double,
          duration: Double = 0.3, steps: Int = 10) {
    mouseEvent(.leftMouseDown, x1, y1)
    for i in 1...steps {
        let t = Double(i) / Double(steps)
        mouseEvent(.leftMouseDragged, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)
        usleep(UInt32(duration / Double(steps) * 1_000_000))
    }
    mouseEvent(.leftMouseUp, x2, y2)
}

let p = Process()
p.executableURL = URL(fileURLWithPath: "/usr/bin/open")
p.arguments = ["-a", "Simulator"]
try? p.run()
p.waitUntilExit()
usleep(300_000)

${actions}
print("ok")
`.trim();
}

function runSwift(script: string, timeout = 15): Promise<CommandResult> {
  return runCommand('swift', ['-e', script], {
    cwd: process.cwd(),
    timeoutSeconds: timeout,
    maxOutput: 50_000,
  });
}

export async function simulatorTap(options: TapOptions): Promise<CommandResult> {
  const idb = await findIdb();
  if (idb) {
    return idbCommand(['ui', 'tap', '--udid', options.simulatorUdid, '--', String(options.x), String(options.y)]);
  }
  return runSwift(swiftTouchScript(`tap(${options.x}, ${options.y})`));
}

export async function simulatorDoubleTap(options: DoubleTapOptions): Promise<CommandResult> {
  const idb = await findIdb();
  if (idb) {
    const r1 = await idbCommand(['ui', 'tap', '--udid', options.simulatorUdid, '--', String(options.x), String(options.y)]);
    if (r1.exitCode !== 0) return r1;
    await new Promise(r => setTimeout(r, 80));
    return idbCommand(['ui', 'tap', '--udid', options.simulatorUdid, '--', String(options.x), String(options.y)]);
  }
  return runSwift(swiftTouchScript(`
tap(${options.x}, ${options.y})
usleep(80_000)
tap(${options.x}, ${options.y})
`));
}

export async function simulatorLongPress(options: LongPressOptions): Promise<CommandResult> {
  const dur = options.durationSeconds ?? 1.0;
  const idb = await findIdb();
  if (idb) {
    return idbCommand([
      'ui', 'tap', '--udid', options.simulatorUdid,
      '--duration', String(dur),
      '--', String(options.x), String(options.y),
    ], Math.ceil(dur) + 10);
  }
  const usec = Math.round(dur * 1_000_000);
  return runSwift(swiftTouchScript(`
mouseEvent(.leftMouseDown, ${options.x}, ${options.y})
usleep(${usec})
mouseEvent(.leftMouseUp, ${options.x}, ${options.y})
`), Math.ceil(dur) + 10);
}

export async function simulatorSwipe(options: SwipeOptions): Promise<CommandResult> {
  const cx = options.x ?? 200;
  const cy = options.y ?? 400;
  const dist = options.distance ?? 300;

  let fx = cx, fy = cy, tx = cx, ty = cy;
  switch (options.direction) {
    case 'up':    fy = cy + dist / 2; ty = cy - dist / 2; break;
    case 'down':  fy = cy - dist / 2; ty = cy + dist / 2; break;
    case 'left':  fx = cx + dist / 2; tx = cx - dist / 2; break;
    case 'right': fx = cx - dist / 2; tx = cx + dist / 2; break;
  }

  const idb = await findIdb();
  if (idb) {
    return idbCommand([
      'ui', 'swipe', '--udid', options.simulatorUdid,
      '--', String(fx), String(fy), String(tx), String(ty),
    ]);
  }
  return runSwift(swiftTouchScript(`drag(${fx}, ${fy}, ${tx}, ${ty}, duration: 0.3, steps: 15)`));
}

export async function simulatorPinch(options: PinchOptions): Promise<CommandResult> {
  return runSwift(swiftTouchScript(`
// Pinch requires multi-touch HID — approximated with a tap at center
tap(${options.x}, ${options.y})
`));
}

export async function simulatorTypeText(options: TypeTextOptions): Promise<CommandResult> {
  const idb = await findIdb();
  if (idb) {
    return idbCommand(['ui', 'text', '--udid', options.simulatorUdid, '--', options.text]);
  }
  const escaped = options.text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script = `
tell application "Simulator"
  activate
end tell
delay 0.2
tell application "System Events"
  keystroke "${escaped}"
end tell
`.trim();
  return runCommand('osascript', ['-e', script], {
    cwd: process.cwd(),
    timeoutSeconds: 30,
    maxOutput: 50_000,
  });
}

export async function simulatorKeyPress(options: KeyPressOptions): Promise<CommandResult> {
  const idb = await findIdb();
  if (idb) {
    const idbKeyMap: Record<string, string> = {
      'Return': '40', 'Escape': '41', 'Delete': '42', 'Tab': '43',
      'Space': '44', 'Up': '82', 'Down': '81', 'Left': '80', 'Right': '79',
    };
    const hid = idbKeyMap[options.key];
    if (hid) {
      return idbCommand(['ui', 'key', '--udid', options.simulatorUdid, '--', hid]);
    }
    if (options.key === 'Home') {
      return idbCommand(['ui', 'button', '--udid', options.simulatorUdid, '--', 'HOME']);
    }
    return idbCommand(['ui', 'text', '--udid', options.simulatorUdid, '--', options.key]);
  }

  const keyCodeMap: Record<string, number> = {
    'Return': 36, 'Escape': 53, 'Tab': 48, 'Delete': 51,
    'Space': 49, 'Up': 126, 'Down': 125, 'Left': 123, 'Right': 124,
  };

  if (options.key === 'Home') {
    const script = `
tell application "Simulator"
  activate
end tell
delay 0.2
tell application "System Events"
  key code 115 using {shift down, command down}
end tell
`.trim();
    return runCommand('osascript', ['-e', script], {
      cwd: process.cwd(),
      timeoutSeconds: 10,
      maxOutput: 50_000,
    });
  }

  const code = keyCodeMap[options.key];
  if (code !== undefined) {
    const script = `
tell application "Simulator"
  activate
end tell
delay 0.2
tell application "System Events"
  key code ${code}
end tell
`.trim();
    return runCommand('osascript', ['-e', script], {
      cwd: process.cwd(),
      timeoutSeconds: 10,
      maxOutput: 50_000,
    });
  }

  const escaped = options.key.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script = `
tell application "Simulator"
  activate
end tell
delay 0.2
tell application "System Events"
  keystroke "${escaped}"
end tell
`.trim();
  return runCommand('osascript', ['-e', script], {
    cwd: process.cwd(),
    timeoutSeconds: 10,
    maxOutput: 50_000,
  });
}

export async function simulatorDrag(options: DragOptions): Promise<CommandResult> {
  const dur = options.durationSeconds ?? 0.5;
  const idb = await findIdb();
  if (idb) {
    return idbCommand([
      'ui', 'swipe', '--udid', options.simulatorUdid,
      '--duration', String(dur),
      '--', String(options.fromX), String(options.fromY), String(options.toX), String(options.toY),
    ], Math.ceil(dur) + 10);
  }
  return runSwift(swiftTouchScript(
    `drag(${options.fromX}, ${options.fromY}, ${options.toX}, ${options.toY}, duration: ${dur}, steps: 15)`
  ), Math.ceil(dur) + 10);
}

export async function simulatorAccessibilitySnapshot(
  simulatorUdid: string,
): Promise<{ command: CommandResult; tree?: string }> {
  const idb = await findIdb();
  if (idb) {
    const command = await idbCommand(['ui', 'describe-all', '--udid', simulatorUdid], 15);
    return {
      command,
      // idb writes the JSON tree to stdout; prefer it so idb stderr noise can't
      // corrupt the tree passed back to the caller.
      tree: command.exitCode === 0 ? (command.stdout || command.output) : undefined,
    };
  }

  const command = await runCommand(
    'xcrun',
    ['simctl', 'listapps', simulatorUdid],
    { cwd: process.cwd(), timeoutSeconds: 10, maxOutput: 200_000 },
  );

  return {
    command,
    tree: command.exitCode === 0
      ? `Installed apps on simulator (full a11y tree requires Accessibility Inspector or XCTest):\n${command.output}`
      : undefined,
  };
}

export function swipeDirectionFromString(dir: string): SwipeDirection {
  const d = dir.toLowerCase();
  if (d === 'up' || d === 'down' || d === 'left' || d === 'right') return d;
  throw new Error(`Invalid swipe direction: "${dir}". Must be up, down, left, or right.`);
}
