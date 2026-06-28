import type { JsonObject, ToolCallResult, ToolDefinition } from '../../types/index.js';
import { resolveSimulatorFromArgs, prependWarning, numberOrUndefined, requireFiniteNumber } from '../helpers.js';
import {
  simulatorTap, simulatorDoubleTap, simulatorLongPress,
  simulatorSwipe, simulatorPinch, simulatorTypeText,
  simulatorKeyPress, simulatorDrag, simulatorAccessibilitySnapshot,
  swipeDirectionFromString,
} from '../../core/ui-interaction.js';
import { toolText, formatCommandResult } from '../../utils/output.js';

export const definitions: ToolDefinition[] = [
  {
    name: 'bazel_ios_tap',
    description: 'Simulate a tap at screen coordinates on the simulator.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate (points).' },
        y: { type: 'number', description: 'Y coordinate (points).' },
        simulatorId: { type: 'string', description: 'Simulator UDID. Auto-resolves if omitted.' },
        simulatorName: { type: 'string', description: 'Simulator name (e.g. "iPhone 16 Pro").' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'bazel_ios_double_tap',
    description: 'Simulate a double-tap at screen coordinates on the simulator.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate (points).' },
        y: { type: 'number', description: 'Y coordinate (points).' },
        simulatorId: { type: 'string', description: 'Simulator UDID.' },
        simulatorName: { type: 'string', description: 'Simulator name.' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'bazel_ios_long_press',
    description: 'Simulate a long press at screen coordinates on the simulator.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate (points).' },
        y: { type: 'number', description: 'Y coordinate (points).' },
        durationSeconds: { type: 'number', description: 'Press duration in seconds (default: 1.0).' },
        simulatorId: { type: 'string', description: 'Simulator UDID.' },
        simulatorName: { type: 'string', description: 'Simulator name.' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'bazel_ios_swipe',
    description: 'Simulate a swipe gesture on the simulator.',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Swipe direction.' },
        x: { type: 'number', description: 'Start X coordinate (default: center).' },
        y: { type: 'number', description: 'Start Y coordinate (default: center).' },
        distance: { type: 'number', description: 'Swipe distance in points (default: 300).' },
        velocity: { type: 'number', description: 'Swipe velocity in points/sec (default: 1500).' },
        simulatorId: { type: 'string', description: 'Simulator UDID.' },
        simulatorName: { type: 'string', description: 'Simulator name.' },
      },
      required: ['direction'],
    },
  },
  {
    name: 'bazel_ios_pinch',
    description: 'Simulate a pinch (zoom) gesture on the simulator. Requires idb for true multi-touch; without idb the CGEvent fallback only approximates with a tap.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Center X coordinate (points).' },
        y: { type: 'number', description: 'Center Y coordinate (points).' },
        scale: { type: 'number', description: 'Scale factor. >1 = zoom in, <1 = zoom out.' },
        velocity: { type: 'number', description: 'Pinch velocity (default: 5).' },
        simulatorId: { type: 'string', description: 'Simulator UDID.' },
        simulatorName: { type: 'string', description: 'Simulator name.' },
      },
      required: ['x', 'y', 'scale'],
    },
  },
  {
    name: 'bazel_ios_type_text',
    description: 'Type text into the focused field on the simulator.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type.' },
        simulatorId: { type: 'string', description: 'Simulator UDID.' },
        simulatorName: { type: 'string', description: 'Simulator name.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'bazel_ios_key_press',
    description: 'Send a key press event to the simulator (e.g. Return, Escape, Tab, Space, Delete, arrows, Home).',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key name: Return, Escape, Tab, Space, Delete, Up, Down, Left, Right, or Home. Other values are typed as literal text.' },
        simulatorId: { type: 'string', description: 'Simulator UDID.' },
        simulatorName: { type: 'string', description: 'Simulator name.' },
      },
      required: ['key'],
    },
  },
  {
    name: 'bazel_ios_drag',
    description: 'Simulate a drag gesture from one point to another on the simulator.',
    inputSchema: {
      type: 'object',
      properties: {
        fromX: { type: 'number', description: 'Start X coordinate.' },
        fromY: { type: 'number', description: 'Start Y coordinate.' },
        toX: { type: 'number', description: 'End X coordinate.' },
        toY: { type: 'number', description: 'End Y coordinate.' },
        durationSeconds: { type: 'number', description: 'Drag duration in seconds (default: 0.5).' },
        simulatorId: { type: 'string', description: 'Simulator UDID.' },
        simulatorName: { type: 'string', description: 'Simulator name.' },
      },
      required: ['fromX', 'fromY', 'toX', 'toY'],
    },
  },
  {
    name: 'bazel_ios_accessibility_snapshot',
    description: 'Capture the accessibility element tree of the current simulator screen. Useful for finding tap targets and verifying UI state.',
    inputSchema: {
      type: 'object',
      properties: {
        simulatorId: { type: 'string', description: 'Simulator UDID.' },
        simulatorName: { type: 'string', description: 'Simulator name.' },
      },
    },
  },
];

const HANDLED = new Set(definitions.map(d => d.name));

export function canHandle(name: string): boolean {
  return HANDLED.has(name);
}

