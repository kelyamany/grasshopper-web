/**
 * rhino3dm runtime loader (browser only).
 *
 * Loads /rhino3dm.min.js as a plain script tag instead of importing the npm
 * package, so the bundler never pulls in rhino3dm's Node-only UMD branch
 * (same approach as the Knurl viewer). The WASM lives in /public, copied by
 * the postinstall script.
 */

type Rhino3dmModule = typeof import('rhino3dm');
export type RhinoModule = Awaited<ReturnType<Rhino3dmModule['default']>>;

type Rhino3dmLoader = (config?: { locateFile?: (path: string) => string }) => Promise<RhinoModule>;

declare global {
  interface Window {
    rhino3dm?: Rhino3dmLoader;
  }
}

const SCRIPT_ID = 'rhino3dm-runtime-script';
const SCRIPT_SRC = '/rhino3dm.min.js';
const WASM_SRC = '/rhino3dm.wasm';

let instance: RhinoModule | null = null;
let loading: Promise<RhinoModule> | null = null;

export function getRhino(): Promise<RhinoModule> {
  if (instance) return Promise.resolve(instance);
  if (loading) return loading;

  loading = (async () => {
    const factory = await loadFactory();
    const runtime = await factory({
      locateFile: (path) => (path.endsWith('.wasm') ? WASM_SRC : path),
    });
    instance = runtime;
    return runtime;
  })();

  return loading;
}

async function loadFactory(): Promise<Rhino3dmLoader> {
  if (window.rhino3dm) return window.rhino3dm;

  return new Promise<Rhino3dmLoader>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing?.dataset.rhino3dmLoaded === 'true') {
      resolve(window.rhino3dm as Rhino3dmLoader);
      return;
    }

    const script = existing ?? document.createElement('script');
    script.addEventListener(
      'load',
      () => {
        script.dataset.rhino3dmLoaded = 'true';
        resolve(window.rhino3dm as Rhino3dmLoader);
      },
      { once: true },
    );
    script.addEventListener(
      'error',
      () => reject(new Error(`Failed to load ${SCRIPT_SRC}`)),
      { once: true },
    );

    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}
