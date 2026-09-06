# Grasshopper Web

A browser-based, Grasshopper-style node editor backed by `rhino3dm`, Rhino Compute, and Hops.

## Features

- Connectable node canvas with Bezier wires, search, ribbon tools, autosolve, and manual solve.
- Local math, parameter, list/tree, text, point/vector, and geometry nodes.
- Rhino Compute-backed geometry operations.
- Hops nodes for loading and solving existing `.gh` / `.ghx` definitions.
- Rhino-style Z-up 3D preview with orbit, pan, zoom, standard views, and Compute-generated render meshes.
- Panel nodes render normal text or collapsible JSON trees automatically.
- Import/export of `.ghweb.json` documents with browser autosave.
- On-demand Grasshopper Python generator and explicit file download action nodes.

## Run

```bash
cp .env.example .env.local
npm install
npm run dev
```

Configure Rhino Compute in `.env.local`:

```bash
RHINO_COMPUTE_URL=http://localhost:6500
RHINO_COMPUTE_KEY=
RHINO_COMPUTE_TOKEN=
```

For the optional Python generator node, configure a trusted Rhino/Grasshopper-capable runner:

```bash
GRASSHOPPER_GENERATOR_URL=
GRASSHOPPER_GENERATOR_TOKEN=
```

## Hops

Add a **Hops Function** node, load a `.gh` / `.ghx` file or URL, refresh its ports from Compute, then wire it into the graph like any other node.

## License

Free for personal and non-commercial use. Commercial use requires a separate license. See [LICENSE](./LICENSE).
