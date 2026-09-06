'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  SelectionMode,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react';
import {
  Copy,
  Maximize,
  Maximize2,
  MousePointer2,
  Play,
  Plus,
  Search,
  Settings2,
  Trash2,
  Unplug,
} from 'lucide-react';

import type { IoInputParam, ResthopperTree } from '@/lib/compute/types';
import { GHNode, type GHNodeData } from './GHNode';
import { catalogEntry, type PortSpec, type PortType } from './nodeCatalog';
import { CanvasContextMenu, type CanvasContextMenuItem } from './CanvasContextMenu';
import { NodeCreator } from './NodeCreator';
import { useGraphStore } from './useGraphStore';

const nodeTypes: NodeTypes = { gh: GHNode };
const SNAP_GRID: [number, number] = [10, 10];
const FIT_VIEW_OPTIONS = { padding: 0.22 };
const PRO_OPTIONS = { hideAttribution: true };
const DEFAULT_EDGE_OPTIONS = { type: 'bezier' as const };

function sameStringArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function samePortSpecs(a: PortSpec[], b: PortSpec[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((left, index) => {
    const right = b[index];
    return Boolean(right)
      && left.name === right.name
      && left.type === right.type
      && left.optional === right.optional
      && JSON.stringify(left.defaultValue) === JSON.stringify(right.defaultValue);
  });
}

function sameConnectedInputs(a: Record<string, boolean>, b: Record<string, boolean>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return aKeys.length === bKeys.length && aKeys.every((key) => a[key] === b[key]);
}

function sameMappedNode(a: Node<GHNodeData>, b: Node<GHNodeData>): boolean {
  return a.id === b.id
    && a.position.x === b.position.x
    && a.position.y === b.position.y
    && a.selected === b.selected
    && samePortSpecs(a.data.inputs, b.data.inputs)
    && samePortSpecs(a.data.outputs, b.data.outputs)
    && sameConnectedInputs(a.data.connectedInputs, b.data.connectedInputs);
}

function hopsKey(node: { hops?: { pointer?: string; algo?: string } }): string {
  return node.hops?.pointer
    ? `p:${node.hops.pointer}`
    : `a:${node.hops?.algo?.length ?? 0}:${node.hops?.algo?.slice(0, 32) ?? ''}`;
}

function portType(paramType: string): PortType {
  switch (paramType.toLowerCase()) {
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'text':
    case 'string':
      return 'text';
    case 'point':
      return 'point';
    case 'vector':
      return 'vector';
    case 'curve':
    case 'line':
      return 'curve';
    case 'surface':
      return 'surface';
    case 'brep':
    case 'box':
      return 'brep';
    case 'mesh':
      return 'mesh';
    default:
      return 'geometry';
  }
}

function defaultFromTree(tree: ResthopperTree | null | undefined): unknown {
  if (!tree) return undefined;
  const item = Object.values(tree.InnerTree).flat()[0];
  if (!item) return undefined;

  try {
    return JSON.parse(item.data) as unknown;
  } catch {
    return item.data;
  }
}

function dynamicInput(param: IoInputParam): PortSpec {
  return {
    name: param.Name,
    type: portType(param.ParamType),
    optional: param.AtLeast === 0 || Boolean(param.Default),
    defaultValue: defaultFromTree(param.Default),
  };
}

function shouldIgnoreShortcut(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return (
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)
    || element.isContentEditable
    || Boolean(element.closest('[role="dialog"]'))
    || Boolean(element.closest('.ignore-canvas-shortcuts'))
  );
}

interface MenuState {
  x: number;
  y: number;
  kind: 'pane' | 'node' | 'edge';
  id?: string;
}

