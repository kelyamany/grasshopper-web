import { z } from 'zod';

export const pointSchema = z.object({ x: z.number(), y: z.number() });

export const hopsSourceSchema = z.object({
  pointer: z.string().optional(),
  algo: z.string().optional(),
  label: z.string().optional(),
});

export const nodeSchema = z.object({
  id: z.string(),
  component: z.string(),
  title: z.string(),
  position: pointSchema,
  values: z.record(z.string(), z.unknown()).default({}),
  hops: hopsSourceSchema.optional(),
});

export const edgeSchema = z.object({
  id: z.string(),
  source: z.object({ node: z.string(), port: z.string() }),
  target: z.object({ node: z.string(), port: z.string() }),
});

export const documentSchema = z.object({
  version: z.literal(2),
  name: z.string().default('Untitled'),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
  settings: z.object({
    modelunits: z.string().default('millimeters'),
    absolutetolerance: z.number().default(0.1),
    angletolerance: z.number().default(1),
  }).default({ modelunits: 'millimeters', absolutetolerance: 0.1, angletolerance: 1 }),
});

export type GraphNode = z.infer<typeof nodeSchema>;
export type GraphEdge = z.infer<typeof edgeSchema>;
export type GHWebDocument = z.infer<typeof documentSchema>;

export function emptyDocument(): GHWebDocument {
  return documentSchema.parse({ version: 2, name: 'Untitled', nodes: [], edges: [] });
}

export function parseDocument(raw: unknown): GHWebDocument {
  return documentSchema.parse(raw);
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
