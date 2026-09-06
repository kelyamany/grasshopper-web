import type { RuntimeValue } from '@/lib/graph/runtime';
import { getRhino } from '@/lib/geometry/rhino';
import { newId, type GraphNode } from '@/lib/graph/schema';

export type RuntimeKind = 'local' | 'compute' | 'hops' | 'display' | 'action';
export type PortType = 'number' | 'boolean' | 'text' | 'point' | 'vector' | 'curve' | 'surface' | 'brep' | 'mesh' | 'geometry' | 'list' | 'file';

export interface PortSpec {
  name: string;
  type: PortType;
  optional?: boolean;
  defaultValue?: unknown;
}

export interface ComputeSpec {
  endpoint: string;
  outputType: string;
  buildArgs?: (inputs: Record<string, RuntimeValue>) => unknown[];
}

export interface CatalogEvalServices {
  compute(endpoint: string, args: unknown[]): Promise<unknown>;
}

export interface CatalogEntry {
  id: string;
  name: string;
  nickname: string;
  category: string;
  subcategory: string;
  description: string;
  runtime: RuntimeKind;
  inputs: PortSpec[];
  outputs: PortSpec[];
  defaults?: Record<string, unknown>;
  compute?: ComputeSpec;
  keywords?: string[];
  evaluate?: (
    inputs: Record<string, RuntimeValue>,
    values: Record<string, unknown>,
    services: CatalogEvalServices,
  ) => Record<string, RuntimeValue> | Promise<Record<string, RuntimeValue>>;
}

const n = (value: RuntimeValue | undefined, fallback = 0) => value?.kind === 'number' ? value.value : fallback;
const list = (value: RuntimeValue | undefined) => value?.kind === 'list' ? value.items : value && value.kind !== 'empty' ? [value] : [];
const bool = (value: RuntimeValue | undefined, fallback = false) => value?.kind === 'boolean' ? value.value : fallback;
const text = (value: RuntimeValue | undefined, fallback = '') => value?.kind === 'text' ? value.value : fallback;
const point = (value: RuntimeValue | undefined) => value?.kind === 'point' ? value.value : { X: 0, Y: 0, Z: 0 };
const flatten = (value: RuntimeValue | undefined): RuntimeValue[] => list(value).flatMap(item => item.kind === 'list' ? flatten(item) : [item]);
const scalarText = (value: RuntimeValue | undefined) => {
  if (!value || value.kind === 'empty') return '';
  if (value.kind === 'text') return value.value;
  if (value.kind === 'number' || value.kind === 'boolean') return String(value.value);
  return '';
};
const mapItems = (value: RuntimeValue | undefined, fn: (item: RuntimeValue) => RuntimeValue): RuntimeValue => {
  const items = list(value);
  if (value?.kind === 'list') return { kind: 'list', items: items.map(fn) };
  return items[0] ? fn(items[0]) : { kind: 'empty' };
};
function dotNetFormat(format: string, values: RuntimeValue[]): string {
  const OPEN = '\u0001';
  const CLOSE = '\u0002';
  return format
    .replace(/\{\{/g, OPEN)
    .replace(/\}\}/g, CLOSE)
    .replace(/\{(\d+)(?::[^}]*)?\}/g, (_m, rawIndex: string) => scalarText(values[Number(rawIndex)]))
    .replaceAll(OPEN, '{')
    .replaceAll(CLOSE, '}');
}


type JsonRecord = Record<string, unknown>;

