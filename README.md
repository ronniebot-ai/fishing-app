# Tideline

Wind, swell, tide and rain for Australian coastal fishing spots, with a score for
how the fishing looks. Pick any point on the map; no account, no API key.

## Running it

```bash
npm install
npm run dev       # http://localhost:5173
npm test          # domain logic + components
npm run storybook # component workbench on http://localhost:6006
npm run build     # production bundle + service worker
```

### Tests

Two Vitest projects, split by extension so a new file lands in the right one by
being named for what it is:

- `*.test.ts` — **domain**, in `node`. The scoring and tide maths are pure, and
  giving them a DOM would only slow them down.
- `*.test.tsx` — **components**, in `jsdom`, with React Testing Library.
  `src/test/setup.ts` adds the matchers, unmounts between tests, and stubs the
  `ResizeObserver` the charts build unconditionally — jsdom ships none.

Run one project on its own with `npx vitest run --project domain`.

### Storybook

`npm run storybook` serves every component against `src/fixtures/conditions.ts`
— hand-written hourly readings whose scores, tide turns and windows are all
computed by the real domain functions, so a fixture cannot drift into
describing something the app would never produce. The same fixtures back the
component tests.

The toolbar's **Theme** control stamps `data-theme` on the document element,
which is how the app itself switches between the dark and daylight palettes.
Both are worth checking: the tone colours are defined separately for each.

`.storybook/main.ts` reuses `vite.config.ts` and strips the PWA plugin out of
it — left in, it tries to precache Storybook's own manager bundle and fails on
the workbox size limit.

`stories.smoke.test.tsx` renders every story through the real preview
decorators as part of `npm test`, so a story that throws on mount fails the
suite rather than waiting to be opened.

## How it works

Two Open-Meteo endpoints, both free and keyless:

- **Forecast API** — wind speed/direction/gusts (knots), rain, temperature, for the
  point you clicked.
- **Marine API** — wave height/period/direction, swell, and `sea_level_height_msl`
  for the tide, for the nearest ocean grid cell.

### Ocean snapping

The marine model only covers water. Request a land cell and every hourly value
comes back `null` — and the response's `elevation` field is not a reliable
land/sea test (ocean cells have been observed reporting elevation 89). The only
dependable check is whether `wave_height` holds a non-null value.

So `src/api/oceanSnap.ts` searches outward for the nearest cell that does: the
clicked point plus three rings of eight bearings, spaced by the measured grid
step of 0.0833° (~9.3 km). Candidates any closer together collapse onto the same
cell and waste the request. All 25 go out as **one** batched request — Open-Meteo
returns an array when latitude/longitude are comma-separated lists.

Wind and rain always come from the clicked point; only swell and tide use the
anchor. When the anchor is more than 10 km away the UI says so, marks it on the
map, and warns that the score describes the nearest open water rather than that
exact spot. Results are cached in `localStorage` forever, since the grid never
moves.

### Tide turns

The model publishes hourly sea levels, so a plain local-maximum scan would
quantise every turn to the hour. `src/domain/tides.ts` fits a parabola through
each extremum and its two neighbours and solves for the vertex, recovering the
turn to within a few minutes. The same series gives tide *rate* by central
difference, which is the strongest input to the score.

### The score

`src/domain/score.ts` normalises four factors to 0–1 through tunable piecewise
curves, then combines them as a **weighted geometric mean scaled by the worst
factor**. Weights: tide 0.40, wind 0.28, swell 0.20, rain 0.12.

The scaling term matters. A geometric mean alone under-reacts, because raising a
factor to its weight compresses it — a 0.14 wind factor at weight 0.28 only
becomes a 0.55 multiplier, so a gale still scored in the fifties. Multiplying by
`0.45 + 0.55 × worst` lets the limiting condition actually limit the result while
leaving a clean day untouched.

Hard gates override everything: over 30 kn of wind or 3 m of swell caps the score
at 20 and flags the hour unfishable. Every factor's contribution is shown in the
UI, so the number is never a black box.

## Known limits

- **Tides are modelled globally, not taken from Australian tide tables.** Turn
  times can be 20–40 minutes out. Heights are relative to mean sea level, not the
  chart datum BOM publishes against, so they do not compare directly. Moving to
  BOM or Willyweather tide data is the obvious next step.
