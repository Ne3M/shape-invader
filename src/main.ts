import './style.css';
import { Sfx } from './audio';
import { Game } from './game';
import { setupPwa } from './pwa';
import { loadSave } from './storage';
import { UI } from './ui';

setupPwa();

const sfx = new Sfx();
const game = new Game(document.getElementById('game') as HTMLCanvasElement, sfx);
new UI(game, sfx, loadSave());

if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
