# Tideline

Wind, swell, tide and rain for Australian coastal fishing spots, with a score for
how the fishing looks. Pick any point on the map; no account, no API key.

## Running it

```bash
npm install
npm run dev       # http://localhost:3000
npm test          # domain logic, components and the API routes
npm run storybook # component workbench on http://localhost:6006
npm run build     # production build
npm start         # serve that build
```

Next.js, App Router. The page and the API are one project on one origin, which
is why the client uses relative URLs everywhere.

The app is installable: `src/app/manifest.ts` gives it a name, icons and a
standalone display mode, so a phone offers "Add to home screen". There is no
service worker, so it does not cache and does not work offline — worth knowing,
because a fishing spot is usually where the signal is worst.

### Tests

Three Vitest projects, split by location and extension so a new file lands in
the right one by being named and placed for what it is:

- `src/domain/*.test.ts`, `src/api/*.test.ts` — **domain**, in `node`. The
  scoring and tide maths are pure, and giving them a DOM would only slow them
  down.
- `*.test.tsx` — **components**, in `jsdom`, with React Testing Library.
  `src/test/setup.ts` adds the matchers, unmounts between tests, and stubs the
  `ResizeObserver` the charts build unconditionally — jsdom ships none.
- `src/lib/*.test.ts`, `src/app/api/**/*.test.ts` — **server**, in `node`, with
  a real database behind it.

Run one project on its own with `npx vitest run --project domain`.

The route handlers are tested by calling them, not over a socket: a handler
reads nothing but its `Request`, so there is no server to start and no port to
pick. The store runs against a real `mongod` in memory, with the same indexes
the cluster gets — one of them, the unique index over `(lat, lon)`, is not an
optimisation but the thing that produces the 409.

Vitest has its own `vitest.config.ts`. Next builds with Turbopack and ships no
Vite config to share, so the two no longer meet.

### Storybook

`npm run storybook` serves every component against `src/fixtures/conditions.ts`
— hand-written hourly readings whose scores, tide turns and windows are all
computed by the real domain functions, so a fixture cannot drift into
describing something the app would never produce. The same fixtures back the
component tests.

The toolbar's **Theme** control stamps `data-theme` on the document element,
which is how the app itself switches between the dark and daylight palettes.
Both are worth checking: the tone colours are defined separately for each.

`.storybook/main.ts` uses the React/Vite framework rather than the Next one,
and builds with Storybook's own Vite config. Every story renders a leaf
component and none of them touch `next/*` — the single `next/dynamic` call
wraps SpotMap from `src/app/App.tsx`, above the layer stories exercise. The
Next preset would buy nothing there and costs something real: it aliases
modules through `sb-original`, which `stories.smoke.test.tsx` cannot resolve,
because portable stories run under plain Vitest with no Storybook builder in
front of them.

`stories.smoke.test.tsx` renders every story through the real preview
decorators as part of `npm test`, so a story that throws on mount fails the
suite rather than waiting to be opened.

## The spot library

Saved spots live in MongoDB Atlas. The store is four operations wide and all of
them are in `src/lib/spots.ts`; `src/app/api/spots/**` translates their errors
into status codes and does nothing else.

Two things about it are worth knowing.

**The 409 comes from a unique index over `(lat, lon)`, not from a check before
the write.** Coordinates are rounded to the 4 decimal places the map hands out
first, which is what makes "the same spot" mean the same spot rather than the
same float. Because the index is the authority, two saves of the same point
cannot both get through the gap between looking and inserting.

**The auto-name is best effort, and deliberately so.** An unnamed spot is given
the lowest free number rather than the next one, so deleting Spot 2 of three
frees that number for the next save. The SQLite version this replaced wrapped
the scan and the insert in `BEGIN IMMEDIATE`, which locked the whole database
and so serialised them. MongoDB has no equivalent: a transaction would isolate
the reads but would not stop two simultaneous unnamed saves from both choosing
"Spot 1", because they write different documents and never conflict. It would
look like a guarantee without being one, so there is none. The coordinate is
still absolutely unique; a duplicate number is cosmetic and renameable.

Each spot also carries its position a second time as a GeoJSON point, indexed
with `2dsphere`. Nothing reads it yet — it is there so the nearby-spots query
has no backfill in front of it.

