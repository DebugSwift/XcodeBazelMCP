import { beforeEach, describe, it, expect, afterEach, vi } from 'vitest';
import {
  stringOrUndefined,
  numberOrUndefined,
  prependWarning,
  applyDefaults,
  nextLogCaptureId,
  nextVideoRecordingId,
  resolveSimulatorFromArgs,
} from './helpers.js';
import { clearDefaults, setDefaults } from '../runtime/config.js';

vi.mock('../core/simulators.js', () => ({
  resolveSimulator: vi.fn(),
}));

const { resolveSimulator } = await import('../core/simulators.js');
const mockResolveSimulator = vi.mocked(resolveSimulator);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('stringOrUndefined', () => {
  it('returns string for string input', () => expect(stringOrUndefined('hello')).toBe('hello'));
  it('returns undefined for number', () => expect(stringOrUndefined(42)).toBeUndefined());
  it('returns undefined for boolean', () => expect(stringOrUndefined(true)).toBeUndefined());
  it('returns undefined for null', () => expect(stringOrUndefined(null)).toBeUndefined());
  it('returns undefined for undefined', () => expect(stringOrUndefined(undefined)).toBeUndefined());
  it('returns undefined for object', () => expect(stringOrUndefined({ a: 1 })).toBeUndefined());
});

describe('numberOrUndefined', () => {
  it('returns number for number input', () => expect(numberOrUndefined(42)).toBe(42));
  it('returns undefined for string', () => expect(numberOrUndefined('42')).toBeUndefined());
  it('returns undefined for boolean', () => expect(numberOrUndefined(false)).toBeUndefined());
  it('returns undefined for null', () => expect(numberOrUndefined(null)).toBeUndefined());
  it('returns undefined for undefined', () => expect(numberOrUndefined(undefined)).toBeUndefined());
});

describe('prependWarning', () => {
  it('returns message when no warning', () => expect(prependWarning('ok')).toBe('ok'));
  it('prepends warning', () => expect(prependWarning('ok', 'warn')).toBe('warn\n\nok'));
});

describe('applyDefaults', () => {
  afterEach(() => clearDefaults());

  it('returns args with streaming=false when no defaults set', () => {
    clearDefaults();
    const args = { target: '//app' };
    expect(applyDefaults(args)).toEqual({ target: '//app', streaming: false });
  });

  it('merges target default when args.target is undefined', () => {
    setDefaults({ target: '//default' });
    expect(applyDefaults({})).toEqual({ target: '//default', streaming: false });
  });

  it('does NOT override explicitly provided target', () => {
    setDefaults({ target: '//default' });
    expect(applyDefaults({ target: '//explicit' })).toEqual({ target: '//explicit', streaming: false });
  });

  it('merges simulatorName', () => {
    setDefaults({ simulatorName: 'iPhone 15' });
    expect(applyDefaults({})).toEqual({ simulatorName: 'iPhone 15', streaming: false });
  });

  it('merges simulatorId', () => {
    setDefaults({ simulatorId: 'ABC-123' });
    expect(applyDefaults({})).toEqual({ simulatorId: 'ABC-123', streaming: false });
  });

  it('merges deviceName and deviceId', () => {
    setDefaults({ deviceName: 'My iPhone', deviceId: '00008110-ABC' });
    expect(applyDefaults({})).toEqual({
      deviceName: 'My iPhone',
      deviceId: '00008110-ABC',
      streaming: false,
    });
  });

  it('merges buildMode', () => {
    setDefaults({ buildMode: 'debug' });
    expect(applyDefaults({})).toEqual({ buildMode: 'debug', streaming: false });
  });

  it('merges platform', () => {
    setDefaults({ platform: 'simulator' });
    expect(applyDefaults({})).toEqual({ platform: 'simulator', streaming: false });
  });

  it('does NOT merge buildMode=none', () => {
    setDefaults({ buildMode: 'none' });
    expect(applyDefaults({})).toEqual({ streaming: false });
  });

  it('does NOT merge platform=none', () => {
    setDefaults({ platform: 'none' });
    expect(applyDefaults({})).toEqual({ streaming: false });
  });

  it('handles multiple defaults at once', () => {
    setDefaults({ target: '//app', simulatorName: 'iPhone 15', buildMode: 'debug', platform: 'simulator' });
    expect(applyDefaults({})).toEqual({
      target: '//app',
      simulatorName: 'iPhone 15',
      buildMode: 'debug',
      platform: 'simulator',
      streaming: false,
    });
  });

  it('merges streaming default from session', () => {
    setDefaults({ streaming: true });
    expect(applyDefaults({})).toEqual({ streaming: true });
  });

  it('does NOT override explicitly provided streaming', () => {
    setDefaults({ streaming: true });
    expect(applyDefaults({ streaming: false })).toEqual({ streaming: false });
  });
});

