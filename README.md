# Brickloom

Scan your bricks, keep a sorted catalog of everything you own, and have new models designed from
exactly those pieces, with step-by-step instructions in the style of a printed manual.

It is an installable web app: one codebase for phone, tablet and desktop. It has no server of its
own, so any static file host can serve it, including GitHub Pages.

## Getting started

```bash
npm install
npm run data
npm run dev
```

Then open http://localhost:5173.

- `npm run data` downloads the open datasets the app is built on (about 165 MB, once) and builds the
  catalog, part geometry and set lists from them (about 230 MB of files under `public/`). Re-run it
  whenever you want fresh data.
- `npm run dev` starts the app with live reload.

## Publishing it, and installing on a phone

Phones only install an app, and only allow the camera, on a real `https://` address. GitHub Pages
gives the project one for free, and the included workflow builds and publishes it for you.

1. Create a new **public** repository on GitHub (Pages is free for public repositories).
2. Push this project to it:

   ```bash
   git init -b main
   git add .
   git commit -m "Brickloom"
   git remote add origin https://github.com/<you>/<repository>.git
   git push -u origin main
   ```

3. In the repository on GitHub, open **Settings > Pages** and set **Source** to **GitHub Actions**.
4. Open the **Actions** tab. The "Deploy to GitHub Pages" run takes a few minutes the first time; if
   it started before step 3, re-run it. When it finishes, the app is at
   `https://<you>.github.io/<repository>/`.
5. Open that address on the phone:
   - **Android (Chrome):** go to Settings in the app and tap **Install Brickloom**, or use the
     browser menu and choose **Install app**.
   - **iPhone (Safari):** tap **Share**, then **Add to Home Screen**.

After that, every push to `main` republishes the app, and installed copies update themselves.

Things to know:

- The published site and its code are public. Your collection, builds and API key are not part of
  it: they are stored in the browser on each device and never uploaded.
- Each device keeps its own collection; use Export and Import in Settings to copy one across.
- The collection is stored against the site's address, so renaming the repository starts it empty.
- Nothing in `data/`, `public/catalog`, `public/ldraw` or `public/sets` is committed; the workflow
  downloads the datasets and rebuilds them (cached for a month).

To try the camera on a phone before publishing, `npm run dev:phone` serves the app on your local
network over HTTPS with a self-signed certificate. Expect a browser warning, and note that phones
will not install the app from such an address.

### Turning on the AI designer

Designs are created by Claude through the Anthropic API. Paste an API key into **Settings** in the
app, once on each device. The key is kept in that browser only and sent only to Anthropic; use a key
with a spending limit. Without a key the Create tab falls back to a small offline builder that only
knows towers, houses and pyramids.

## How it works

**Scanning.** A photo is segmented in the browser (`src/lib/scan/segment.ts`): the background is
modelled from the image border, and pixels that differ from it, or that sit on a sharp edge, become
pieces. Each piece is cropped and identified by [Brickognize](https://brickognize.com), several at
a time. Its color is measured from the photo and matched against the official palette, preferring
colors that part was actually produced in. Works best with pieces spread on a plain surface, not
touching.

**Sets.** Instead of scanning, a whole set can be added by its number or name. The data build turns
Rebrickable's set inventories, including the parts of each set's minifigures, into 256 small files
(`scripts/build-sets.ts`), and the app fetches only the one holding the set it needs. Each added set
is remembered, so removing it takes the same pieces back out.

**Catalog.** `scripts/build-catalog.ts` turns the Rebrickable CSVs into compact JSON
(`public/catalog`): about 65,000 parts, 270 colors, and which colors each part exists in.

**3D.** Every picture of a part is rendered from real LDraw geometry with three.js. The data build
reads the LDraw library and writes one file per part containing everything that part needs, plus one
shared file of the primitives most parts use (`scripts/build-geometry.ts`). The app fetches a part's
file the first time it draws it.

**Designing.** The data build also analyses part geometry to work out, for about 900 parts, where
each one's studs and sockets are on the stud grid (`shared/shape.ts`). The designer
(`src/lib/claude-designer.ts`) runs in the browser: it gives Claude the buildable part of your
inventory and a tool to submit a model; every submission is checked by `shared/build.ts` for
overlaps, unattached parts and inventory overruns, and the result is sent back with text views of
the model until it is sound. Parts the grid model cannot represent (hinges, clips, Technic pins,
sideways studs) stay in your collection but are not used in designs.

**Instructions.** `planSteps` orders a model bottom-up so nothing is placed before it has something
to attach to. The instruction viewer shows each step in 3D with the pieces needed, and can print the
whole build as a booklet or PDF.

Your collection and builds are stored in the browser (IndexedDB) and never leave the device, apart
from the piece photos sent to Brickognize for identification and the inventory sent to Anthropic
when you ask for a design.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | The app with live reload |
| `npm run dev:phone` | The same over HTTPS on the local network |
| `npm run data` | Download datasets and rebuild the catalog, geometry and set lists |
| `npm test` | Unit tests for the build validator and set logic |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Production build into `dist/` (set `BASE_PATH` to serve from a sub-path) |
| `npm run preview` | Serve the production build locally |
| `npm run icons` | Redraw the app icons |

## Credits

Part, color and set data from [Rebrickable](https://rebrickable.com/downloads/). Part geometry from
the [LDraw](https://www.ldraw.org) parts library (CC BY 4.0). Recognition by
[Brickognize](https://brickognize.com).

LEGO® is a trademark of the LEGO Group, which does not sponsor, authorize or endorse this project.
