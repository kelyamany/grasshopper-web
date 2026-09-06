'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Focus, Move, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import type { PortValue } from '@/lib/graph/values';
import { decodeItems } from '@/lib/geometry/decode';

const MESH_COLOR = 0x8ea4d2;
const LINE_COLOR = 0xd97706;
const POINT_COLOR = 0xfacc15;

type ViewerMode = 'orbit' | 'pan';
type ViewPreset = 'iso' | 'top' | 'front' | 'right';

interface ViewerContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  group: THREE.Group;
}

function createRhinoGrid(size: number): THREE.GridHelper {
  const grid = new THREE.GridHelper(size, 10, 0x3f3f46, 0x27272a);
  // Three.js GridHelper is XZ / Y-up. Rhino is XY / Z-up.
  grid.rotation.x = Math.PI / 2;
  grid.name = 'grid';
  return grid;
}

function frameGeometry(ctx: ViewerContext, preset: ViewPreset = 'iso'): void {
  const { group, camera, controls, scene } = ctx;
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return;

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 0.001);
  const distance = radius / Math.sin((camera.fov * Math.PI) / 360);

  let direction = new THREE.Vector3(1, -1, 0.85).normalize();
  let up = new THREE.Vector3(0, 0, 1);

  if (preset === 'top') {
    direction = new THREE.Vector3(0, 0, 1);
    up = new THREE.Vector3(0, 1, 0);
  } else if (preset === 'front') {
    direction = new THREE.Vector3(0, -1, 0);
  } else if (preset === 'right') {
    direction = new THREE.Vector3(1, 0, 0);
  }

  camera.up.copy(up);
  camera.near = Math.max(distance / 1000, 0.001);
  camera.far = Math.max(distance * 100, 100);
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();

  const gridSize = Math.max(
    10,
    Math.pow(10, Math.ceil(Math.log10(radius * 2.5))),
  );

  const oldGrid = scene.getObjectByName('grid');
  if (oldGrid) {
    scene.remove(oldGrid);
    (oldGrid as THREE.GridHelper).geometry.dispose();
    (oldGrid as THREE.GridHelper).material.dispose();
  }
  scene.add(createRhinoGrid(gridSize));
}

function zoomCamera(ctx: ViewerContext, factor: number): void {
  const offset = ctx.camera.position.clone().sub(ctx.controls.target);
  if (offset.lengthSq() === 0) return;
  offset.multiplyScalar(factor);
  ctx.camera.position.copy(ctx.controls.target).add(offset);
  ctx.controls.update();
}

