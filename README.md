# Shape Invaders

Browser game: asteroids shaped like circles, triangles, squares, infinity signs, lines, Vs, waves and zigzags fly toward your ship. Draw a shape with your finger or mouse, and the ship sends out a blast that destroys every asteroid of that shape on screen.

## Run

```bash
npm install
npm run dev      # http://localhost:5173 (also reachable from your phone on the same network)
npm test         # recognizer accuracy tests
npm run build    # static files in dist/
```

## Code map

| File | What it does |
|---|---|
| `src/recognizer.ts` | Single-stroke shape recognizer (closed vs open, corner count, corner sharpness) |
| `src/shapes.ts` | Shape list, colors, glyph geometry, SVG icons |
| `src/levels.ts` | 10 levels × 10 waves; difficulty formula in `makeWave` |
| `src/game.ts` | Game loop, spawning, blasts, scoring, shield, canvas rendering |
| `src/ui.ts` | DOM screens (title, level select, intro, HUD, pause, results) |
| `src/audio.ts` | Sound effects and music buses (Web Audio) |
| `src/music.ts` | Procedural music: ambient in menus, 120 BPM groove in game |
| `src/storage.ts` | Progress saved in localStorage |
| `src/pwa.ts` | Service worker registration, install button, iOS hint |
| `public/sw.js` | Service worker (offline cache) |
| `public/manifest.webmanifest` | App manifest (full screen, icons) |
| `scripts/make-icons.mjs` | Regenerates the PNG icons: `node scripts/make-icons.mjs` |

## Install as an app (PWA)

The built game can be installed and launches full screen, offline included.

- **Installing needs HTTPS** (or `localhost`). Host `dist/` on any static HTTPS host (GitHub Pages, Netlify, Cloudflare Pages…). Opening the dev server from a phone over `http://192.168…` works for playing but not for installing.
- The service worker only runs in the build (`npm run build` then `npm run preview`), never with `npm run dev`.
- Android / Chrome / Edge: an **Install app** button appears on the title screen.
- iPhone / iPad (Safari): the title screen explains *Share → Add to Home Screen*. iOS shows the app without browser bars, but keeps the status bar.
- After changing `public/sw.js`, bump `VERSION` in it so players' old caches are cleared.

## Tuning knobs

- `src/game.ts`: `COOLDOWN` (0.2 s), `HIT_DAMAGE`, `REGEN_DELAY`, `REGEN_RATE`, `BLAST_DUR`
- `src/levels.ts`: `makeWave` sets asteroid count, travel time, spawn interval, bursts and shape mix per wave
- `src/recognizer.ts`: closing gap, corner thresholds, wave/zigzag sharpness cut-off (0.7)
