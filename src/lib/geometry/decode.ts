import type { ResthopperItem } from '@/lib/compute/types';
import { getRhino, type RhinoModule } from './rhino';

export type DecodedGeometry =
  | ({ kind: 'mesh'; positions: Float32Array; indices: Uint32Array } & { source: string })
  | ({ kind: 'lines'; points: Float32Array } & { source: string })
  | ({ kind: 'points'; positions: Float32Array } & { source: string });

type MeshPart = { kind: 'mesh'; positions: Float32Array; indices: Uint32Array };
type LinesPart = { kind: 'lines'; points: Float32Array };
type PointsPart = { kind: 'points'; positions: Float32Array };
type GeometryPart = MeshPart | LinesPart | PointsPart;

type JsonObject = Record<string, unknown>;
type Vec3 = { x: number; y: number; z: number };

export interface DecodeOutcome {
  geometries: DecodedGeometry[];
  failures: string[];
}

const CURVE_SAMPLES = 64;

const STRUCT_TYPES = new Set([
  'Rhino.Geometry.Point3d',
  'Rhino.Geometry.Vector3d',
  'Rhino.Geometry.Line',
  'Rhino.Geometry.Plane',
  'Rhino.Geometry.Box',
  'Rhino.Geometry.BoundingBox',
  'Rhino.Geometry.Rectangle3d',
  'Rhino.Geometry.Circle',
  'Rhino.Geometry.Arc',
]);

