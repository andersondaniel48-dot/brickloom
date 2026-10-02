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

Designs are created by an AI model: Claude, through the Anthropic API, or one of OpenAI's GPT
models, through the OpenAI API. Paste an API key for either (or both) into **Settings** in the app,
once on each device, and choose there which one does the designing, and which of its models. A key is kept in that browser
only and sent only to the company that issued it; use a key with a spending limit. Without a key
the Create tab falls back to a small offline builder that only knows towers, houses and pyramids.

API keys are billed by use, separately from the chat subscriptions: a ChatGPT Plus or Claude
subscription does not come with one, and neither company offers a way for an app like this to draw
on a subscription. Keys come from [platform.openai.com](https://platform.openai.com/api-keys) and
[console.anthropic.com](https://console.anthropic.com/settings/keys).

### Accounts: Sign in with Google (optional)

Out of the box, everything stays on each device. To let people sign in with Google and have their
collection and builds saved to their account, connect the app to a free
[Firebase](https://console.firebase.google.com) project. Until `src/cloud-config.ts` is filled in,
the app shows no sign-in at all.

1. In the Firebase console, **create a project**.
2. **Build > Authentication > Get started > Sign-in method**: enable **Google**. After saving, open
   the Google provider again and copy the **Web client ID** shown under "Web SDK configuration".
3. **Authentication > Settings > Authorized domains**: add the site's domain, for example
   `<you>.github.io`.
4. **Build > Firestore Database > Create database** (production mode, any location), then open its
   **Rules** tab, replace the contents with the following and publish:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```

   These rules are what keep each person's data private: nobody can read or write anything but
   their own.
5. **Project settings > General > Your apps > Add app > Web**: register an app (no hosting) and copy
   the `firebaseConfig` values it shows.
6. In the [Google Cloud console](https://console.cloud.google.com/apis/credentials), with the same
   project selected, open the OAuth client named **Web client (auto created by Google Service)**
   and add:
   - under **Authorized JavaScript origins**: `https://<you>.github.io` (and `http://localhost:5173`
     for development)
   - under **Authorized redirect URIs**: the app's full address with a trailing slash,
     `https://<you>.github.io/<repository>/` (and `http://localhost:5173/`)
7. Put the values from steps 2 and 5 into `src/cloud-config.ts` and publish. None of them is secret.

How saving behaves: the device keeps its own copy and works offline; changes are saved to the
account a moment after they are made, and other devices pick them up when the app is opened or
brought back to the front. If the same thing was changed on two devices, the most recent save wins.
The first time a device that already has a collection signs in to an account that already has one,
the app asks whether to combine them or keep one. Signing out leaves the device's copy in place.

## How it works

**Scanning.** The camera is opened at the highest resolution it offers, and the sharpest of a few
consecutive frames is kept. The photo is segmented in the browser (`src/lib/scan/segment.ts`): the
surface is modelled as whatever most of the picture looks like, with its lighting fitted as a smooth
gradient, and pixels that differ from it in color, or sit on a sharp edge, become pieces. A very
large blob that looks like a surface with things on it (a sheet of paper on a desk, the inside of a
tray) is searched in the same way instead of being taken for a piece. Blobs are split where the
color changes or the outline pinches to a neck.

While the camera is live, frames are examined in a web worker a few times a second, and what is
found is followed from frame to frame (`src/lib/scan/tracker.ts`): a piece seen in a few frames is
locked, stays outlined through frames that miss it, and is scanned when the shutter is pressed even
if the photo taken at that moment would not have shown it on its own. Each piece is cropped and
identified by [Brickognize](https://brickognize.com) (`src/lib/scan/session.ts`), several at a
time, paced to stay under the rate that service accepts and retried when it refuses. Where the
recognizer's answer does not cover everything in a region, the rest is cut out and identified too,
which is how pieces of the same color that touch are told apart. The color comes from the
recognizer's own reading combined with a measurement from the photo, the colors the part was
actually produced in, and how common each color is. Works best with pieces spread on a plain
surface, not touching.

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
each one's studs and sockets are on the stud grid (`shared/shape.ts`). The designer runs in the
browser: it gives the model the buildable part of your inventory and a tool to submit a build;
every submission is checked by `shared/build.ts` for overlaps, unattached parts and inventory
overruns, and the result is sent back with text views of the build until it is sound. That
conversation is the same whichever model is designing (`src/lib/design-core.ts`); the code that
carries it to Claude (`src/lib/claude-designer.ts`) or to a GPT model
(`src/lib/openai-designer.ts`) is a thin layer over each company's SDK.

A design belongs to the app, not to the Create screen (`src/lib/design-job.ts`), so it carries on
while other screens are open. It cannot outlive the page, though: there is no server to carry on
in. When a phone locks or the app goes to the background, the system cuts the connection to the
model; the round under way is lost, and is asked for again when the app is back on screen
(`resilientTurn` in `design-core.ts`). The time left is estimated from how long each round is
taking, against how long designs with that model have taken on this device (`shared/estimate.ts`). Parts the grid model cannot represent (hinges, clips, Technic pins,
sideways studs) stay in your collection but are not used in designs.

**Instructions.** `planSteps` orders a model bottom-up so nothing is placed before it has something
to attach to. The instruction viewer shows each step in 3D with the pieces needed, and can print the
whole build as a booklet or PDF.

**Accounts.** With Firebase configured, `src/lib/cloud/` signs people in with Google (by full-page
redirect, which is the only flow that also works in an app installed on an iPhone) and copies the
device's database to and from a small private area of Firestore per person.

Your collection and builds are stored in the browser (IndexedDB). They leave the device only as the
piece photos sent to Brickognize for identification, the inventory sent to Anthropic or OpenAI when you ask
for a design, and, if you sign in, the copy saved to your account.

## Releasing a new version

1. Add an entry at the top of `shared/changelog.ts`, written for the people who use the app.
2. Give `package.json` the same version (`npm version 1.4.0 --no-git-tag-version`). A test fails
   if the two disagree.
3. Push to `main`.

The version, the build it came from and the date of the part catalog are shown under Settings >
About, along with the notes for every release. An installed app updates itself in the background
and switches to the new version the next time it is opened; that first time, it shows the notes for
everything newer than the version last seen on that device.

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
