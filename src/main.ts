import './style.css';
import { Sfx } from './audio';
import { Game } from './game';
import { detectLang, setLang } from './i18n';
import { setupPwa } from './pwa';
import { loadSave } from './storage';
import { UI } from './ui';

const save = loadSave();
// Language: the player's saved choice, otherwise the device language (English if unsupported).
setLang(detectLang(save.lang));

setupPwa();

const sfx = new Sfx();
const game = new Game(document.getElementById('game') as HTMLCanvasElement, sfx);
new UI(game, sfx, save);

if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