export function Viewer3D({ value, className }: { value: PortValue | null; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ViewerContext | null>(null);
  const [status, setStatus] = useState<string>('');
  const [failure, setFailure] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewerMode>('orbit');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x141417);

    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / Math.max(container.clientHeight, 1),
      0.01,
      100_000,
    );

    // Keep Rhino's coordinate convention intact: X/Y ground plane, Z up.
    camera.up.set(0, 0, 1);
    camera.position.set(1, -1, 1);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.screenSpacePanning = true;
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(5, -7, 10);
    scene.add(key);
    scene.add(createRhinoGrid(10));

    const axes = new THREE.AxesHelper(1);
    axes.name = 'axes';
    scene.add(axes);

    const group = new THREE.Group();
    group.name = 'geometry';
    scene.add(group);

    sceneRef.current = { renderer, scene, camera, controls, group };

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const observer = new ResizeObserver(() => {
      const width = container.clientWidth;
      const height = Math.max(container.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
      controls.dispose();
      group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      });
      renderer.dispose();
      container.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const controls = sceneRef.current?.controls;
    if (!controls) return;
    controls.mouseButtons.LEFT = mode === 'pan' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    controls.touches.ONE = mode === 'pan' ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
  }, [mode]);

  const setPreset = useCallback((preset: ViewPreset) => {
    const ctx = sceneRef.current;
    if (ctx) frameGeometry(ctx, preset);
  }, []);

  const zoom = useCallback((factor: number) => {
    const ctx = sceneRef.current;
    if (ctx) zoomCamera(ctx, factor);
  }, []);

  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    const { group } = ctx;
    let cancelled = false;

    const run = async (): Promise<void> => {
      for (const child of [...group.children]) {
        group.remove(child);
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      }

      if (!value || value.kind === 'empty') {
        setStatus('');
        setFailure(null);
        return;
      }
      if (value.kind !== 'geometry') {
        setStatus(
          `${value.kind}: ${'value' in value ? String(value.value) : '—'}`,
        );
        setFailure(null);
        return;
      }
      if (value.items.length === 0) {
        setStatus('');
        setFailure(null);
        return;
      }

      setStatus(`Decoding ${value.items.length} item${value.items.length === 1 ? '' : 's'}…`);
      setFailure(null);

      const { geometries, failures } = await decodeItems(value.items);
      if (cancelled) return;
      if (failures.length > 0) setFailure(failures.slice(0, 3).join(' · '));

      for (const geometry of geometries) {
        if (geometry.kind === 'mesh') {
          const bufferGeometry = new THREE.BufferGeometry();
          bufferGeometry.setAttribute('position', new THREE.BufferAttribute(geometry.positions, 3));
          bufferGeometry.setIndex(new THREE.BufferAttribute(geometry.indices, 1));
          bufferGeometry.computeVertexNormals();

          const mesh = new THREE.Mesh(
            bufferGeometry,
            new THREE.MeshStandardMaterial({
              color: MESH_COLOR,
              flatShading: true,
              metalness: 0.1,
              roughness: 0.65,
            }),
          );
          mesh.userData.source = geometry.source;
          group.add(mesh);
        } else if (geometry.kind === 'lines') {
          const bufferGeometry = new THREE.BufferGeometry();
          bufferGeometry.setAttribute('position', new THREE.BufferAttribute(geometry.points, 3));
          const line = new THREE.LineSegments(
            bufferGeometry,
            new THREE.LineBasicMaterial({ color: LINE_COLOR }),
          );
          line.userData.source = geometry.source;
          group.add(line);
        } else {
          const bufferGeometry = new THREE.BufferGeometry();
          bufferGeometry.setAttribute('position', new THREE.BufferAttribute(geometry.positions, 3));
          const points = new THREE.Points(
            bufferGeometry,
            new THREE.PointsMaterial({ color: POINT_COLOR, size: 0.02, sizeAttenuation: true }),
          );
          points.userData.source = geometry.source;
          group.add(points);
        }
      }

      const count = geometries.length;
      const kinds = new Set(geometries.map((g) => g.kind));
      setStatus(
        count === 0
          ? 'No renderable geometry'
          : `${count} ${[...kinds].join(' + ')} object${count === 1 ? '' : 's'}`,
      );

      frameGeometry(ctx, 'iso');
    };

    void run().catch((error: unknown) => {
      if (cancelled) return;
      setFailure(error instanceof Error ? error.message : String(error));
      setStatus('');
    });

    return () => {
      cancelled = true;
    };
  }, [value]);

  const toolButton = 'inline-flex h-7 min-w-7 items-center justify-center rounded border border-zinc-700 bg-zinc-900/90 px-2 text-[9px] font-semibold text-zinc-300 shadow-sm hover:border-zinc-500 hover:bg-zinc-800 hover:text-white';
  const activeToolButton = 'border-violet-500 bg-violet-500/20 text-violet-200';

  return (
    <div className={className ?? 'relative h-full w-full'}>
      <div ref={containerRef} className="h-full w-full" />

      <div className="absolute left-2 top-2 flex flex-wrap items-center gap-1">
        <button
          className={`${toolButton} ${mode === 'orbit' ? activeToolButton : ''}`}
          onClick={() => setMode('orbit')}
          title="Orbit mode — drag left mouse to rotate"
        >
          <RotateCw size={12} />
        </button>
        <button
          className={`${toolButton} ${mode === 'pan' ? activeToolButton : ''}`}
          onClick={() => setMode('pan')}
          title="Pan mode — drag left mouse to pan"
        >
          <Move size={12} />
        </button>
        <button className={toolButton} onClick={() => zoom(0.8)} title="Zoom in">
          <ZoomIn size={12} />
        </button>
        <button className={toolButton} onClick={() => zoom(1.25)} title="Zoom out">
          <ZoomOut size={12} />
        </button>
        <button className={toolButton} onClick={() => setPreset('iso')} title="Fit / isometric">
          <Focus size={12} />
        </button>

        <span className="mx-1 h-5 w-px bg-zinc-700" />

        <button className={toolButton} onClick={() => setPreset('iso')}>ISO</button>
        <button className={toolButton} onClick={() => setPreset('top')}>TOP</button>
        <button className={toolButton} onClick={() => setPreset('front')}>FRONT</button>
        <button className={toolButton} onClick={() => setPreset('right')}>RIGHT</button>
      </div>

      <div className="pointer-events-none absolute left-2 top-11 rounded bg-black/45 px-2 py-1 text-[9px] text-zinc-500">
        Rhino Z-up · left {mode === 'pan' ? 'pan' : 'rotate'} · right pan · wheel zoom
      </div>

      {status ? (
        <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/50 px-2 py-1 font-mono text-[10px] text-zinc-300">
          {status}
        </div>
      ) : null}

      {!value || value.kind === 'empty' ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-zinc-600">
          No geometry — wire an output node
        </div>
      ) : null}

      {failure ? (
        <div className="pointer-events-none absolute bottom-2 right-2 max-w-sm rounded bg-red-950/70 px-2 py-1 font-mono text-[10px] text-red-300">
          {failure}
        </div>
      ) : null}
    </div>
  );
}
