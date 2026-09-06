import type { ResthopperItem, ResthopperTree } from '@/lib/compute/types';
import type { PortValue } from '@/lib/graph/values';

export type Vec3 = { X: number; Y: number; Z: number };
export type RuntimeValue =
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'text'; value: string }
  | { kind: 'point'; value: Vec3 }
  | { kind: 'vector'; value: Vec3 }
  | { kind: 'geometry'; type: string; value: unknown }
  | { kind: 'file'; name: string; mime: string; base64: string }
  | { kind: 'list'; items: RuntimeValue[] }
  | { kind: 'empty' };

export const EMPTY: RuntimeValue = { kind: 'empty' };

export function raw(value: RuntimeValue): unknown {
  switch (value.kind) {
    case 'number': case 'boolean': case 'text': return value.value;
    case 'point': case 'vector': return value.value;
    case 'geometry': return value.value;
    case 'file': return { name: value.name, mime: value.mime, base64: value.base64 };
    case 'list': return value.items.map(raw);
    default: return null;
  }
}

export function numberOf(value: RuntimeValue | undefined, fallback = 0): number {
  return value?.kind === 'number' ? value.value : fallback;
}

export function listOf(value: RuntimeValue | undefined): RuntimeValue[] {
  if (!value) return [];
  return value.kind === 'list' ? value.items : value.kind === 'empty' ? [] : [value];
}

export function filesOf(value: RuntimeValue | undefined): Extract<RuntimeValue, { kind: 'file' }>[] {
  if (!value) return [];
  if (value.kind === 'file') return [value];
  if (value.kind === 'list') return value.items.flatMap((item) => filesOf(item));
  return [];
}

export function wrapCompute(result: unknown, outputType: string): RuntimeValue {
  if (outputType === 'number') return { kind: 'number', value: Number(result) };
  if (outputType === 'boolean') return { kind: 'boolean', value: Boolean(result) };
  if (outputType === 'text') return { kind: 'text', value: String(result ?? '') };
  if (Array.isArray(result)) {
    const subtype = outputType.startsWith('list:') ? outputType.slice(5) : outputType;
    return { kind: 'list', items: result.map((item) => wrapCompute(item, subtype)) };
  }
  const short = outputType.replace(/^geometry:/, '') || 'GeometryBase';
  return { kind: 'geometry', type: `Rhino.Geometry.${short}`, value: result };
}

function itemFromRuntime(value: RuntimeValue): ResthopperItem | null {
  switch (value.kind) {
    case 'number': return { type: 'System.Double', data: Number.isInteger(value.value) ? `${value.value}.0` : String(value.value) };
    case 'boolean': return { type: 'System.Boolean', data: value.value ? 'true' : 'false' };
    case 'text': return { type: 'System.String', data: JSON.stringify(value.value) };
    case 'point': return { type: 'Rhino.Geometry.Point3d', data: JSON.stringify(value.value) };
    case 'vector': return { type: 'Rhino.Geometry.Vector3d', data: JSON.stringify(value.value) };
    case 'geometry': return { type: value.type, data: JSON.stringify(value.value) };
    default: return null;
  }
}

export function toResthopperTree(name: string, value: RuntimeValue): ResthopperTree {
  const items = listOf(value).map(itemFromRuntime).filter((item): item is ResthopperItem => Boolean(item));
  return { ParamName: name, InnerTree: { '{0}': items } };
}

export function fromResthopperItems(items: ResthopperItem[]): RuntimeValue {
  const parsed = items.map((item): RuntimeValue => {
    if (item.type === 'System.Double' || item.type === 'System.Single' || item.type === 'System.Int32') return { kind: 'number', value: Number(item.data) };
    if (item.type === 'System.Boolean') return { kind: 'boolean', value: item.data.toLowerCase() === 'true' };
    if (item.type === 'System.String') {
      try { return { kind: 'text', value: JSON.parse(item.data) as string }; } catch { return { kind: 'text', value: item.data }; }
    }
    let value: unknown = item.data;
    try { value = JSON.parse(item.data); } catch { /* keep text */ }
    return { kind: 'geometry', type: item.type, value };
  });
  if (parsed.length === 0) return EMPTY;
  return parsed.length === 1 ? parsed[0] : { kind: 'list', items: parsed };
}

export function runtimeToPreview(value: RuntimeValue | null): PortValue | null {
  if (!value || value.kind === 'empty') return { kind: 'empty' };
  if (value.kind === 'number' || value.kind === 'boolean' || value.kind === 'text') return value;
  const items: ResthopperItem[] = [];
  const visit = (v: RuntimeValue) => {
    if (v.kind === 'list') return v.items.forEach(visit);
    const item = itemFromRuntime(v);
    if (item && !item.type.startsWith('System.')) items.push(item);
  };
  visit(value);
  return items.length ? { kind: 'geometry', items } : { kind: 'empty' };
}

export function valueLabel(value: RuntimeValue | undefined): string {
  if (!value) return '';
  if (value.kind === 'number') return String(Math.round(value.value * 1000) / 1000);
  if (value.kind === 'boolean') return value.value ? 'True' : 'False';
  if (value.kind === 'text') return value.value;
  if (value.kind === 'point' || value.kind === 'vector') return `${value.value.X}, ${value.value.Y}, ${value.value.Z}`;
  if (value.kind === 'geometry') return value.type.replace('Rhino.Geometry.', '');
  if (value.kind === 'file') return value.name;
  if (value.kind === 'list') return `${value.items.length} items`;
  return '';
}