describe('nextLogCaptureId', () => {
  it('increments counter each call', () => {
    const id1 = nextLogCaptureId();
    const id2 = nextLogCaptureId();
    const id3 = nextLogCaptureId();
    expect(id2).toBe(id1 + 1);
    expect(id3).toBe(id2 + 1);
  });

  it('returns positive integers', () => {
    const id = nextLogCaptureId();
    expect(id).toBeGreaterThan(0);
    expect(Number.isInteger(id)).toBe(true);
  });
});

describe('nextVideoRecordingId', () => {
  it('increments counter each call', () => {
    const id1 = nextVideoRecordingId();
    const id2 = nextVideoRecordingId();
    const id3 = nextVideoRecordingId();
    expect(id2).toBe(id1 + 1);
    expect(id3).toBe(id2 + 1);
  });

  it('returns positive integers', () => {
    const id = nextVideoRecordingId();
    expect(id).toBeGreaterThan(0);
    expect(Number.isInteger(id)).toBe(true);
  });
});

describe('resolveSimulatorFromArgs', () => {
  it('calls resolveSimulator with simulatorId', async () => {
    const mockDevice = { name: 'iPhone 15', udid: 'ABC-123', runtime: 'iOS 17.0', state: 'Booted', isAvailable: true };
    mockResolveSimulator.mockResolvedValue({ device: mockDevice });

    const result = await resolveSimulatorFromArgs({ simulatorId: 'ABC-123' });

    expect(mockResolveSimulator).toHaveBeenCalledWith({ simulatorId: 'ABC-123', simulatorName: undefined });
    expect(result.sim).toEqual(mockDevice);
  });

  it('calls resolveSimulator with simulatorName', async () => {
    const mockDevice = { name: 'iPhone 15', udid: 'ABC-123', runtime: 'iOS 17.0', state: 'Booted', isAvailable: true };
    mockResolveSimulator.mockResolvedValue({ device: mockDevice });

    const result = await resolveSimulatorFromArgs({ simulatorName: 'iPhone 15' });

    expect(mockResolveSimulator).toHaveBeenCalledWith({ simulatorId: undefined, simulatorName: 'iPhone 15' });
    expect(result.sim).toEqual(mockDevice);
  });

  it('passes warning from resolveSimulator', async () => {
    const mockDevice = { name: 'iPhone 15', udid: 'ABC-123', runtime: 'iOS 17.0', state: 'Booted', isAvailable: true };
    mockResolveSimulator.mockResolvedValue({ device: mockDevice, warning: 'Multiple devices booted' });

    const result = await resolveSimulatorFromArgs({});

    expect(result.warning).toBe('Multiple devices booted');
  });

  it('filters out non-string simulatorId values', async () => {
    const mockDevice = { name: 'iPhone 15', udid: 'ABC-123', runtime: 'iOS 17.0', state: 'Booted', isAvailable: true };
    mockResolveSimulator.mockResolvedValue({ device: mockDevice });

    await resolveSimulatorFromArgs({ simulatorId: 123 });

    expect(mockResolveSimulator).toHaveBeenCalledWith({ simulatorId: undefined, simulatorName: undefined });
  });

  it('filters out non-string simulatorName values', async () => {
    const mockDevice = { name: 'iPhone 15', udid: 'ABC-123', runtime: 'iOS 17.0', state: 'Booted', isAvailable: true };
    mockResolveSimulator.mockResolvedValue({ device: mockDevice });

    await resolveSimulatorFromArgs({ simulatorName: true });

    expect(mockResolveSimulator).toHaveBeenCalledWith({ simulatorId: undefined, simulatorName: undefined });
  });
});
