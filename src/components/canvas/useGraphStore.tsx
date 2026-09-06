'use client';

import { useEffect, type ReactNode } from 'react';
import { create } from 'zustand';

import type { IoResponse, GrasshopperSolveResponse, ResthopperTree } from '@/lib/compute/types';
import { evaluateDocument, type NodeResult } from '@/lib/graph/evaluator';
import { filesOf, type RuntimeValue } from '@/lib/graph/runtime';
import { emptyDocument, newId, parseDocument, type GHWebDocument, type GraphNode } from '@/lib/graph/schema';
import { createNode } from './nodeCatalog';

interface Store {
  document: GHWebDocument;
  selection: string | null;
  activeNodeId: string | null;
  results: Record<string, NodeResult>;
  ioCache: Record<string, IoResponse>;
  solving: boolean;
  autoSolve: boolean;
  previewOpen: boolean;
  lastSolveMs: number | null;
  hydrated: boolean;

  hydrate(): void;
  select(id: string | null): void;
  openNode(id: string): void;
  closeNode(): void;
  addComponent(component: string, position: { x: number; y: number }): GraphNode;
  addNode(node: GraphNode): void;
  updateNode(id: string, patch: Partial<GraphNode>): void;
  moveNode(id: string, position: { x: number; y: number }): void;
  removeNodes(ids: string[]): void;
  duplicateNodes(ids: string[]): string[];
  connect(sourceNode: string, sourcePort: string, targetNode: string, targetPort: string): void;
  disconnect(id: string): void;
  setAutoSolve(v: boolean): void;
  setPreviewOpen(v: boolean): void;
  setDocumentName(v: string): void;
  replaceDocument(doc: GHWebDocument): void;
  solve(): Promise<void>;
  runAction(id: string): Promise<void>;
  describeHops(node: GraphNode): Promise<IoResponse>;
}

const STORAGE = 'grasshopper-web-doc-v2';
let solveTimer: ReturnType<typeof setTimeout> | null = null;
let solveRequestedWhileRunning = false;
const hopsPending = new Map<string, Promise<IoResponse>>();
const hopsResolved = new Map<string, IoResponse>();

function seed(): GHWebDocument {
  const doc = emptyDocument();
  doc.name = 'Plywood concept';

  const width = createNode('params.number', { x: 80, y: 150 });
  width.title = 'Width';
  width.values = { value: 900, min: 300, max: 1800 };

  const height = createNode('params.number', { x: 80, y: 280 });
  height.title = 'Height';
  height.values = { value: 720, min: 300, max: 1800 };

  const thickness = createNode('params.number', { x: 80, y: 410 });
  thickness.title = 'Plywood';
  thickness.values = { value: 18, min: 6, max: 36 };

  const hops = createNode('hops.definition', { x: 390, y: 230 });
  hops.title = 'Furniture definition';

  const preview = createNode('display.preview', { x: 760, y: 260 });

  doc.nodes = [width, height, thickness, hops, preview];
  return doc;
}

function persistDocument(doc: GHWebDocument) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE, JSON.stringify(doc));
  } catch (error) {
    console.warn('[GHWeb][storage] Autosave failed.', error);
  }
}

function hopsKey(node: GraphNode): string {
  return node.hops?.pointer
    ? `p:${node.hops.pointer}`
    : `a:${node.hops?.algo?.length ?? 0}:${node.hops?.algo?.slice(0, 32) ?? ''}`;
}

async function readApiJson<T>(response: Response, label: string): Promise<T> {
  const raw = await response.text();
  let payload: unknown = null;

  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = { error: raw || `${label} returned invalid JSON` };
  }

  if (!response.ok) {
    console.error(`[GHWeb][${label}] HTTP ${response.status}`, payload);
    const p = payload as { error?: string; message?: string } | null;
    throw new Error(p?.error ?? p?.message ?? `${label} failed (${response.status})`);
  }

  const p = payload as {
    warnings?: string[];
    Warnings?: string[];
    errors?: string[];
    Errors?: string[];
  } | null;

  const warnings = p?.warnings ?? p?.Warnings ?? [];
  const errors = p?.errors ?? p?.Errors ?? [];
  if (warnings.length) console.warn(`[GHWeb][${label}] warnings`, warnings);
  if (errors.length) console.error(`[GHWeb][${label}] errors`, errors);

  return payload as T;
}

