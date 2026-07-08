# Tiled2Retro

Convert Tiled maps to AmiBlitz3 source code (.ab3) with IFF/ILBM tilesheet export. Built with Electron + TypeScript.

## Features

- **Tiled JSON map viewer** — browse a folder with Tiled .json map files + PNG tilesheet, preview the rendered map
- **Multi-bitplane IFF export** — select 1–8 bitplanes (2–256 colors), tilesheet is color-quantized and exported as standard ILBM
- **AmiBlitz3 code generation** — generates two .ab3 files:
  - `maps.ab3` — draws the full map (all tile layers merged)
  - `game.ab3` — game loop with hardware sprite + joystick control
- **PNG → IFF converter tab** — load any PNG, quantize to a chosen bit depth, preview palette and converted image, and save as `.iff`/`.ilbm`

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- npm

### Install & Run

```bash
npm install
npm run compile    # compile TypeScript
npm start          # launch the Electron app
```

## Usage

### Tiled Viewer Tab

1. Click **Browse…** and select a folder containing:
   - A Tiled `.json` map file (with tile layers)
   - A PNG tilesheet (referenced in the JSON or matching filename)
2. The map renders in the canvas. Click map names to switch between maps.
3. Click the **Tilesheet IFF** link to configure bitplanes (1–8).
4. Click **Export Amiga** to generate files in an `amiga/` subfolder:

| File | Description |
|------|-------------|
| `tiles_Xbp.iff` | Multi-bitplane ILBM tilesheet |
| `maps.ab3` | Draw-only: loads IFF and renders the merged map |
| `game.ab3` | Full game loop: loads IFF, draws map, extracts sprite (tile 459), joystick movement |

The exported .ab3 files are plain ASCII with LF line endings, compatible with AmiBlitz3's ASCII import.

### PNG → IFF Converter Tab

1. Pick any PNG file
2. Adjust the bitplanes slider (1–8)
3. Preview the color-quantized result and palette
4. Click **Convert & Save IFF** to write the IFF/ILBM file

## IFF/ILBM Format

Exported IFF files use standard ILBM with:
- **BMHD** chunk — image dimensions, bitplane depth (1–8)
- **CMAP** chunk — palette (3 bytes per color, 2^n entries)
- **BODY** chunk — interleaved bitplane data (plane-by-plane per scanline)

Compression is not used (uncompressed BODY).

## Project Structure

```
tiled2retro/
├── index.html           # Main window HTML
├── style.css            # UI styles
├── src/
│   ├── main.ts          # Electron main process (IPC handlers, file I/O)
│   ├── preload.ts       # Context bridge API exposed to renderer
│   ├── renderer.ts      # Map viewer, IFF builder, AB3 code generation
│   ├── tiled-viewer.ts  # Tiled map rendering on canvas
│   └── tiled-viewer-vanilla.ts  # Vanilla JS alternative renderer
├── assets/
│   ├── jszip.min.js     # JSZip (loaded via script tag)
│   └── monochrome_tilemap_packed.iff  # Sample 1-bitplane tilesheet
├── blitzbasic_manuals/  # BlitzBasic/AmiBlitz reference docs
├── scripts/             # Helper scripts (e.g. png_to_iff.py)
├── .clinerules          # AmiBlitz3 code-generation guidelines
├── package.json
└── tsconfig.json
```

## License

MIT