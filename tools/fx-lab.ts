// FX lab: a dev-only page to try every shape's blast, destruction effect and sound.
// It drives the real game engine in its 'sandbox' mode, so what you see here is what the game does.
// Open with `npm run lab`. It is not included in the production build.
import '../src/style.css';
import { Sfx } from '../src/audio';
import { Game } from '../src/game';
import { SHAPE_ORDER, SHAPES, shapeSvg } from '../src/shapes';

const sfx = new Sfx();
sfx.setMusicMuted(true); // music off by default here: we're listening to effects
const game = new Game(document.getElementById('game') as HTMLCanvasElement, sfx);

let copies = 1;
/** Space taken by the control panel at the top, so the ring of shapes stays clear of it. */
const panelInset = () => document.querySelector('.lab')!.getBoundingClientRect().bottom + 8;

// Audio can only start after a user gesture.
document.addEventListener('pointerdown', () => sfx.unlock(), { once: true });
sfx.setMusicMode('game');

// One button per shape.
const shapesEl = document.querySelector('.shapes')!;
for (const shape of SHAPE_ORDER) {
  const b = document.createElement('button');
  b.title = `Blast every ${SHAPES[shape].name.toLowerCase()}`;
  b.innerHTML = `${shapeSvg(shape, 18)}${SHAPES[shape].name}`;
  b.addEventListener('click', () => {
    sfx.unlock();
    game.triggerShape(shape);
  });
  shapesEl.appendChild(b);
}

// Start once the panel is fully built, so its final height is known.
game.startSandbox(copies, panelInset());

// Copies per shape (to hear multi-kill staggering).
document.querySelectorAll<HTMLButtonElement>('[data-copies]').forEach((b) =>
  b.addEventListener('click', () => {
    copies = Number(b.dataset.copies);
    document.querySelectorAll('[data-copies]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    game.startSandbox(copies, panelInset());
  }),
);

// Every shape in turn, spaced just over the 0.2 s blast cooldown.
document.getElementById('blast-all')!.addEventListener('click', () => {
  sfx.unlock();
  SHAPE_ORDER.forEach((shape, i) => setTimeout(() => game.triggerShape(shape), i * 350));
});

const toggle = (id: string, apply: (on: boolean) => void) => {
  const b = document.getElementById(id)!;
  b.addEventListener('click', () => {
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on));
    sfx.unlock();
    apply(on);
  });
};
toggle('sfx-toggle', (on) => sfx.setMuted(!on));
toggle('music-toggle', (on) => sfx.setMusicMuted(!on));

// Keep the ring centered and sized after rotating / resizing.
window.addEventListener('resize', () => game.startSandbox(copies, panelInset()));

if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
