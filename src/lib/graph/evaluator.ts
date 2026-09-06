import type { IoResponse, GrasshopperSolveResponse, ResthopperTree } from '@/lib/compute/types';
import { firstBranchItems } from '@/lib/graph/values';
import { catalogEntry } from '@/components/canvas/nodeCatalog';
import type { GHWebDocument, GraphNode } from './schema';
import { EMPTY, fromResthopperItems, raw, toResthopperTree, wrapCompute, type RuntimeValue } from './runtime';

export type NodeState = 'idle' | 'solving' | 'done' | 'error';
export interface NodeResult {
  state: NodeState;
  outputs: Record<string, RuntimeValue>;
  message?: string;
  durationMs?: number;
}

export interface EvalServices {
  compute(endpoint: string, args: unknown[]): Promise<unknown>;
  describeHops(node: GraphNode): Promise<IoResponse>;
  solveHops(node: GraphNode, values: ResthopperTree[]): Promise<GrasshopperSolveResponse>;
}

function defaultValue(value: unknown): RuntimeValue {
  if (typeof value === 'number') return { kind: 'number', value };
  if (typeof value === 'boolean') return { kind: 'boolean', value };
  if (typeof value === 'string') return { kind: 'text', value };
  return EMPTY;
}

function cloneDefaultTree(name: string, tree: ResthopperTree): ResthopperTree {
  return {
    ParamName: name,
    InnerTree: Object.fromEntries(
      Object.entries(tree.InnerTree).map(([path, items]) => [path, items.map(item => ({ ...item }))]),
    ),
  };
}

export async function evaluateDocument(doc: GHWebDocument, services: EvalServices, previousResults: Record<string, NodeResult> = {}): Promise<Record<string, NodeResult>> {
  const results: Record<string, NodeResult> = {};
  const pending = new Set(doc.nodes.map(n => n.id));

  const incoming = new Map<string, typeof doc.edges>();
  for (const node of doc.nodes) incoming.set(node.id, doc.edges.filter(edge => edge.target.node === node.id));

  const getInputs = (node: GraphNode): Record<string, RuntimeValue> | null => {
    const entry = catalogEntry(node.component);
    if (!entry) return {};
    const map: Record<string, RuntimeValue> = {};
    for (const port of entry.inputs) {
      const edge = incoming.get(node.id)?.find(e => e.target.port === port.name);
      if (edge) {
        const source = results[edge.source.node];
        if (!source || source.state !== 'done') return null;
        map[port.name] = source.outputs[edge.source.port] ?? EMPTY;
      } else if (port.defaultValue !== undefined) {
        map[port.name] = defaultValue(port.defaultValue);
      }
    }
    return map;
  };

  while (pending.size) {
    let progressed = false;
    for (const id of [...pending]) {
      const node = doc.nodes.find(n => n.id === id)!;
      const entry = catalogEntry(node.component);
      if (!entry) {
        results[id] = { state: 'error', outputs: {}, message: `Unknown component ${node.component}` };
        pending.delete(id); progressed = true; continue;
      }

      if (entry.runtime === 'action') {
        results[id] = previousResults[id] ?? { state: 'idle', outputs: {} };
        pending.delete(id);
        progressed = true;
        continue;
      }

      let inputs = getInputs(node);
      if (entry.runtime === 'hops') {
        const edges = incoming.get(node.id) ?? [];
        inputs = {};
        let waiting = false;
        for (const edge of edges) {
          const source = results[edge.source.node];
          if (!source || source.state !== 'done') { waiting = true; break; }
          inputs[edge.target.port] = source.outputs[edge.source.port] ?? EMPTY;
        }
        if (waiting) continue;
      } else if (inputs === null) continue;

      pending.delete(id);
      progressed = true;
      const started = performance.now();
      try {
        if (entry.runtime === 'local' || entry.runtime === 'display') {
          const outputs = await entry.evaluate?.(inputs ?? {}, node.values, services) ?? {};
          results[id] = { state: 'done', outputs, durationMs: performance.now() - started };
          continue;
        }

        if (entry.runtime === 'compute' && entry.compute) {
          const args = entry.compute.buildArgs
            ? entry.compute.buildArgs(inputs ?? {})
            : entry.inputs.map(port => raw((inputs ?? {})[port.name] ?? defaultValue(port.defaultValue)));
          const response = await services.compute(entry.compute.endpoint, args);
          const outputName = entry.outputs[0]?.name ?? 'R';
          results[id] = {
            state: 'done',
            outputs: { [outputName]: wrapCompute(response, entry.compute.outputType) },
            durationMs: performance.now() - started,
          };
          continue;
        }

        if (entry.runtime === 'hops') {
          const io = await services.describeHops(node);
          const connectedInputs = inputs ?? {};
          const trees: ResthopperTree[] = [];

          for (const param of io.Inputs) {
            // Grasshopper semantics: an unwired parameter keeps the default baked
            // into the definition. Sending an empty tree here would explicitly
            // override that default, which was the source of the initial 400s.
            if (Object.prototype.hasOwnProperty.call(connectedInputs, param.Name)) {
              trees.push(toResthopperTree(param.Name, connectedInputs[param.Name]));
            } else if (param.Default) {
              trees.push(cloneDefaultTree(param.Name, param.Default));
            }
          }

          const response = await services.solveHops(node, trees);
          if (response.errors?.length) throw new Error(response.errors.join(' · '));

          const values = response.values ?? Object.values(response['values-grasshopper']?.Values ?? {});
          const outputs: Record<string, RuntimeValue> = {};
          for (const tree of values) outputs[tree.ParamName] = fromResthopperItems(firstBranchItems(tree));
          results[id] = {
            state: 'done',
            outputs,
            message: response.warnings?.length ? response.warnings.join(' · ') : undefined,
            durationMs: performance.now() - started,
          };
          continue;
        }
      } catch (error) {
        results[id] = {
          state: 'error',
          outputs: {},
          message: error instanceof Error ? error.message : String(error),
          durationMs: performance.now() - started,
        };
      }
    }

    if (!progressed) {
      for (const id of pending) results[id] = { state: 'error', outputs: {}, message: 'Unresolved dependency or graph cycle' };
      break;
    }
  }

  return results;
}
