import { describe, it, expect } from 'vitest';
import { WORKFLOWS, DEFAULT_WORKFLOWS, validateWorkflowIds, getEnabledToolNames, compactToolSchema } from './workflows.js';
import { bazelToolDefinitions } from '../tools/bazel-tools.js';

// Tools intentionally always advertised regardless of workflow filtering.
const ALWAYS_ON = new Set(['bazel_list_workflows', 'bazel_toggle_workflow']);

describe('workflow registry integrity', () => {
  const registered = new Set(bazelToolDefinitions.map((t) => t.name));
  const workflowTools = WORKFLOWS.flatMap((w) => w.tools);

  it('every workflow tool maps to a real registered tool', () => {
    const unknown = workflowTools.filter((name) => !registered.has(name));
    expect(unknown, `workflow lists tools that don't exist: ${unknown.join(', ')}`).toEqual([]);
  });

  it('every registered tool belongs to exactly one workflow (or is always-on)', () => {
    const counts = new Map<string, number>();
    for (const name of workflowTools) counts.set(name, (counts.get(name) ?? 0) + 1);

    const uncategorized = [...registered].filter((name) => !ALWAYS_ON.has(name) && !counts.has(name));
    expect(uncategorized, `tools not in any workflow (invisible to filtered clients): ${uncategorized.join(', ')}`).toEqual([]);

    const duplicated = [...counts.entries()].filter(([, c]) => c > 1).map(([n]) => n);
    expect(duplicated, `tools listed in multiple workflows: ${duplicated.join(', ')}`).toEqual([]);
  });

  it('workflow ids are unique', () => {
    const ids = WORKFLOWS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('DEFAULT_WORKFLOWS reference real workflow ids', () => {
    expect(() => validateWorkflowIds(DEFAULT_WORKFLOWS)).not.toThrow();
  });

  it('getEnabledToolNames keeps always-on meta tools even when filtered', () => {
    const enabled = getEnabledToolNames(['build']);
    expect(enabled).not.toBeNull();
    for (const name of ALWAYS_ON) expect(enabled!.has(name)).toBe(true);
  });

  it('getEnabledToolNames always exposes defaults management + health', () => {
    const enabled = getEnabledToolNames(['build'])!;
    expect(enabled.has('bazel_ios_set_defaults')).toBe(true);
    expect(enabled.has('bazel_ios_show_defaults')).toBe(true);
    expect(enabled.has('bazel_ios_health')).toBe(true);
    expect(enabled.has('bazel_ios_set_workspace')).toBe(true);
  });
});

describe('compactToolSchema', () => {
  it('strips property descriptions but preserves enum and required', () => {
    const compact = compactToolSchema({
      name: 'x',
      description: 'desc',
      inputSchema: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['a', 'b'], description: 'drop me' },
        },
        required: ['mode'],
      },
    });
    const props = compact.inputSchema.properties as Record<string, Record<string, unknown>>;
    expect(props.mode.description).toBeUndefined();
    expect(props.mode.enum).toEqual(['a', 'b']);
    expect(compact.inputSchema.required).toEqual(['mode']);
    expect(compact.description).toBe('desc');
  });
});