```bash
cp .env.example .env.local   # fill in MONGODB_URI
npm run db:indexes           # once per cluster, and after changing them
npm run db:audit             # check the store; add -- --fix to repair
npm run db:bench             # measure what the indexes and the facet are worth
```

Those three run under plain Node rather than through the app, which is why
`src/lib/indexes.ts`, `src/lib/mongo.ts` and `src/lib/audit.ts` import each
other with explicit `.ts` extensions and import nothing else from the project:
Node strips types but does not resolve extensionless imports the way a bundler
does.

## What the app remembers

Every time a saved spot is opened, the app posts the next 48 hours it has just
drawn — the scores, the factors behind them, and the readings behind those — to
`POST /api/spots/:id/conditions`. Nothing on screen waits for it and nothing
shows when it fails; a lost batch costs a statistic and the next visit sends
the same hours again.

That turns a page which only knows about right now into one that can answer a
question no forecast API can: not *what is it doing this weekend* but *what is
this place like*.

The stored scores are the ones `scoreHour` produced for the screen, not a
second calculation on the server, so a kept hour and a drawn hour cannot
disagree. Hours scored from an incomplete reading are skipped — a partial score
is honest enough to show with a caveat beside it, but averaging over it later
would quietly mix two different measurements.

### Duplicates are prevented, not cleaned up

`(spotId, at)` is unique and every write is an upsert against it. The app
re-sends overlapping windows every time a spot is opened, so a repeated hour is
the ordinary case rather than an edge one: it lands on the same document and
updates in place. Nothing downstream filters duplicates because none are ever
created. A TTL index on `capturedAt` ages snapshots out after 90 days, which is
what keeps a free tier's 512 MB from being a deadline.

### The two aggregations

**`GET /api/spots/:id/stats`** answers four questions in one pass with `$facet`:
average and best score for each hour of the day, how the scores fall across five
bands (`$bucket`), the mean contribution of each factor, and what share of hours
the gates ruled out.

The hour-of-day grouping happens in the spot's own time, not the server's.
`$hour` takes its `timezone` as an expression, so each snapshot carries its own
UTC offset and the pipeline reads it off the document. 20:00 UTC is 6am in
Sydney, and for a fishing app that is the difference between dawn and after
dinner.

**`GET /api/spots/nearby?lat&lon&km`** is a `$geoNear` over a 2dsphere index,
with a `$lookup` that pulls the next hour held for each spot so the list can say
what the fishing looks like there rather than only how far away it is. Every
spot stores its position twice — as `lat`/`lon` and as a GeoJSON point — because
`$geoNear` cannot read a pair of loose fields, and the point is written from the
first save so there was never a backfill to run.

Both are consumed by the block at the bottom of the page. An endpoint nothing
reads is not a feature.

### What the indexes are worth

`npm run db:bench` seeds a scratch database, measures it and drops it. Over
50,000 snapshots across 40 spots on a local mongod:

| stats `$match` on `(spotId, at)` | documents examined | time |
|---|---|---|
| index seek | 720 | 3 ms |
| forced collection scan | 50,000 | 18 ms |

69x fewer documents read. The comparison uses `hint: { $natural: 1 }` rather
than dropping the index, so both sides run against the same documents in the
same process moments apart. The pipeline averages a field rather than counting,
because a `$count` would be answered from the index alone and flatter the
result into meaninglessness.

| the four stats questions | time |
|---|---|
| one `$facet` | 4.3 ms |
| four separate pipelines | 8.6 ms |

Twice as fast, and one round trip instead of four — which across the internet
from a serverless function is the larger half of the win.

`$geoNear` has no slow path to compare against. Without a 2dsphere index it does
not fall back to a scan; it refuses to run.

### Auditing it

`npm run db:audit` checks five things, each as an aggregation rather than a loop
in Node, because the questions are about relationships between documents and
pulling the collection into memory to ask them would stop working at exactly the
size where you would want to.

| check | what it looks for | `--fix` |
|---|---|---|
| near-duplicate spots | two taps ~110 m apart, which the unique index cannot see | merges into the oldest, moving its snapshots across |
| orphan snapshots | hours whose spot has been deleted | deletes them |
| coordinates off the planet | latitude past a pole, longitude past the date line | nothing — there is no right answer |
| location out of step | GeoJSON point missing or disagreeing with lat/lon | rebuilds it from lat/lon |
| precision drift | coordinates finer than the 4dp the map hands out | rounds them |