export async function decodeItems(items: ResthopperItem[]): Promise<DecodeOutcome> {
  const rhino = await getRhino();
  const geometries: DecodedGeometry[] = [];
  const failures: string[] = [];

  for (const item of items) {
    if (item.type.startsWith('System.')) continue;

    let wrapper: unknown;
    try {
      wrapper = parseResthopperData(item.data);
    } catch (error) {
      failures.push(`${item.type}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    // RhinoCommon value structs (Box, Point3d, Line, …) are serialized by
    // Newtonsoft, not GeometryBase.ToJSON. CommonObject.decode only applies to
    // CommonObject/GeometryBase payloads, so trying to pass a Box object into it
    // produces the WASM "Cannot pass non-string to std::string" error.
    if (STRUCT_TYPES.has(item.type)) {
      try {
        const structured = convertStructured(item.type, wrapper);
        if (structured) geometries.push({ ...structured, source: shortType(item.type) });
        else if (item.type !== 'Rhino.Geometry.Plane' && item.type !== 'Rhino.Geometry.Vector3d') {
          failures.push(`${item.type}: unsupported or incomplete structured geometry payload`);
        }
      } catch (error) {
        failures.push(`${item.type}: ${error instanceof Error ? error.message : String(error)}`);
      }
      continue;
    }

    let decoded: unknown;
    try {
      decoded = rhino.CommonObject.decode(wrapper as object);
    } catch (error) {
      const shape = describeShape(wrapper);
      failures.push(`${item.type}: ${error instanceof Error ? error.message : String(error)} [payload ${shape}]`);
      continue;
    }

    try {
      const converted = convertCommonObject(rhino, decoded);
      if (converted) geometries.push({ ...converted, source: shortType(item.type) });
      else failures.push(`${item.type}: decoded but has no supported preview representation`);
    } catch (error) {
      failures.push(`${item.type}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      (decoded as { delete?: () => void })?.delete?.();
    }
  }

  if (failures.length) {
    console.warn('[GHWeb][viewer] Geometry decode warnings', failures);
  }

  return { geometries, failures };
}

function parseResthopperData(data: string): unknown {
  let value: unknown = data;
  for (let i = 0; i < 3 && typeof value === 'string'; i++) {
    const trimmed = value.trim();
    if (!(trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"'))) break;
    value = JSON.parse(trimmed) as unknown;
  }
  return value;
}

function convertStructured(type: string, value: unknown): GeometryPart | null {
  if (type === 'Rhino.Geometry.Point3d') {
    const point = readVec3(value);
    return point ? { kind: 'points', positions: new Float32Array([point.x, point.y, point.z]) } : null;
  }

  if (type === 'Rhino.Geometry.Line') {
    const object = asObject(value);
    const from = readVec3(getAny(object, 'From', 'from', 'Start', 'start'));
    const to = readVec3(getAny(object, 'To', 'to', 'End', 'end'));
    if (!from || !to) return null;
    return {
      kind: 'lines',
      points: new Float32Array([from.x, from.y, from.z, to.x, to.y, to.z]),
    };
  }

  if (type === 'Rhino.Geometry.BoundingBox') {
    const corners = boundingBoxCorners(value);
    return corners ? cornersToMesh(corners) : null;
  }

  if (type === 'Rhino.Geometry.Box') {
    const object = asObject(value);

    // Newtonsoft's Box payload normally includes BoundingBox. Prefer it when
    // available because the furniture catalog's Box 2Pt components are
    // axis-aligned and this representation is unambiguous.
    const bbox = getAny(object, 'BoundingBox', 'boundingBox', 'BBox', 'bbox');
    const bboxCorners = boundingBoxCorners(bbox);
    if (bboxCorners) return cornersToMesh(bboxCorners);

    const plane = readPlane(getAny(object, 'Plane', 'plane'));
    const xi = readInterval(getAny(object, 'X', 'x'));
    const yi = readInterval(getAny(object, 'Y', 'y'));
    const zi = readInterval(getAny(object, 'Z', 'z'));

    if (!plane || !xi || !yi || !zi) return null;

    const corner = (x: number, y: number, z: number): Vec3 => ({
      x: plane.origin.x + plane.x.x * x + plane.y.x * y + plane.z.x * z,
      y: plane.origin.y + plane.x.y * x + plane.y.y * y + plane.z.y * z,
      z: plane.origin.z + plane.x.z * x + plane.y.z * y + plane.z.z * z,
    });

    return cornersToMesh([
      corner(xi[0], yi[0], zi[0]),
      corner(xi[1], yi[0], zi[0]),
      corner(xi[1], yi[1], zi[0]),
      corner(xi[0], yi[1], zi[0]),
      corner(xi[0], yi[0], zi[1]),
      corner(xi[1], yi[0], zi[1]),
      corner(xi[1], yi[1], zi[1]),
      corner(xi[0], yi[1], zi[1]),
    ]);
  }

  if (type === 'Rhino.Geometry.Rectangle3d') {
    const object = asObject(value);
    const plane = readPlane(getAny(object, 'Plane', 'plane'));
    const xi = readInterval(getAny(object, 'X', 'x'));
    const yi = readInterval(getAny(object, 'Y', 'y'));
    if (!plane || !xi || !yi) return null;

    const p = (x: number, y: number): Vec3 => ({
      x: plane.origin.x + plane.x.x * x + plane.y.x * y,
      y: plane.origin.y + plane.x.y * x + plane.y.y * y,
      z: plane.origin.z + plane.x.z * x + plane.y.z * y,
    });

    const a = p(xi[0], yi[0]);
    const b = p(xi[1], yi[0]);
    const c = p(xi[1], yi[1]);
    const d = p(xi[0], yi[1]);
    return {
      kind: 'lines',
      points: new Float32Array([
        a.x, a.y, a.z, b.x, b.y, b.z,
        b.x, b.y, b.z, c.x, c.y, c.z,
        c.x, c.y, c.z, d.x, d.y, d.z,
        d.x, d.y, d.z, a.x, a.y, a.z,
      ]),
    };
  }

  return null;
}

function boundingBoxCorners(value: unknown): Vec3[] | null {
  const object = asObject(value);
  if (!object) return null;

  const min = readVec3(getAny(object, 'Min', 'min', 'Minimum', 'minimum'));
  const max = readVec3(getAny(object, 'Max', 'max', 'Maximum', 'maximum'));
  if (!min || !max) return null;

  return [
    { x: min.x, y: min.y, z: min.z },
    { x: max.x, y: min.y, z: min.z },
    { x: max.x, y: max.y, z: min.z },
    { x: min.x, y: max.y, z: min.z },
    { x: min.x, y: min.y, z: max.z },
    { x: max.x, y: min.y, z: max.z },
    { x: max.x, y: max.y, z: max.z },
    { x: min.x, y: max.y, z: max.z },
  ];
}

function cornersToMesh(corners: Vec3[]): MeshPart {
  const positions = new Float32Array(corners.flatMap((p) => [p.x, p.y, p.z]));
  const indices = new Uint32Array([
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7,
  ]);
  return { kind: 'mesh', positions, indices };
}

function readPlane(value: unknown): { origin: Vec3; x: Vec3; y: Vec3; z: Vec3 } | null {
  const object = asObject(value);
  if (!object) return null;

  const origin = readVec3(getAny(object, 'Origin', 'origin'));
  const x = readVec3(getAny(object, 'XAxis', 'xAxis', 'Xaxis', 'xaxis'));
  const y = readVec3(getAny(object, 'YAxis', 'yAxis', 'Yaxis', 'yaxis'));
  const z = readVec3(getAny(object, 'ZAxis', 'zAxis', 'Normal', 'normal'));

  if (!origin || !x || !y || !z) return null;
  return { origin, x, y, z };
}

function readInterval(value: unknown): [number, number] | null {
  if (Array.isArray(value) && value.length >= 2) {
    const a = Number(value[0]);
    const b = Number(value[1]);
    return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
  }

  const object = asObject(value);
  if (!object) return null;

  const a = Number(getAny(object, 'T0', 't0', 'Min', 'min', 'Start', 'start'));
  const b = Number(getAny(object, 'T1', 't1', 'Max', 'max', 'End', 'end'));
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
}

function readVec3(value: unknown): Vec3 | null {
  if (Array.isArray(value) && value.length >= 3) {
    const x = Number(value[0]);
    const y = Number(value[1]);
    const z = Number(value[2]);
    return [x, y, z].every(Number.isFinite) ? { x, y, z } : null;
  }

  const object = asObject(value);
  if (!object) return null;

  const x = Number(getAny(object, 'X', 'x'));
  const y = Number(getAny(object, 'Y', 'y'));
  const z = Number(getAny(object, 'Z', 'z'));
  return [x, y, z].every(Number.isFinite) ? { x, y, z } : null;
}

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function getAny(object: JsonObject | null, ...keys: string[]): unknown {
  if (!object) return undefined;
  for (const key of keys) {
    if (key in object) return object[key];
  }
  return undefined;
}

function describeShape(value: unknown): string {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value && typeof value === 'object') return `object keys=[${Object.keys(value as JsonObject).slice(0, 12).join(',')}]`;
  return typeof value;
}

function convertCommonObject(rhino: RhinoModule, decoded: unknown): GeometryPart | null {
  if (isMesh(rhino, decoded)) {
    const json = (decoded as { toThreejsJSON: () => MeshThreeJson }).toThreejsJSON();
    const positions = json.data?.attributes?.position?.array;
    if (!positions || positions.length === 0) return null;
    return {
      kind: 'mesh',
      positions: new Float32Array(positions),
      indices: new Uint32Array(json.data?.index?.array ?? []),
    };
  }

  if (isBrep(rhino, decoded)) {
    const brep = decoded as {
      faces: () => { count: number; get: (i: number) => { getMesh: (t: unknown) => unknown } };
      edges: () => { count: number; get: (i: number) => unknown };
    };

    const faces = brep.faces();
    const parts: MeshPart[] = [];

    for (let i = 0; i < faces.count; i++) {
      const face = faces.get(i);
      try {
        const mesh = face.getMesh(rhino.MeshType.Render) as MeshLike | null;
        if (!mesh) continue;

        const json = mesh.toThreejsJSON();
        const positions = json.data?.attributes?.position?.array;
        if (positions && positions.length > 0) {
          parts.push({
            kind: 'mesh',
            positions: new Float32Array(positions),
            indices: new Uint32Array(json.data?.index?.array ?? []),
          });
        }
      } finally {
        (face as { delete?: () => void })?.delete?.();
      }
    }

    (faces as { delete?: () => void })?.delete?.();
    if (parts.length > 0) return mergeMeshes(parts);

    const edges = brep.edges();
    const points: number[] = [];
    for (let i = 0; i < edges.count; i++) {
      const edge = edges.get(i);
      try {
        appendCurvePoints(edge, points);
      } finally {
        (edge as { delete?: () => void })?.delete?.();
      }
    }

    (edges as { delete?: () => void })?.delete?.();
    return points.length ? { kind: 'lines', points: new Float32Array(points) } : null;
  }

  if (isCurve(rhino, decoded)) {
    const points: number[] = [];
    appendCurvePoints(decoded, points);
    return points.length ? { kind: 'lines', points: new Float32Array(points) } : null;
  }

  if (isPoint(rhino, decoded)) {
    const location = (decoded as { location: { x: number; y: number; z: number } }).location;
    return {
      kind: 'points',
      positions: new Float32Array([location.x, location.y, location.z]),
    };
  }

  if (isPointCloud(rhino, decoded)) {
    const count = (decoded as { count: number }).count;
    const positions: number[] = [];
    for (let i = 0; i < count; i++) {
      const p = (decoded as { pointAt: (i: number) => { x: number; y: number; z: number } }).pointAt(i);
      positions.push(p.x, p.y, p.z);
    }
    return positions.length ? { kind: 'points', positions: new Float32Array(positions) } : null;
  }

  return null;
}

function mergeMeshes(parts: MeshPart[]): MeshPart {
  if (parts.length === 1) return parts[0];

  const positions = new Float32Array(parts.reduce((sum, part) => sum + part.positions.length, 0));
  const indices = new Uint32Array(parts.reduce((sum, part) => sum + part.indices.length, 0));

  let vertexOffset = 0;
  let indexOffset = 0;

  for (const part of parts) {
    positions.set(part.positions, vertexOffset);
    for (let i = 0; i < part.indices.length; i++) {
      indices[indexOffset + i] = part.indices[i] + vertexOffset / 3;
    }
    vertexOffset += part.positions.length;
    indexOffset += part.indices.length;
  }

  return { kind: 'mesh', positions, indices };
}

function appendCurvePoints(curve: unknown, out: number[]): void {
  const c = curve as {
    domain?: { min?: number; max?: number };
    isClosed?: boolean;
    pointAt: (t: number) => { x: number; y: number; z: number };
  };

  const min = c.domain?.min ?? 0;
  const max = c.domain?.max ?? 1;

  for (let i = 0; i < CURVE_SAMPLES; i++) {
    const t = min + (i / (CURVE_SAMPLES - 1)) * (max - min);
    const p = c.pointAt(t);
    if (p && Number.isFinite(p.x)) out.push(p.x, p.y, p.z);
  }

  if (c.isClosed && out.length >= 6) out.push(out[0], out[1], out[2]);
}

type MeshLike = { toThreejsJSON: () => MeshThreeJson };

interface MeshThreeJson {
  data?: {
    attributes?: { position?: { array?: number[] } };
    index?: { array?: number[] | Uint32Array | Uint16Array };
  };
}

function isMesh(rhino: RhinoModule, value: unknown): value is MeshLike {
  return value instanceof (rhino as unknown as { Mesh: abstract new () => unknown }).Mesh;
}

function isBrep(rhino: RhinoModule, value: unknown): boolean {
  return value instanceof (rhino as unknown as { Brep: abstract new () => unknown }).Brep;
}

function isCurve(rhino: RhinoModule, value: unknown): boolean {
  const Curve = (rhino as unknown as { Curve?: abstract new () => unknown }).Curve;
  return Boolean(Curve) && value instanceof (Curve as abstract new () => unknown);
}

function isPoint(rhino: RhinoModule, value: unknown): boolean {
  return value instanceof (rhino as unknown as { Point: abstract new () => unknown }).Point;
}

function isPointCloud(rhino: RhinoModule, value: unknown): boolean {
  return value instanceof (rhino as unknown as { PointCloud: abstract new () => unknown }).PointCloud;
}

function shortType(type: string): string {
  return type.replace('Rhino.Geometry.', '');
}