function scheduleSolve(get: () => Store, delay = 260) {
  if (!get().hydrated || !get().autoSolve) return;

  if (get().solving) {
    solveRequestedWhileRunning = true;
    return;
  }

  if (solveTimer) clearTimeout(solveTimer);
  solveTimer = setTimeout(() => {
    solveTimer = null;
    void get().solve().catch(() => undefined);
  }, delay);
}

export const useGraphStore = create<Store>((set, get) => ({
  document: emptyDocument(),
  selection: null,
  activeNodeId: null,
  results: {},
  ioCache: {},
  solving: false,
  autoSolve: true,
  previewOpen: true,
  lastSolveMs: null,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;

    let document = seed();
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(STORAGE);
        if (raw) document = parseDocument(JSON.parse(raw));
      } catch (error) {
        console.warn('[GHWeb][storage] Could not restore saved definition; using starter document.', error);
      }
    }

    set({ document, hydrated: true });
    scheduleSolve(get, 80);
  },

  select: (id) => {
    if (get().selection === id) return;
    set({ selection: id });
  },

  openNode: (id) => {
    if (get().selection === id && get().activeNodeId === id) return;
    set({ selection: id, activeNodeId: id });
  },

  closeNode: () => {
    if (get().activeNodeId === null) return;
    set({ activeNodeId: null });
  },

  addNode: (node) => {
    const document = { ...get().document, nodes: [...get().document.nodes, node] };
    set({ document, selection: node.id });
    persistDocument(document);
    scheduleSolve(get);
  },

  addComponent: (component, position) => {
    const node = createNode(component, position);
    get().addNode(node);
    return node;
  },

  updateNode: (id, patch) => {
    const document = {
      ...get().document,
      nodes: get().document.nodes.map((node) => node.id === id ? { ...node, ...patch } : node),
    };

    set({ document });
    persistDocument(document);

    if ('values' in patch || 'hops' in patch || 'component' in patch) {
      scheduleSolve(get);
    }
  },

  moveNode: (id, position) => {
    const document = {
      ...get().document,
      nodes: get().document.nodes.map((node) => node.id === id ? { ...node, position } : node),
    };
    set({ document });
    persistDocument(document);
  },

  removeNodes: (ids) => {
    const remove = new Set(ids);
    const current = get().document;
    const document = {
      ...current,
      nodes: current.nodes.filter((node) => !remove.has(node.id)),
      edges: current.edges.filter((edge) => !remove.has(edge.source.node) && !remove.has(edge.target.node)),
    };

    const patch: Partial<Store> = { document };
    if (get().selection && remove.has(get().selection!)) patch.selection = null;
    if (get().activeNodeId && remove.has(get().activeNodeId!)) patch.activeNodeId = null;

    set(patch);
    persistDocument(document);
    scheduleSolve(get);
  },

  duplicateNodes: (ids) => {
    const current = get().document;
    const selected = new Set(ids);
    const idMap = new Map<string, string>();
    const copies: GraphNode[] = [];

    for (const node of current.nodes) {
      if (!selected.has(node.id)) continue;
      const copyId = newId(node.component.split('.').at(-1) ?? 'node');
      idMap.set(node.id, copyId);
      copies.push({
        ...node,
        id: copyId,
        position: { x: node.position.x + 48, y: node.position.y + 48 },
        values: { ...node.values },
        hops: node.hops ? { ...node.hops } : undefined,
      });
    }

    const copiedEdges = current.edges
      .filter((edge) => idMap.has(edge.source.node) && idMap.has(edge.target.node))
      .map((edge) => ({
        ...edge,
        id: newId('wire'),
        source: { ...edge.source, node: idMap.get(edge.source.node)! },
        target: { ...edge.target, node: idMap.get(edge.target.node)! },
      }));

    const document = {
      ...current,
      nodes: [...current.nodes, ...copies],
      edges: [...current.edges, ...copiedEdges],
    };

    const newIds = copies.map((node) => node.id);
    set({ document, selection: newIds.at(-1) ?? null });
    persistDocument(document);
    scheduleSolve(get);
    return newIds;
  },

  connect: (sourceNode, sourcePort, targetNode, targetPort) => {
    const current = get().document;
    const document = {
      ...current,
      edges: [
        ...current.edges.filter((edge) => !(edge.target.node === targetNode && edge.target.port === targetPort)),
        {
          id: newId('wire'),
          source: { node: sourceNode, port: sourcePort },
          target: { node: targetNode, port: targetPort },
        },
      ],
    };

    set({ document });
    persistDocument(document);
    scheduleSolve(get);
  },

  disconnect: (id) => {
    const document = {
      ...get().document,
      edges: get().document.edges.filter((edge) => edge.id !== id),
    };
    set({ document });
    persistDocument(document);
    scheduleSolve(get);
  },

  setAutoSolve: (autoSolve) => {
    set({ autoSolve });
    if (autoSolve) scheduleSolve(get, 40);
  },

  setPreviewOpen: (previewOpen) => set({ previewOpen }),

  setDocumentName: (name) => {
    const document = { ...get().document, name };
    set({ document });
    persistDocument(document);
  },

  replaceDocument: (document) => {
    set({
      document,
      selection: null,
      activeNodeId: null,
      results: {},
      ioCache: {},
    });
    persistDocument(document);
    scheduleSolve(get, 80);
  },

  describeHops: async (node) => {
    if (!node.hops || (!node.hops.pointer && !node.hops.algo)) {
      throw new Error('Hops source is not configured');
    }

    const key = hopsKey(node);
    const cached = get().ioCache[key];
    if (cached) return cached;

    const resolved = hopsResolved.get(key);
    if (resolved) {
      const current = get().ioCache[key];
      if (!current) set({ ioCache: { ...get().ioCache, [key]: resolved } });
      return resolved;
    }

    const existing = hopsPending.get(key);
    if (existing) return existing;

    const request = (async () => {
      console.info('[GHWeb][Hops I/O] Inspecting definition', {
        node: node.title,
        source: node.hops?.pointer
          || (node.hops?.algo ? `embedded ${Math.round(node.hops.algo.length * 0.75 / 1024)} KB` : 'none'),
      });

      const response = await fetch('/api/compute/io', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(node.hops),
      });

      const payload = await readApiJson<IoResponse>(response, 'Hops I/O');
      if (payload.Errors?.length) throw new Error(payload.Errors.join(' · '));
      if (payload.Warnings?.length) console.warn('[GHWeb][Hops I/O] Definition warnings', payload.Warnings);

      hopsResolved.set(key, payload);

      const current = get().ioCache[key];
      if (!current) set({ ioCache: { ...get().ioCache, [key]: payload } });
      return payload;
    })().finally(() => {
      hopsPending.delete(key);
    });

    hopsPending.set(key, request);
    return request;
  },

  runAction: async (id) => {
    const node = get().document.nodes.find((item) => item.id === id);
    if (!node) throw new Error('Action node not found');

    const setResult = (result: NodeResult) => {
      set({ results: { ...get().results, [id]: result } });
    };

    const connectedInput = (port: string): RuntimeValue | undefined => {
      const edge = get().document.edges.find((item) => item.target.node === id && item.target.port === port);
      return edge ? get().results[edge.source.node]?.outputs[edge.source.port] : undefined;
    };

    setResult({ state: 'solving', outputs: get().results[id]?.outputs ?? {} });

    try {
      if (node.component === 'hops.python-generator') {
        let scriptValue = connectedInput('Script');
        if (!scriptValue && get().document.edges.some((edge) => edge.target.node === id && edge.target.port === 'Script')) {
          await get().solve();
          scriptValue = connectedInput('Script');
        }

        const script = scriptValue?.kind === 'text'
          ? scriptValue.value
          : String(node.values.script ?? '');

        if (!script.trim()) throw new Error('Paste a Rhino/Grasshopper Python generator script or connect a text Panel.');

        const response = await fetch('/api/generator/grasshopper', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            script,
            name: String(node.values.jobName ?? 'grasshopper-catalog'),
          }),
        });

        const payload = await readApiJson<{
          files: { name: string; mime?: string; base64: string }[];
          warnings?: string[];
          log?: string;
        }>(response, 'Grasshopper generator');

        const fileValues: RuntimeValue[] = (payload.files ?? []).map((file) => ({
          kind: 'file',
          name: file.name,
          mime: file.mime || 'application/octet-stream',
          base64: file.base64,
        }));

        if (!fileValues.length) throw new Error('Generator returned no files.');

        setResult({
          state: 'done',
          outputs: {
            Files: fileValues.length === 1 ? fileValues[0] : { kind: 'list', items: fileValues },
            Log: { kind: 'text', value: payload.log ?? payload.warnings?.join('\n') ?? `Generated ${fileValues.length} file(s)` },
          },
          message: payload.warnings?.length ? payload.warnings.join(' · ') : undefined,
        });
        return;
      }

      if (node.component === 'files.download') {
        let input = connectedInput('Files');
        if (!input && get().document.edges.some((edge) => edge.target.node === id && edge.target.port === 'Files')) {
          await get().solve();
          input = connectedInput('Files');
        }

        let files = filesOf(input);
        if (!files.length) throw new Error('Connect generated file output before downloading.');

        if (Boolean(node.values.preferArchive ?? true)) {
          const archive = files.find((file) => /\.(zip|tar|tgz|gz)$/i.test(file.name));
          if (archive) files = [archive];
        }

        for (const file of files) {
          const binary = atob(file.base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const url = URL.createObjectURL(new Blob([bytes], { type: file.mime || 'application/octet-stream' }));
          const anchor = window.document.createElement('a');
          anchor.href = url;
          anchor.download = file.name;
          anchor.style.display = 'none';
          window.document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }

        setResult({
          state: 'done',
          outputs: {},
          message: `Downloaded ${files.length} file${files.length === 1 ? '' : 's'}`,
        });
        return;
      }

      throw new Error(`Unsupported action node: ${node.component}`);
    } catch (error) {
      setResult({
        state: 'error',
        outputs: get().results[id]?.outputs ?? {},
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },

  solve: async () => {
    if (get().solving) {
      solveRequestedWhileRunning = true;
      return;
    }

    set({ solving: true });
    const document = get().document;
    const started = performance.now();

    console.info('[GHWeb][solve] Starting solution', {
      document: document.name,
      nodes: document.nodes.length,
      edges: document.edges.length,
    });

    try {
      const result = await evaluateDocument(document, {
        compute: async (endpoint, args) => {
          const response = await fetch('/api/compute/call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint, args }),
          });
          const payload = await readApiJson<{ result: unknown }>(response, `Compute ${endpoint}`);
          return payload.result;
        },

        describeHops: get().describeHops,

        solveHops: async (node, values: ResthopperTree[]) => {
          console.info('[GHWeb][Hops solve] Sending values', {
            node: node.title,
            params: values.map((tree) => ({
              name: tree.ParamName,
              branches: Object.keys(tree.InnerTree).length,
              items: Object.values(tree.InnerTree).reduce((sum, items) => sum + items.length, 0),
            })),
          });

          const response = await fetch('/api/compute/grasshopper', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...node.hops,
              values,
              settings: document.settings,
            }),
          });

          return readApiJson<GrasshopperSolveResponse>(response, `Hops solve: ${node.title}`);
        },
      }, get().results);

      const failed = Object.entries(result).filter(([, value]) => value.state === 'error');
      const warnings = Object.entries(result).filter(([, value]) => value.state === 'done' && value.message);

      if (failed.length) {
        console.error('[GHWeb][solve] Node failures', failed.map(([id, value]) => ({ id, message: value.message })));
      }
      if (warnings.length) {
        console.warn('[GHWeb][solve] Node warnings', warnings.map(([id, value]) => ({ id, message: value.message })));
      }

      const elapsed = performance.now() - started;
      set({ results: result, lastSolveMs: elapsed });

      console.info(`[GHWeb][solve] Completed in ${Math.round(elapsed)} ms`);
    } catch (error) {
      console.error('[GHWeb][solve] Unexpected solver failure', error);
      throw error;
    } finally {
      set({ solving: false });

      if (solveRequestedWhileRunning) {
        solveRequestedWhileRunning = false;
        scheduleSolve(get, 80);
      }
    }
  },
}));

export function GraphStoreProvider({ children }: { children: ReactNode }) {
  const hydrate = useGraphStore((state) => state.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return children;
}