function unwrapJson(value: unknown): unknown {
  let current = value;
  for (let i = 0; i < 3 && typeof current === 'string'; i++) {
    const trimmed = current.trim();
    if (!(trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"'))) break;
    try { current = JSON.parse(trimmed) as unknown; } catch { break; }
  }
  return current;
}

function record(value: unknown): JsonRecord | null {
  const unwrapped = unwrapJson(value);
  return unwrapped && typeof unwrapped === 'object' && !Array.isArray(unwrapped)
    ? unwrapped as JsonRecord
    : null;
}

function prop(object: JsonRecord | null, ...keys: string[]): unknown {
  if (!object) return undefined;
  for (const key of keys) if (key in object) return object[key];
  return undefined;
}

function xyz(value: unknown): { x: number; y: number; z: number } | null {
  if (Array.isArray(value) && value.length >= 3) {
    const [x, y, z] = value.map(Number);
    return [x, y, z].every(Number.isFinite) ? { x, y, z } : null;
  }
  const object = record(value);
  if (!object) return null;
  const x = Number(prop(object, 'X', 'x'));
  const y = Number(prop(object, 'Y', 'y'));
  const z = Number(prop(object, 'Z', 'z'));
  return [x, y, z].every(Number.isFinite) ? { x, y, z } : null;
}

async function structuredBoxToBrep(value: unknown): Promise<RuntimeValue | null> {
  const object = record(value);
  if (!object) return null;
  const bbox = record(prop(object, 'BoundingBox', 'boundingBox', 'BBox', 'bbox')) ?? object;
  const min = xyz(prop(bbox, 'Min', 'min', 'Minimum', 'minimum'));
  const max = xyz(prop(bbox, 'Max', 'max', 'Maximum', 'maximum'));
  if (!min || !max) return null;

  const rhino = await getRhino();
  const box = new rhino.BoundingBox([min.x, min.y, min.z], [max.x, max.y, max.z]);
  const brep = box.toBrep();
  try {
    return brep
      ? { kind: 'geometry', type: 'Rhino.Geometry.Brep', value: brep.encode() }
      : null;
  } finally {
    (brep as unknown as { delete?: () => void } | null)?.delete?.();
    (box as unknown as { delete?: () => void }).delete?.();
  }
}

async function commonObjectToBrep(value: unknown): Promise<RuntimeValue | null> {
  const payload = unwrapJson(value);
  if (!payload || typeof payload !== 'object') return null;
  const rhino = await getRhino();
  let decoded: unknown;
  try {
    decoded = rhino.CommonObject.decode(payload as object);
    const toBrep = (decoded as { toBrep?: () => unknown } | null)?.toBrep;
    if (typeof toBrep !== 'function') return null;
    const brep = toBrep.call(decoded) as { encode?: () => unknown; delete?: () => void } | null;
    try {
      return brep?.encode
        ? { kind: 'geometry', type: 'Rhino.Geometry.Brep', value: brep.encode() }
        : null;
    } finally {
      brep?.delete?.();
    }
  } catch {
    return null;
  } finally {
    (decoded as { delete?: () => void } | undefined)?.delete?.();
  }
}

async function normalizePreviewValue(value: RuntimeValue): Promise<RuntimeValue> {
  if (value.kind === 'list') {
    return { kind: 'list', items: await Promise.all(value.items.map(normalizePreviewValue)) };
  }
  if (value.kind !== 'geometry' || value.type === 'Rhino.Geometry.Brep') return value;

  if (value.type === 'Rhino.Geometry.Box' || value.type === 'Rhino.Geometry.BoundingBox') {
    return await structuredBoxToBrep(value.value) ?? value;
  }

  if (value.type === 'Rhino.Geometry.Extrusion' || value.type === 'Rhino.Geometry.Surface') {
    return await commonObjectToBrep(value.value) ?? value;
  }

  return value;
}


function flattenPreviewValues(value: RuntimeValue): RuntimeValue[] {
  if (value.kind === 'list') return value.items.flatMap(flattenPreviewValues);
  if (value.kind === 'empty') return [];
  return [value];
}

function computeMeshes(result: unknown): RuntimeValue[] {
  if (result == null) return [];
  if (Array.isArray(result)) return result.flatMap(computeMeshes);
  if (typeof result !== 'object') return [];
  return [{ kind: 'geometry', type: 'Rhino.Geometry.Mesh', value: result }];
}

async function meshPreviewValue(
  value: RuntimeValue,
  services: CatalogEvalServices,
): Promise<RuntimeValue> {
  const normalized = await normalizePreviewValue(value);
  const flat = flattenPreviewValues(normalized);
  if (!flat.length) return { kind: 'empty' };

  const brepSlots: number[] = [];
  const breps: RuntimeValue[] = [];

  flat.forEach((item, index) => {
    if (item.kind === 'geometry' && item.type === 'Rhino.Geometry.Brep') {
      brepSlots.push(index);
      breps.push(item);
    }
  });

  if (!breps.length) return normalized;

  console.info('[GHWeb][Preview] Meshing Breps through Rhino Compute', {
    breps: breps.length,
    endpoint: 'rhino/geometry/mesh/createfrombrep-brep?multiple=true',
  });

  // compute-rhino3d's generated client uses ?multiple=true and zipArgs().
  // For a single-argument method that means one argument tuple per Brep:
  //   [[brep0], [brep1], ...]
  const response = await services.compute(
    'rhino/geometry/mesh/createfrombrep-brep?multiple=true',
    breps.map((item) => [item.kind === 'geometry' ? item.value : null]),
  );

  const batches = Array.isArray(response) ? response : [response];
  const replacements = new Map<number, RuntimeValue[]>();

  brepSlots.forEach((slot, batchIndex) => {
    const meshes = computeMeshes(batches[batchIndex]);
    if (meshes.length) replacements.set(slot, meshes);
  });

  const out: RuntimeValue[] = [];
  flat.forEach((item, index) => {
    const replacement = replacements.get(index);
    if (replacement) out.push(...replacement);
    else out.push(item); // Keep original geometry if Compute meshing failed for that item.
  });

  if (!out.length) return { kind: 'empty' };
  return out.length === 1 ? out[0] : { kind: 'list', items: out };
}

export const NODE_CATALOG: CatalogEntry[] = [
  {
    id: 'params.number', name: 'Number Slider', nickname: 'Slider', category: 'Params', subcategory: 'Input', runtime: 'local',
    description: 'Numeric parameter with editable bounds.', inputs: [], outputs: [{ name: 'N', type: 'number' }],
    defaults: { value: 900, min: 0, max: 2000 }, keywords: ['number', 'slider', 'input'],
    evaluate: (_i, v) => ({ N: { kind: 'number', value: Number(v.value ?? 0) } }),
  },
  {
    id: 'params.integer', name: 'Integer Slider', nickname: 'Int', category: 'Params', subcategory: 'Input', runtime: 'local',
    description: 'Integer parameter with editable bounds.', inputs: [], outputs: [{ name: 'N', type: 'number' }],
    defaults: { value: 4, min: 0, max: 24 }, keywords: ['integer', 'slider', 'count'],
    evaluate: (_i, v) => ({ N: { kind: 'number', value: Math.round(Number(v.value ?? 0)) } }),
  },
  {
    id: 'params.boolean', name: 'Boolean Toggle', nickname: 'Toggle', category: 'Params', subcategory: 'Input', runtime: 'local',
    description: 'True/false parameter.', inputs: [], outputs: [{ name: 'B', type: 'boolean' }], defaults: { value: true },
    evaluate: (_i, v) => ({ B: { kind: 'boolean', value: Boolean(v.value) } }),
  },
  {
    id: 'params.panel', name: 'Panel', nickname: 'Panel', category: 'Params', subcategory: 'Input', runtime: 'local',
    description: 'Text parameter and value inspector.', inputs: [{ name: 'In', type: 'text', optional: true }], outputs: [{ name: 'Out', type: 'text' }], defaults: { value: '' },
    evaluate: (i, v) => ({ Out: i.In ?? { kind: 'text', value: String(v.value ?? '') } }),
  },
  {
    id: 'math.add', name: 'Addition', nickname: 'A+B', category: 'Maths', subcategory: 'Operators', runtime: 'local',
    description: 'Add two numbers.', inputs: [{ name: 'A', type: 'number', defaultValue: 0 }, { name: 'B', type: 'number', defaultValue: 0 }], outputs: [{ name: 'R', type: 'number' }],
    evaluate: i => ({ R: { kind: 'number', value: n(i.A) + n(i.B) } }),
  },
  {
    id: 'math.subtract', name: 'Subtraction', nickname: 'A-B', category: 'Maths', subcategory: 'Operators', runtime: 'local',
    description: 'Subtract B from A.', inputs: [{ name: 'A', type: 'number' }, { name: 'B', type: 'number' }], outputs: [{ name: 'R', type: 'number' }],
    evaluate: i => ({ R: { kind: 'number', value: n(i.A) - n(i.B) } }),
  },
  {
    id: 'math.multiply', name: 'Multiplication', nickname: 'A×B', category: 'Maths', subcategory: 'Operators', runtime: 'local',
    description: 'Multiply two numbers.', inputs: [{ name: 'A', type: 'number' }, { name: 'B', type: 'number' }], outputs: [{ name: 'R', type: 'number' }],
    evaluate: i => ({ R: { kind: 'number', value: n(i.A) * n(i.B) } }),
  },
  {
    id: 'math.divide', name: 'Division', nickname: 'A/B', category: 'Maths', subcategory: 'Operators', runtime: 'local',
    description: 'Divide A by B.', inputs: [{ name: 'A', type: 'number' }, { name: 'B', type: 'number' }], outputs: [{ name: 'R', type: 'number' }],
    evaluate: i => ({ R: { kind: 'number', value: n(i.B) === 0 ? NaN : n(i.A) / n(i.B) } }),
  },
  {
    id: 'math.greater', name: 'Larger Than', nickname: 'A>B', category: 'Maths', subcategory: 'Operators', runtime: 'local',
    description: 'True when A is greater than B.', inputs: [{ name: 'A', type: 'number' }, { name: 'B', type: 'number' }], outputs: [{ name: 'R', type: 'boolean' }],
    evaluate: i => ({ R: { kind: 'boolean', value: n(i.A) > n(i.B) } }),
  },
  {
    id: 'vector.point', name: 'Construct Point', nickname: 'Pt', category: 'Vector', subcategory: 'Point', runtime: 'local',
    description: 'Construct a Point3d from XYZ coordinates.', inputs: [{ name: 'X', type: 'number' }, { name: 'Y', type: 'number' }, { name: 'Z', type: 'number' }], outputs: [{ name: 'P', type: 'point' }],
    evaluate: i => ({ P: { kind: 'point', value: { X: n(i.X), Y: n(i.Y), Z: n(i.Z) } } }),
  },
  {
    id: 'vector.vector', name: 'Construct Vector', nickname: 'Vec', category: 'Vector', subcategory: 'Vector', runtime: 'local',
    description: 'Construct a Vector3d from XYZ coordinates.', inputs: [{ name: 'X', type: 'number' }, { name: 'Y', type: 'number' }, { name: 'Z', type: 'number' }], outputs: [{ name: 'V', type: 'vector' }],
    evaluate: i => ({ V: { kind: 'vector', value: { X: n(i.X), Y: n(i.Y), Z: n(i.Z) } } }),
  },
  {
    id: 'sets.series', name: 'Series', nickname: 'Series', category: 'Sets', subcategory: 'Sequence', runtime: 'local',
    description: 'Generate evenly spaced numbers from start, step and count.', inputs: [{ name: 'S', type: 'number', defaultValue: 0 }, { name: 'N', type: 'number', defaultValue: 1 }, { name: 'C', type: 'number', defaultValue: 10 }], outputs: [{ name: 'S', type: 'list' }],
    evaluate: i => { const count = Math.max(0, Math.min(10000, Math.round(n(i.C, 10)))); const start = n(i.S); const step = n(i.N, 1); return { S: { kind: 'list', items: Array.from({ length: count }, (_, k) => ({ kind: 'number' as const, value: start + k * step })) } }; },
  },
  {
    id: 'sets.length', name: 'List Length', nickname: 'Length', category: 'Sets', subcategory: 'List', runtime: 'local',
    description: 'Count items in a list.', inputs: [{ name: 'L', type: 'list' }], outputs: [{ name: 'L', type: 'number' }],
    evaluate: i => ({ L: { kind: 'number', value: list(i.L).length } }),
  },
  {
    id: 'sets.flatten', name: 'Flatten Tree', nickname: 'Flatten', category: 'Sets', subcategory: 'Tree', runtime: 'local',
    description: 'Flatten nested runtime lists. Full Grasshopper path semantics are a later milestone.', inputs: [{ name: 'T', type: 'list' }], outputs: [{ name: 'T', type: 'list' }],
    evaluate: i => ({ T: { kind: 'list', items: flatten(i.T) } }),
  },
  {
    id: 'sets.dispatch', name: 'Dispatch', nickname: 'Dispatch', category: 'Sets', subcategory: 'List', runtime: 'local',
    description: 'Dispatch a list into A/B using a repeating boolean pattern.', inputs: [{ name: 'L', type: 'list' }, { name: 'P', type: 'boolean' }], outputs: [{ name: 'A', type: 'list' }, { name: 'B', type: 'list' }],
    evaluate: i => { const items = list(i.L); const pattern = list(i.P); const a: RuntimeValue[] = []; const b: RuntimeValue[] = []; items.forEach((item, k) => { const p = pattern.length ? bool(pattern[k % pattern.length], false) : false; (p ? a : b).push(item); }); return { A: { kind: 'list', items: a }, B: { kind: 'list', items: b } }; },
  },
  {
    id: 'sets.merge', name: 'Merge', nickname: 'Merge', category: 'Sets', subcategory: 'List', runtime: 'local',
    description: 'Merge up to four streams into a single list.', inputs: [{ name: 'A', type: 'list', optional: true }, { name: 'B', type: 'list', optional: true }, { name: 'C', type: 'list', optional: true }, { name: 'D', type: 'list', optional: true }], outputs: [{ name: 'R', type: 'list' }],
    evaluate: i => ({ R: { kind: 'list', items: [...list(i.A), ...list(i.B), ...list(i.C), ...list(i.D)] } }),
  },
  {
    id: 'sets.textLength', name: 'Text Length', nickname: 'Length', category: 'Sets', subcategory: 'Text', runtime: 'local',
    description: 'Count characters in text.', inputs: [{ name: 'T', type: 'text' }], outputs: [{ name: 'L', type: 'number' }],
    evaluate: i => ({ L: mapItems(i.T, item => ({ kind: 'number', value: scalarText(item).length })) }),
  },
  {
    id: 'sets.textJoin', name: 'Text Join', nickname: 'Join', category: 'Sets', subcategory: 'Text', runtime: 'local',
    description: 'Join text items using a separator.', inputs: [{ name: 'T', type: 'list' }, { name: 'S', type: 'text', defaultValue: ',' }], outputs: [{ name: 'T', type: 'text' }],
    evaluate: i => ({ T: { kind: 'text', value: list(i.T).map(item => scalarText(item)).join(text(i.S, ',')) } }),
  },
  {
    id: 'sets.format', name: 'Format', nickname: 'Format', category: 'Sets', subcategory: 'Text', runtime: 'local',
    description: 'Small .NET-style String.Format subset with {0}/{1} placeholders and Grasshopper-style list broadcasting.', inputs: [{ name: 'F', type: 'text' }, { name: 'A', type: 'list', optional: true }, { name: 'B', type: 'list', optional: true }], outputs: [{ name: 'T', type: 'text' }],
    evaluate: i => { const fmt = text(i.F); const aa = list(i.A); const bb = list(i.B); const count = Math.max(aa.length, bb.length, 1); const out = Array.from({ length: count }, (_, k) => ({ kind: 'text' as const, value: dotNetFormat(fmt, [aa.length ? aa[k % aa.length] : { kind: 'empty' }, bb.length ? bb[k % bb.length] : { kind: 'empty' }]) })); return { T: out.length === 1 ? out[0] : { kind: 'list', items: out } }; },
  },
  {
    id: 'surface.box2pt', name: 'Box 2Pt', nickname: 'Box', category: 'Surface', subcategory: 'Primitive', runtime: 'local',
    description: 'Axis-aligned Brep box from two corner points, created directly in the browser with rhino3dm.', inputs: [{ name: 'A', type: 'point' }, { name: 'B', type: 'point' }], outputs: [{ name: 'B', type: 'brep' }],
    evaluate: async i => { const a = point(i.A); const b = point(i.B); const rhino = await getRhino(); const bbox = new rhino.BoundingBox([Math.min(a.X, b.X), Math.min(a.Y, b.Y), Math.min(a.Z, b.Z)], [Math.max(a.X, b.X), Math.max(a.Y, b.Y), Math.max(a.Z, b.Z)]); const brep = bbox.toBrep(); try { return { B: brep ? { kind: 'geometry', type: 'Rhino.Geometry.Brep', value: brep.encode() } : { kind: 'empty' } }; } finally { (brep as unknown as { delete?: () => void } | null)?.delete?.(); (bbox as unknown as { delete?: () => void }).delete?.(); } },
  },
  {
    id: 'curve.interpolate', name: 'Interpolate Curve', nickname: 'IntCrv', category: 'Curve', subcategory: 'Spline', runtime: 'compute',
    description: 'RhinoCommon Curve.CreateInterpolatedCurve solved by Rhino Compute.', inputs: [{ name: 'P', type: 'list' }, { name: 'D', type: 'number', defaultValue: 3 }], outputs: [{ name: 'C', type: 'curve' }],
    compute: { endpoint: 'rhino/geometry/curve/createinterpolatedcurve-point3darray_int', outputType: 'geometry:Curve' },
  },
  {
    id: 'curve.length', name: 'Curve Length', nickname: 'Length', category: 'Curve', subcategory: 'Analysis', runtime: 'compute',
    description: 'Curve length through Rhino Compute.', inputs: [{ name: 'C', type: 'curve' }], outputs: [{ name: 'L', type: 'number' }],
    compute: { endpoint: 'rhino/geometry/curve/getlength-curve', outputType: 'number' },
  },
  {
    id: 'surface.extrude', name: 'Extrude', nickname: 'Extrude', category: 'Surface', subcategory: 'Freeform', runtime: 'compute',
    description: 'Extrude a curve along a vector using RhinoCommon on Compute.', inputs: [{ name: 'B', type: 'curve' }, { name: 'D', type: 'vector' }], outputs: [{ name: 'E', type: 'surface' }],
    compute: { endpoint: 'rhino/geometry/surface/createextrusion-curve_vector3d', outputType: 'geometry:Surface' },
  },
  {
    id: 'surface.planar', name: 'Boundary Surface', nickname: 'Boundary', category: 'Surface', subcategory: 'Freeform', runtime: 'compute',
    description: 'Create planar Breps from a closed curve.', inputs: [{ name: 'E', type: 'curve' }, { name: 'T', type: 'number', defaultValue: 0.1 }], outputs: [{ name: 'S', type: 'brep' }],
    compute: { endpoint: 'rhino/geometry/brep/createplanarbreps-curve_double', outputType: 'list:geometry:Brep' },
  },
  {
    id: 'surface.loft', name: 'Loft', nickname: 'Loft', category: 'Surface', subcategory: 'Freeform', runtime: 'compute',
    description: 'Loft a list of section curves.', inputs: [{ name: 'C', type: 'list' }, { name: 'S', type: 'point', optional: true }, { name: 'E', type: 'point', optional: true }, { name: 'T', type: 'number', defaultValue: 0 }, { name: 'Closed', type: 'boolean', defaultValue: false }], outputs: [{ name: 'L', type: 'brep' }],
    compute: { endpoint: 'rhino/geometry/brep/createfromloft-curvearray_point3d_point3d_lofttype_bool', outputType: 'list:geometry:Brep' },
  },
  {
    id: 'intersect.union', name: 'Solid Union', nickname: 'SUnion', category: 'Intersect', subcategory: 'Shape', runtime: 'compute',
    description: 'Boolean union Breps on Rhino Compute.', inputs: [{ name: 'B', type: 'list' }, { name: 'T', type: 'number', defaultValue: 0.1 }], outputs: [{ name: 'R', type: 'brep' }],
    compute: { endpoint: 'rhino/geometry/brep/createbooleanunion-breparray_double', outputType: 'list:geometry:Brep' },
  },
  {
    id: 'intersect.difference', name: 'Solid Difference', nickname: 'SDiff', category: 'Intersect', subcategory: 'Shape', runtime: 'compute',
    description: 'Boolean difference two Brep sets on Rhino Compute.', inputs: [{ name: 'A', type: 'list' }, { name: 'B', type: 'list' }, { name: 'T', type: 'number', defaultValue: 0.1 }], outputs: [{ name: 'R', type: 'brep' }],
    compute: { endpoint: 'rhino/geometry/brep/createbooleandifference-breparray_breparray_double', outputType: 'list:geometry:Brep' },
  },
  {
    id: 'surface.area', name: 'Area', nickname: 'Area', category: 'Surface', subcategory: 'Analysis', runtime: 'compute',
    description: 'Brep area from Rhino Compute.', inputs: [{ name: 'G', type: 'brep' }], outputs: [{ name: 'A', type: 'number' }],
    compute: { endpoint: 'rhino/geometry/brep/getarea-brep', outputType: 'number' },
  },
  {
    id: 'surface.volume', name: 'Volume', nickname: 'Volume', category: 'Surface', subcategory: 'Analysis', runtime: 'compute',
    description: 'Brep volume from Rhino Compute.', inputs: [{ name: 'G', type: 'brep' }], outputs: [{ name: 'V', type: 'number' }],
    compute: { endpoint: 'rhino/geometry/brep/getvolume-brep', outputType: 'number' },
  },
  {
    id: 'mesh.brep', name: 'Mesh Brep', nickname: 'Mesh', category: 'Mesh', subcategory: 'Triangulation', runtime: 'compute',
    description: 'Generate render meshes from a Brep.', inputs: [{ name: 'B', type: 'brep' }], outputs: [{ name: 'M', type: 'mesh' }],
    compute: { endpoint: 'rhino/geometry/mesh/createfrombrep-brep', outputType: 'list:geometry:Mesh' },
  },
  {
    id: 'display.preview', name: 'Custom Preview', nickname: 'Preview', category: 'Display', subcategory: 'Preview', runtime: 'display',
    description: 'Prepare geometry for the floating Rhino preview. Box/BoundingBox and convertible Surface/Extrusion values are normalized to Breps, then Breps are meshed through Rhino Compute for rendering.', inputs: [{ name: 'G', type: 'geometry' }], outputs: [{ name: 'G', type: 'geometry' }],
    evaluate: async (i, _v, services) => ({ G: await meshPreviewValue(i.G ?? { kind: 'empty' }, services) }),
  },
  {
    id: 'hops.python-generator', name: 'Grasshopper Python Generator', nickname: 'Py→GH', category: 'Hops', subcategory: 'Generate', runtime: 'action',
    description: 'Run a Rhino/Grasshopper Python generator on demand and output the generated .gh/.ghx/archive files. Requires GRASSHOPPER_GENERATOR_URL on the web server.',
    inputs: [{ name: 'Script', type: 'text', optional: true }],
    outputs: [{ name: 'Files', type: 'file' }, { name: 'Log', type: 'text' }],
    defaults: { script: '', jobName: 'grasshopper-catalog' },
    keywords: ['python', 'generator', 'grasshopper', 'gh', 'catalog'],
  },
  {
    id: 'files.download', name: 'Download Files', nickname: 'Download', category: 'Files', subcategory: 'Action', runtime: 'action',
    description: 'Download generated files only when the button is clicked. If a ZIP is present it is preferred over downloading every file separately.',
    inputs: [{ name: 'Files', type: 'file' }],
    outputs: [],
    defaults: { preferArchive: true },
    keywords: ['download', 'file', 'zip', 'export'],
  },
  {
    id: 'hops.definition', name: 'Hops Function', nickname: 'Hops', category: 'Hops', subcategory: 'Grasshopper', runtime: 'hops',
    description: 'Load a .gh/.ghx by URL or base64 and expose its dynamic inputs and outputs.', inputs: [], outputs: [], keywords: ['grasshopper', 'definition', 'gh', 'ghx', 'remote'],
  },
];

export const CATEGORIES = ['Params', 'Maths', 'Sets', 'Vector', 'Curve', 'Surface', 'Intersect', 'Transform', 'Mesh', 'Display', 'Hops', 'Files'];

export function catalogEntry(id: string): CatalogEntry | undefined {
  return NODE_CATALOG.find(entry => entry.id === id);
}

export function createNode(component: string, position: { x: number; y: number }): GraphNode {
  const entry = catalogEntry(component);
  if (!entry) throw new Error(`Unknown component: ${component}`);
  return {
    id: newId(component.split('.').at(-1) ?? 'node'),
    component,
    title: entry.name,
    position,
    values: { ...(entry.defaults ?? {}) },
    ...(component === 'hops.definition' ? { hops: { label: 'Hops Function' } } : {}),
  };
}