Two details are worth knowing before running it with `--fix`. Merging picks the
oldest of a cluster to keep, which is a guess about intent rather than a fact.
And because `(spotId, at)` is unique, an hour the keeper already holds cannot
simply be repointed at it: the loser's copy is dropped, on the grounds that the
surviving spot's reading is the one to believe.

The order the fixes run in matters. Rounding coordinates can push two spots onto
the same 4dp pair, so precision is repaired first and the merge pass then sees
the duplicates it created; orphans are cleaned last, because merging deletes
spots and so can make new ones.

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

## Asking about a spot

Under the tables there is a panel that answers questions about the spot on
screen — "is it worth going now", "when is the best window", "why is the score
54". It is Claude (`claude-sonnet-5`), and it answers from the forecast the page
is already showing: `buildChatContext` in `src/domain/chatContext.ts` renders
the current reading, the score's own factor breakdown, every hour to the
horizon, the tide turns and the windows as plain text, all from the same domain
functions the screen is drawn with. It makes no second request, so the panel
cannot quote a number the page disagrees with.

**The key never reaches the page.** The renderer posts to `POST /api/chat` and
`src/lib/chat.ts` is the only thing that talks to Anthropic, streaming the reply
back as plain text through a `ReadableStream`. The first chunk is awaited before
the response is built, so a failure that happens before any text exists is still
a JSON error with a status rather than a 200 carrying an apology in its body.

### Turning it on

Set `ANTHROPIC_API_KEY` in the environment and the panel appears; leave it unset
and it does not, the way the saved-spot library disappears in a build with no
server:

| | Chat | Why |
|---|---|---|
| `npm run dev` / `npm start` locally | yes | Your machine, your key. |
| A public deploy | **no** | The key would be ours and every visitor's question would be billed to it. Enabling this means accepting that, and adding rate limiting first. |

There is no build-time switch: both routes read the key through
`anthropicFromEnv` at request time, so "is the panel in this build" has one
answer rather than two that can drift. Deploy without the variable set and
`GET /api/chat` reports `available: false`, which is enough for the renderer to
leave the panel out and never request its chunk.

### What it costs

Nothing until somebody asks; there are no background calls. Each question sends
the system prompt plus the forecast (roughly 2,000–4,000 tokens) and gets a few
hundred back, at Sonnet 5's rates. The forecast sits behind a
`cache_control: {type: 'ephemeral'}` breakpoint and the prompt ahead of it holds
no clock or spot, so follow-ups about the same spot re-read the prefix from
cache instead of paying for it again — which is why `buildChatContext` is tested
for being a stable function of its input and not of the minute hand. `max_tokens`
is capped at 4,000 and effort is `low`; the transcript is capped at ten
exchanges, and picking a different spot starts over. **Set a monthly spend limit
in the Anthropic Console** — that is the backstop none of the above replaces.

## Known limits

- **Answers are Claude reading the same forecast you are**, and it can be wrong
  about what it reads. Every limit below is in the system prompt, but a written
  caveat is not a guarantee. Nothing in the panel knows your boat, your gear, or
  the ground you are standing on.
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
  app/        layout, page, providers, App  +  api/ route handlers  (spots, chat)
  lib/        the server half: spot store, snapshots and their aggregations,
              the audit, the Atlas connection, chat, request/response edges
  api/        Open-Meteo clients, response types, ocean snapping, chat client
  domain/     tides, scoring, timeline merge, phrasing, chat context, URL parsing  (pure, unit-tested)
  components/ map, verdict, readout, charts, tables, ask panel  (+ .test.tsx, .stories.tsx)
  hooks/      useConditions (snap -> marine + forecast), useChat, useNow, useElementWidth
  fixtures/   sample conditions shared by tests and stories
  test/       jsdom setup for the component project
scripts/      db:indexes, db:audit, db:bench  (plain Node, not bundled)
.storybook/   Storybook config
```

Timezones are handled explicitly: the API returns wall-clock stamps in the
*spot's* zone with no offset, so `wallClockToEpoch` reads them as UTC and
subtracts the reported offset. Parsing them directly would shift interstate
spots by hours.
