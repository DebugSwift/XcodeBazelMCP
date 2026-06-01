import type { JsonObject } from '../types/index.js';

export const STREAMING_PROPERTY: JsonObject = {
  type: 'boolean',
  description:
    'Stream command output via MCP progress notifications. Defaults to false. Set true for live progress on long builds.',
  default: false,
};