- **The wave model resolves about 9 km**, so estuaries, harbours and water behind
  a breakwall are usually calmer than shown.
- The score uses wind, swell, tide and rain only. Moon phase and dawn/dusk
  strongly affect feeding and are the most natural thing to add next — `suncalc`
  computes both locally with no extra API.
- Open-Meteo's free tier is non-commercial and roughly 10,000 requests/day. Each
  spot costs 2–3 requests, or 2 once the snap is cached.

Check BOM before heading out.

## Desktop build

The same renderer ships as a Windows app via Electron.

```bash
npm run app:dev    # build + launch the desktop window
npm run app:exe    # portable single-file exe -> release/Tideline-1.0.0-portable.exe
```

The result is one ~100 MB executable that runs on double click — no install, no
registry writes, no admin. Electron bundles its own Chromium, which is where
almost all of that size goes; Tauri would produce ~6 MB using the WebView2
runtime Windows already ships, at the cost of a Rust and MSVC toolchain.

Three things are worth knowing if you touch this:

**The app is served over a custom `app://` scheme, not `file://`.** A `file://`
page has an opaque origin and loses `localStorage`, which is where the
ocean-snap cache lives. Registering a standard, secure scheme in `main.cjs`
gives the renderer an ordinary web origin, so storage, fetch and relative URLs
behave exactly as they do in the browser build.

**The desktop build drops the service worker.** `vite build --mode electron`
skips the PWA plugin and writes to `dist-app/` with relative asset paths. A
caching service worker on top of a local scheme only adds staleness.

**`ELECTRON_RUN_AS_NODE` breaks `electron .`** Electron-based editors — VS Code,
and Claude Code running inside it — export that variable into their integrated
terminals. Electron honours it and boots as bare Node, so `require('electron')`
returns a path string and the app dies on `app.getPath`. `npm run app:dev` goes
through `electron/launch.cjs`, which clears the variable for the child process.
If you ever run `npx electron .` by hand and see `Cannot read properties of
undefined (reading 'getPath')`, that is what happened.

One packaging note: **stop the Vite dev server before `npm run app:exe`.** Its
file watcher holds handles under the project and electron-builder fails with
`EPERM ... rename 'win-unpacked.tmp'` while unpacking.

## Design

The visual language comes from nautical charts, not from a UI kit. The ground is
a chart's deepest depth band (`#07202E`), which is also roughly the colour of
water before sunrise — the app is opened pre-dawn as often as at noon, so dark
is the primary theme and daylight the designed alternate, not an inversion.
Magenta appears exactly once, on the "now" line, because magenta is what charts
reserve for annotation. Water in motion is italicised, following the same
convention. Type is IBM Plex Sans with its Condensed cut for figures and tables:
condensed is the instrument-panel and chart-lettering idiom, and the tabular
figures matter more here than a display face would.

There are no cards. Sections are separated by rule and space, and the four
readings are one aligned block — the shape of a marine forecast — so the eye
runs down a column of values instead of hopping between boxes. Each reading
carries a hairline whose width is its contribution to the score, which keeps the
headline number accountable without a separate breakdown panel.

Chart colours are validated, not chosen by eye. Run the data-viz palette
validator against the real surfaces before changing them: the first pass failed
both modes — the dark pair sat above the lightness band and the light teal fell
under the chroma floor and read grey.

Charts are hand-drawn SVG rather than a charting library. The marks are specific
(windows shaded behind the curve, midnight rules, interpolated turns labelled in
place), and drawing them directly removed ~390 kB from the bundle. They render
at true pixel size via a `ResizeObserver` rather than scaling a fixed viewBox,
which would stretch x and y independently and squash every label.

## Layout

```
src/
  api/        Open-Meteo clients, response types, ocean snapping
  domain/     tides, scoring, timeline merge, phrasing, formatting  (pure, unit-tested)
  components/ map, verdict, readout, charts, tables  (+ .test.tsx, .stories.tsx)
  hooks/      useConditions (snap -> marine + forecast), useNow, useElementWidth
  fixtures/   sample conditions shared by tests and stories
  test/       jsdom setup for the component project
.storybook/   Storybook config, reusing vite.config.ts
```

Timezones are handled explicitly: the API returns wall-clock stamps in the
*spot's* zone with no offset, so `wallClockToEpoch` reads them as UTC and
subtracts the reported offset. Parsing them directly would shift interstate
spots by hours.
