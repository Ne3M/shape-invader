# Shape Invaders

Browser game: asteroids shaped like circles, triangles, squares, stars, lines, Vs, waves and zigzags fly toward your ship. Draw a shape with your finger or mouse, and the ship sends out a blast that destroys every asteroid of that shape on screen.

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
| `src/audio.ts` | Synthesized Web Audio sound effects |
| `src/storage.ts` | Progress saved in localStorage |

## Tuning knobs

- `src/game.ts`: `COOLDOWN` (0.2 s), `HIT_DAMAGE`, `REGEN_DELAY`, `REGEN_RATE`, `BLAST_DUR`
- `src/levels.ts`: `makeWave` sets asteroid count, travel time, spawn interval, bursts and shape mix per wave
- `src/recognizer.ts`: closing gap, corner thresholds, wave/zigzag sharpness cut-off (0.7)