export async function handle(name: string, args: JsonObject): Promise<ToolCallResult | undefined> {
  switch (name) {
    case 'bazel_ios_tap': {
      const x = requireFiniteNumber(args.x, 'x');
      const y = requireFiniteNumber(args.y, 'y');
      const { sim, warning: simWarning } = await resolveSimulatorFromArgs(args);
      const result = await simulatorTap({ simulatorUdid: sim.udid, x, y });
      const msg = result.exitCode === 0 ? `Tapped at (${args.x}, ${args.y}) on ${sim.name}.` : formatCommandResult(result);
      return toolText(prependWarning(msg, simWarning), result.exitCode !== 0);
    }
    case 'bazel_ios_double_tap': {
      const x = requireFiniteNumber(args.x, 'x');
      const y = requireFiniteNumber(args.y, 'y');
      const { sim, warning: simWarning } = await resolveSimulatorFromArgs(args);
      const result = await simulatorDoubleTap({ simulatorUdid: sim.udid, x, y });
      const msg = result.exitCode === 0 ? `Double-tapped at (${args.x}, ${args.y}) on ${sim.name}.` : formatCommandResult(result);
      return toolText(prependWarning(msg, simWarning), result.exitCode !== 0);
    }
    case 'bazel_ios_long_press': {
      const x = requireFiniteNumber(args.x, 'x');
      const y = requireFiniteNumber(args.y, 'y');
      const { sim, warning: simWarning } = await resolveSimulatorFromArgs(args);
      const duration = numberOrUndefined(args.durationSeconds);
      const result = await simulatorLongPress({ simulatorUdid: sim.udid, x, y, durationSeconds: duration });
      const msg = result.exitCode === 0 ? `Long-pressed at (${args.x}, ${args.y}) for ${duration ?? 1.0}s on ${sim.name}.` : formatCommandResult(result);
      return toolText(prependWarning(msg, simWarning), result.exitCode !== 0);
    }
    case 'bazel_ios_swipe': {
      const { sim, warning: simWarning } = await resolveSimulatorFromArgs(args);
      const dir = swipeDirectionFromString(args.direction as string);
      const result = await simulatorSwipe({
        simulatorUdid: sim.udid,
        direction: dir,
        x: numberOrUndefined(args.x),
        y: numberOrUndefined(args.y),
        distance: numberOrUndefined(args.distance),
        velocity: numberOrUndefined(args.velocity),
      });
      const msg = result.exitCode === 0 ? `Swiped ${dir} on ${sim.name}.` : formatCommandResult(result);
      return toolText(prependWarning(msg, simWarning), result.exitCode !== 0);
    }
    case 'bazel_ios_pinch': {
      const x = requireFiniteNumber(args.x, 'x');
      const y = requireFiniteNumber(args.y, 'y');
      const scale = requireFiniteNumber(args.scale, 'scale');
      const { sim, warning: simWarning } = await resolveSimulatorFromArgs(args);
      const result = await simulatorPinch({
        simulatorUdid: sim.udid,
        x,
        y,
        scale,
        velocity: numberOrUndefined(args.velocity),
      });
      const label = scale > 1 ? 'zoom in' : 'zoom out';
      const msg = result.exitCode === 0 ? `Pinch ${label} (scale=${args.scale}) at (${args.x}, ${args.y}) on ${sim.name}.` : formatCommandResult(result);
      return toolText(prependWarning(msg, simWarning), result.exitCode !== 0);
    }
    case 'bazel_ios_type_text': {
      const { sim, warning: simWarning } = await resolveSimulatorFromArgs(args);
      const result = await simulatorTypeText({ simulatorUdid: sim.udid, text: args.text as string });
      const msg = result.exitCode === 0 ? `Typed "${args.text}" on ${sim.name}.` : formatCommandResult(result);
      return toolText(prependWarning(msg, simWarning), result.exitCode !== 0);
    }
    case 'bazel_ios_key_press': {
      const { sim, warning: simWarning } = await resolveSimulatorFromArgs(args);
      const result = await simulatorKeyPress({ simulatorUdid: sim.udid, key: args.key as string });
      const msg = result.exitCode === 0 ? `Pressed key "${args.key}" on ${sim.name}.` : formatCommandResult(result);
      return toolText(prependWarning(msg, simWarning), result.exitCode !== 0);
    }
    case 'bazel_ios_drag': {
      const fromX = requireFiniteNumber(args.fromX, 'fromX');
      const fromY = requireFiniteNumber(args.fromY, 'fromY');
      const toX = requireFiniteNumber(args.toX, 'toX');
      const toY = requireFiniteNumber(args.toY, 'toY');
      const { sim, warning: simWarning } = await resolveSimulatorFromArgs(args);
      const result = await simulatorDrag({
        simulatorUdid: sim.udid,
        fromX,
        fromY,
        toX,
        toY,
        durationSeconds: numberOrUndefined(args.durationSeconds),
      });
      const msg = result.exitCode === 0 ? `Dragged from (${args.fromX}, ${args.fromY}) to (${args.toX}, ${args.toY}) on ${sim.name}.` : formatCommandResult(result);
      return toolText(prependWarning(msg, simWarning), result.exitCode !== 0);
    }
    case 'bazel_ios_accessibility_snapshot': {
      const { sim, warning: simWarning } = await resolveSimulatorFromArgs(args);
      const { command, tree } = await simulatorAccessibilitySnapshot(sim.udid);
      if (command.exitCode !== 0) {
        return toolText(prependWarning(formatCommandResult(command), simWarning), true);
      }
      return toolText(prependWarning(tree || '(empty)', simWarning), false);
    }
    default:
      return undefined;
  }
}