export function GraphCanvas() {
  const document = useGraphStore((state) => state.document);
  const ioCache = useGraphStore((state) => state.ioCache);
  const results = useGraphStore((state) => state.results);
  const select = useGraphStore((state) => state.select);
  const openNode = useGraphStore((state) => state.openNode);
  const moveNode = useGraphStore((state) => state.moveNode);
  const connect = useGraphStore((state) => state.connect);
  const disconnect = useGraphStore((state) => state.disconnect);
  const removeNodes = useGraphStore((state) => state.removeNodes);
  const duplicateNodes = useGraphStore((state) => state.duplicateNodes);
  const addComponent = useGraphStore((state) => state.addComponent);
  const describeHops = useGraphStore((state) => state.describeHops);
  const solve = useGraphStore((state) => state.solve);

  const wrapper = useRef<HTMLDivElement>(null);
  const [rf, setRf] = useState<ReactFlowInstance<Node<GHNodeData>, Edge> | null>(null);
  const [flowNodes, setFlowNodes] = useState<Node<GHNodeData>[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [insertPosition, setInsertPosition] = useState<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    for (const node of document.nodes) {
      if (node.component !== 'hops.definition') continue;
      if (!node.hops?.pointer && !node.hops?.algo) continue;
      if (ioCache[hopsKey(node)]) continue;

      void describeHops(node).catch((error) => {
        console.error('[GHWeb][Hops I/O] Could not load ports', error);
      });
    }
  }, [document.nodes, ioCache, describeHops]);

  const mappedNodes = useMemo<Node<GHNodeData>[]>(() => document.nodes.map((node) => {
    const entry = catalogEntry(node.component);
    let inputs: PortSpec[] = entry?.inputs ?? [];
    let outputs: PortSpec[] = entry?.outputs ?? [];

    if (node.component === 'hops.definition') {
      const io = ioCache[hopsKey(node)];
      inputs = (io?.Inputs ?? []).map(dynamicInput);
      outputs = (io?.Outputs ?? []).map((param) => ({
        name: param.Name,
        type: portType(param.ParamType),
      }));
    }

    const connectedInputs: Record<string, boolean> = {};
    for (const edge of document.edges) {
      if (edge.target.node === node.id) connectedInputs[edge.target.port] = true;
    }

    return {
      id: node.id,
      type: 'gh',
      position: node.position,
      dragHandle: '.gh-node-drag-handle',
      data: {
        nodeId: node.id,
        inputs,
        outputs,
        connectedInputs,
      },
    };
  }), [document.nodes, document.edges, ioCache]);

  useEffect(() => {
    setFlowNodes((current) => {
      const currentById = new Map(current.map((node) => [node.id, node]));
      const next = mappedNodes.map((mapped) => {
        const existing = currentById.get(mapped.id);
        const candidate = {
          ...mapped,
          position: existing?.position ?? mapped.position,
          selected: existing?.selected ?? false,
        };

        return existing && sameMappedNode(existing, candidate) ? existing : candidate;
      });

      if (
        current.length === next.length
        && current.every((node, index) => node === next[index])
      ) {
        return current;
      }

      return next;
    });
  }, [mappedNodes]);

  const edges = useMemo<Edge[]>(() => document.edges.map((edge) => ({
    id: edge.id,
    source: edge.source.node,
    target: edge.target.node,
    sourceHandle: edge.source.port,
    targetHandle: edge.target.port,
    type: 'bezier',
    style: {
      stroke: results[edge.source.node]?.state === 'error' ? '#df5d5d' : '#a9a9b2',
      strokeWidth: 2,
    },
  })), [document.edges, results]);

  const canvasCenter = useCallback(() => {
    if (!rf || !wrapper.current) return { x: 0, y: 0 };
    const rect = wrapper.current.getBoundingClientRect();
    return rf.screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  }, [rf]);

  const openCreator = useCallback((position?: { x: number; y: number }) => {
    setInsertPosition(position ?? canvasCenter());
    setMenu(null);
    setCreatorOpen(true);
  }, [canvasCenter]);

  const selectOnly = useCallback((id: string) => {
    setFlowNodes((nodes) => nodes.map((node) => ({ ...node, selected: node.id === id })));
    setSelectedIds([id]);
    select(id);
  }, [select]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreShortcut(event.target)) return;

      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (event.key === 'Escape') {
        if (menu) {
          event.preventDefault();
          setMenu(null);
          return;
        }
        if (creatorOpen) {
          event.preventDefault();
          setCreatorOpen(false);
          return;
        }
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIds.length) {
        event.preventDefault();
        removeNodes(selectedIds);
        setSelectedIds([]);
        return;
      }

      if (mod && key === 'd' && selectedIds.length) {
        event.preventDefault();
        const newIds = duplicateNodes(selectedIds);
        setSelectedIds(newIds);
        return;
      }

      if (mod && key === 'a') {
        event.preventDefault();
        const ids = flowNodes.map((node) => node.id);
        setFlowNodes((nodes) => nodes.map((node) => ({ ...node, selected: true })));
        setSelectedIds(ids);
        select(ids.length === 1 ? ids[0] : null);
        return;
      }

      if ((mod && key === 'k') || (!mod && key === 'n')) {
        event.preventDefault();
        openCreator();
        return;
      }

      if (event.key === 'Enter' && selectedIds.length === 1) {
        event.preventDefault();
        openNode(selectedIds[0]);
        return;
      }

      if (event.key === '1' && rf) {
        event.preventDefault();
        void rf.fitView({ padding: 0.22, duration: 180 });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    creatorOpen,
    duplicateNodes,
    flowNodes,
    menu,
    openCreator,
    openNode,
    removeNodes,
    rf,
    select,
    selectedIds,
  ]);

  const onNodesChange = useCallback((changes: NodeChange<Node<GHNodeData>>[]) => {
    const removed = changes.filter((change) => change.type === 'remove').map((change) => change.id);
    if (removed.length) removeNodes(removed);

    setFlowNodes((nodes) => applyNodeChanges(
      changes.filter((change) => change.type !== 'remove'),
      nodes,
    ));
  }, [removeNodes]);

  const onSelectionChange = useCallback(({ nodes }: { nodes: Node<GHNodeData>[] }) => {
    const ids = nodes.map((node) => node.id);
    setSelectedIds((current) => sameStringArray(current, ids) ? current : ids);
    select(ids.length === 1 ? ids[0] : null);
  }, [select]);

  const onPaneClick = useCallback(() => {
    setMenu(null);
    setSelectedIds((current) => current.length ? [] : current);
    select(null);
  }, [select]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    for (const change of changes) {
      if (change.type === 'remove') disconnect(change.id);
    }
  }, [disconnect]);

  const onConnect = useCallback((connection: Connection) => {
    if (
      connection.source
      && connection.sourceHandle
      && connection.target
      && connection.targetHandle
    ) {
      connect(
        connection.source,
        connection.sourceHandle,
        connection.target,
        connection.targetHandle,
      );
    }
  }, [connect]);

  const menuItems = useMemo<CanvasContextMenuItem[]>(() => {
    if (!menu) return [];

    if (menu.kind === 'edge' && menu.id) {
      return [
        {
          id: 'disconnect',
          label: 'Delete connection',
          icon: <Unplug size={14} />,
          shortcut: 'Del',
          danger: true,
          onSelect: () => disconnect(menu.id!),
        },
      ];
    }

    if (menu.kind === 'node' && menu.id) {
      const ids = selectedIds.includes(menu.id) ? selectedIds : [menu.id];
      return [
        {
          id: 'open',
          label: 'Open node',
          icon: <Settings2 size={14} />,
          shortcut: 'Enter',
          onSelect: () => openNode(menu.id!),
        },
        {
          id: 'run',
          label: 'Run workflow',
          icon: <Play size={14} />,
          onSelect: () => void solve(),
        },
        {
          id: 'duplicate',
          label: ids.length > 1 ? `Duplicate ${ids.length} nodes` : 'Duplicate',
          icon: <Copy size={14} />,
          shortcut: '⌘D',
          divided: true,
          onSelect: () => {
            const copies = duplicateNodes(ids);
            setSelectedIds(copies);
          },
        },
        {
          id: 'delete',
          label: ids.length > 1 ? `Delete ${ids.length} nodes` : 'Delete',
          icon: <Trash2 size={14} />,
          shortcut: 'Del',
          danger: true,
          onSelect: () => {
            removeNodes(ids);
            setSelectedIds([]);
          },
        },
      ];
    }

    return [
      {
        id: 'add',
        label: 'Add node',
        icon: <Plus size={14} />,
        shortcut: 'N',
        onSelect: () => openCreator(insertPosition ?? canvasCenter()),
      },
      {
        id: 'fit',
        label: 'Fit workflow to view',
        icon: <Maximize size={14} />,
        shortcut: '1',
        divided: true,
        onSelect: () => { if (rf) void rf.fitView({ padding: 0.22, duration: 180 }); },
      },
      {
        id: 'select-all',
        label: 'Select all',
        icon: <MousePointer2 size={14} />,
        shortcut: '⌘A',
        onSelect: () => {
          const ids = flowNodes.map((node) => node.id);
          setFlowNodes((nodes) => nodes.map((node) => ({ ...node, selected: true })));
          setSelectedIds(ids);
        },
      },
    ];
  }, [
    canvasCenter,
    disconnect,
    duplicateNodes,
    flowNodes,
    insertPosition,
    menu,
    openCreator,
    openNode,
    removeNodes,
    rf,
    selectedIds,
    solve,
  ]);

  return (
    <div
      ref={wrapper}
      className="workflow-canvas"
      onDoubleClick={(event) => {
        const target = event.target as HTMLElement;
        if (!target.classList.contains('react-flow__pane') || !rf) return;
        openCreator(rf.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
      }}
    >
      <ReactFlow<Node<GHNodeData>, Edge>
        nodes={flowNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={setRf}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={(_event, node) => moveNode(node.id, node.position)}
        onNodeDoubleClick={(_event, node) => openNode(node.id)}
        onNodeContextMenu={(event, node) => {
          event.preventDefault();
          if (!selectedIds.includes(node.id)) selectOnly(node.id);
          setMenu({ x: event.clientX, y: event.clientY, kind: 'node', id: node.id });
        }}
        onEdgeContextMenu={(event, edge) => {
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY, kind: 'edge', id: edge.id });
        }}
        onPaneContextMenu={(event) => {
          event.preventDefault();
          if (rf) {
            setInsertPosition(rf.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
          }
          setMenu({ x: event.clientX, y: event.clientY, kind: 'pane' });
        }}
        onSelectionChange={onSelectionChange}
        onPaneClick={onPaneClick}
        deleteKeyCode={null}
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        panOnDrag={[1, 2]}
        panActivationKeyCode="Space"
        snapToGrid
        snapGrid={SNAP_GRID}
        minZoom={0.18}
        maxZoom={2.4}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        proOptions={PRO_OPTIONS}
        defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="#ddddE3"
        />
        <Controls position="bottom-left" showInteractive={false} />
      </ReactFlow>

      <div className="canvas-actions">
        <button onClick={() => openCreator()} title="Add node (N)">
          <Plus size={18} />
        </button>
        <button onClick={() => openCreator()} title="Search nodes (⌘K)">
          <Search size={17} />
        </button>
        <button
          onClick={() => { if (rf) void rf.fitView({ padding: 0.22, duration: 180 }); }}
          title="Fit workflow (1)"
        >
          <Maximize2 size={17} />
        </button>
      </div>

      <div className="canvas-shortcuts">
        <span>N</span> add node
        <i>·</i>
        <span>Space</span> pan
        <i>·</i>
        <span>Del</span> delete
        <i>·</i>
        <span>Enter</span> open
      </div>

      <NodeCreator
        open={creatorOpen}
        onClose={() => setCreatorOpen(false)}
        onPick={(component) => {
          const position = insertPosition ?? canvasCenter();
          addComponent(component, position);
          setCreatorOpen(false);
        }}
      />

      {menu ? (
        <CanvasContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}
