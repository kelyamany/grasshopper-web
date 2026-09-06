import type { ResthopperItem } from '@/lib/compute/types';

/**
 * Mid-level value model flowing between nodes during evaluation.
 *
 * Scalars are typed; geometry stays as raw Resthopper items (branch `{0}`)
 * so it can be handed straight to rhino3dm's CommonObject.decode.
 */

export type GeometryItem = ResthopperItem;

export type PortValue =
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'text'; value: string }
  | { kind: 'geometry'; items: GeometryItem[] }
  | { kind: 'empty' };

export function numberItem(value: number): ResthopperItem {
  // Compute deserializes System.Double from the JSON string; keep a decimal
  // point to be explicit about non-integer numbers.
  const data = Number.isInteger(value) ? `${value}.0` : String(value);
  return { type: 'System.Double', data };
}

export function integerItem(value: number): ResthopperItem {
  return { type: 'System.Int32', data: String(Math.trunc(value)) };
}

export function booleanItem(value: boolean): ResthopperItem {
  return { type: 'System.Boolean', data: value ? 'true' : 'false' };
}

export function textItem(value: string): ResthopperItem {
  return { type: 'System.String', data: JSON.stringify(value) };
}

/**
 * Parse a Resthopper item into a PortValue. Geometry type names
 * (Rhino.Geometry.*) and anything unrecognized that is not a plain .NET
 * scalar stay as raw geometry items for rhino3dm to decode.
 */
export function itemToPortValue(item: ResthopperItem): PortValue {
  const scalarKinds: Record<string, (data: string) => PortValue> = {
    'System.Double': (data) => ({ kind: 'number', value: Number(data) }),
    'System.Int32': (data) => ({ kind: 'number', value: Number(data) }),
    'System.Single': (data) => ({ kind: 'number', value: Number(data) }),
    'System.Boolean': (data) => ({ kind: 'boolean', value: data.trim().toLowerCase() === 'true' }),
    'System.String': (data) => {
      try {
        return { kind: 'text', value: JSON.parse(data) as string };
      } catch {
        return { kind: 'text', value: data };
      }
    },
  };
  const scalar = scalarKinds[item.type];
  if (scalar) {
    const value = scalar(item.data);
    if (Number.isNaN((value as { value: number }).value) && value.kind === 'number') {
      return { kind: 'geometry', items: [item] };
    }
    return value;
  }
  return { kind: 'geometry', items: [item] };
}

/** Flatten the first branch of a tree into items. */
export function firstBranchItems(
  tree: { InnerTree: Record<string, ResthopperItem[]> } | undefined,
): ResthopperItem[] {
  if (!tree) return [];
  const branch = tree.InnerTree?.['{0}'] ?? Object.values(tree.InnerTree ?? {})[0];
  return branch ?? [];
}

export function portValueLabel(value: PortValue): string {
  switch (value.kind) {
    case 'number':
      return formatNumber(value.value);
    case 'boolean':
      return value.value ? 'True' : 'False';
    case 'text':
      return value.value;
    case 'geometry':
      return `${value.items.length} item${value.items.length === 1 ? '' : 's'}`;
    default:
      return '—';
  }
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-3)) return value.toExponential(3);
  return String(Math.round(value * 1000) / 1000);
}
