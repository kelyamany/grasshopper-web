/**
 * RESThopper wire contracts for Rhino Compute `/io` and `/grasshopper`.
 *
 * Field naming follows compute.rhino3d's Schema/IoResponseSchema
 * (src/compute.geometry in mcneel/compute.rhino3d). Verified against the
 * live instance on 2026-09-01.
 */

export type ParamTypeName =
  | 'Number'
  | 'Integer'
  | 'Boolean'
  | 'Text'
  | 'Geometry'
  | 'Point'
  | 'Vector'
  | 'Line'
  | 'Box'
  | 'Plane'
  | (string & {});

export interface IoInputParam {
  Name: string;
  Nickname?: string | null;
  Description?: string | null;
  ParamType: ParamTypeName;
  AtLeast: number;
  AtMost: number;
  TreeAccess: boolean;
  /** Resthopper tree with the parameter's default value, when set. */
  Default?: ResthopperTree | null;
  Minimum?: number | null;
  Maximum?: number | null;
}

export interface IoOutputParam {
  Name: string;
  ParamType: ParamTypeName;
}

export interface IoResponse {
  Description?: string;
  FileName?: string;
  CacheKey?: string;
  InputNames: string[];
  OutputNames: string[];
  Inputs: IoInputParam[];
  Outputs: IoOutputParam[];
  Icon?: string | null;
  Warnings?: string[];
  Errors?: string[];
}

/** One item in a Resthopper data tree. `data` is a JSON string. */
export interface ResthopperItem {
  type: string;
  data: string;
}

/** Path-keyed branch map, e.g. `{ "{0}": [...] }`. */
export type ResthopperBranch = Record<string, ResthopperItem[]>;

export interface ResthopperTree {
  ParamName: string;
  InnerTree: ResthopperBranch;
}

export interface GrasshopperSolveRequest {
  algo?: string | null;
  pointer?: string | null;
  modelunits: string;
  dataversion: number;
  absolutetolerance: number;
  angletolerance: number;
  values: ResthopperTree[];
}

export interface GrasshopperSolveResponse {
  values?: ResthopperTree[];
  'values-grasshopper'?: { Values: Record<string, ResthopperTree> };
  warnings?: string[];
  errors?: string[];
  version?: string;
  algo?: string;
}

export const DEFAULT_MODEL_UNITS = 'millimeters';
export const DEFAULT_ABSOLUTE_TOLERANCE = 0.1;
export const DEFAULT_ANGLE_TOLERANCE = 1.0;

/**
 * Compute rejects `"dataversion": "1.0"` (string decimal) — the .NET side
 * deserializes it as Int32. Always send a JSON number.
 */
export const DATA_VERSION = 1;

export function buildSolveRequest(
  definition: { algo?: string | null; pointer?: string | null },
  trees: ResthopperTree[],
  overrides?: Partial<Pick<GrasshopperSolveRequest, 'modelunits' | 'absolutetolerance' | 'angletolerance'>>,
): GrasshopperSolveRequest {
  return {
    algo: definition.algo ?? null,
    pointer: definition.pointer ?? null,
    modelunits: overrides?.modelunits ?? DEFAULT_MODEL_UNITS,
    dataversion: DATA_VERSION,
    absolutetolerance: overrides?.absolutetolerance ?? DEFAULT_ABSOLUTE_TOLERANCE,
    angletolerance: overrides?.angletolerance ?? DEFAULT_ANGLE_TOLERANCE,
    values: trees,
  };
}
