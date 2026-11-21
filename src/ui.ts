import type { Sfx } from './audio';
import { BOMB_CHARGE_TIME, type Game, type HudState, type LevelResult } from './game';
import { LANGUAGES, LANG_CODES, fmt, getLang, levelName, levelTwist, onLangChange, setLang, shapeName, t } from './i18n';
import { LEVELS, LEVEL_COUNT, WAVES_PER_LEVEL, endlessShapes, shuffledShapes } from './levels';
import type { ShapeId } from './shapes';
import { SHAPE_ORDER, SHAPES, demoStroke, shapeSvg } from './shapes';
import { writeSave, type Records, type SaveData } from './storage';

type ScreenId = 'title' | 'levels' | 'intro' | 'pause' | 'complete' | 'over';

/** `selected` value meaning endless mode instead of a level index. */
const ENDLESS = -1;

/** Seconds as m:ss, or h:mm:ss past an hour. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

export class UI {
  private current: ScreenId | null = 'title';
  private selected = 0;
  private hudCache = { shield: -1, score: -1, multiplier: -1, wave: -1, level: -1, shapes: '', expert: false, bomb: -1, remaining: '' };
  private bannerTimer = 0;
  /** Endless: shape order drawn when its intro is shown, so the intro shows the run's first shapes. */
  private endlessOrder: ShapeId[] = shuffledShapes();

  /** Records of the selected mode (Normal or Expert). */
  private get rec(): Records {
    return this.save.expert ? this.save.expertRecords : this.save.normal;
  }

  /** Added to screen headers when playing in Expert mode. */
  private get modeTag(): string {
    return this.save.expert ? t('mode.expertTag') : '';
  }

  constructor(
    private game: Game,
    private sfx: Sfx,
    private save: SaveData,
  ) {
    $('.title-shapes').innerHTML = SHAPE_ORDER.map((s) => shapeSvg(s, 30)).join('');
    this.sfx.setMuted(save.sfxMuted);
    this.sfx.setMusicMuted(save.musicMuted);
    this.updateMuteButtons();
    this.buildLangSwitch();
    onLangChange(() => this.refreshTexts());

    // Browsers only allow audio after a user gesture: start it on the first touch or click anywhere.
    document.addEventListener('pointerdown', () => this.sfx.unlock(), { once: true });
    document.addEventListener('keydown', () => this.sfx.unlock(), { once: true });

    document.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (btn) this.action(btn.dataset.action!, btn);
    });
    $('#btn-pause').addEventListener('click', () => this.pause());
    $('#btn-bomb').addEventListener('click', () => this.game.useBomb());
    // Normal / Expert switch on the level select screen.
    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
      b.addEventListener('click', () => {
        this.sfx.click();
        this.save.expert = b.dataset.mode === 'expert';
        writeSave(this.save);
        this.showLevels();
      }),
    );
    $('#btn-music').addEventListener('click', () => {
      this.save.musicMuted = !this.save.musicMuted;
      this.sfx.setMusicMuted(this.save.musicMuted);
      this.sfx.unlock();
      writeSave(this.save);
      this.updateMuteButtons();
    });
    $('#btn-sfx').addEventListener('click', () => {
      this.save.sfxMuted = !this.save.sfxMuted;
      this.sfx.setMuted(this.save.sfxMuted);
      this.sfx.unlock();
      this.sfx.click();
      writeSave(this.save);
      this.updateMuteButtons();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'p') {
        if (this.game.isPlaying) this.pause();
        else if (this.current === 'pause') this.resume();
      }
      // Space: bomb (desktop shortcut).
      if (e.key === ' ' && this.game.isPlaying) {
        e.preventDefault();
        this.game.useBomb();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.game.isPlaying) this.pause();
        this.sfx.suspend();
      } else {
        this.sfx.unlock();
      }
    });

    game.onHud = (h) => this.updateHud(h);
    game.onBanner = (title, sub) => this.banner(title, sub);
    game.onLevelComplete = (r) => this.levelComplete(r);
    game.onGameOver = (r) => this.gameOver(r);
  }

  /** Language switch on the title screen: one button per available language. */
  private buildLangSwitch(): void {
    const box = $('.lang-switch');
    box.innerHTML = LANG_CODES.map(
      (code) => `<button data-lang="${code}" lang="${code}" title="${LANGUAGES[code]['lang.name']}">${LANGUAGES[code]['lang.code']}</button>`,
    ).join('');
    box.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) =>
      b.addEventListener('click', () => {
        const code = b.dataset.lang as (typeof LANG_CODES)[number];
        if (code === getLang()) return;
        this.sfx.unlock();
        this.sfx.click();
        this.save.lang = code;
        writeSave(this.save);
        setLang(code);
      }),
    );
    this.markLang();
  }

  private markLang(): void {
    document.querySelectorAll<HTMLElement>('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === getLang())));
  }

  /** Re-renders texts built in code after the language changed (static HTML is handled by i18n). */
  private refreshTexts(): void {
    this.markLang();
    this.updateMuteButtons();
    $('.title-shapes').innerHTML = SHAPE_ORDER.map((s) => shapeSvg(s, 30)).join('');
    this.hudCache = { ...this.hudCache, wave: -1, bomb: -1, shapes: '', remaining: '' };
    if (this.current === 'levels') this.showLevels();
    else if (this.current === 'intro') this.showIntro(this.selected);
  }

  private updateMuteButtons(): void {
    const music = $('#btn-music');
    const sfx = $('#btn-sfx');
    music.classList.toggle('muted', this.save.musicMuted);
    sfx.classList.toggle('muted', this.save.sfxMuted);
    music.setAttribute('aria-pressed', String(!this.save.musicMuted));
    sfx.setAttribute('aria-pressed', String(!this.save.sfxMuted));
    music.title = t(this.save.musicMuted ? 'audio.musicOff' : 'audio.musicOn');
    sfx.title = t(this.save.sfxMuted ? 'audio.sfxOff' : 'audio.sfxOn');
  }

  private show(id: ScreenId | null): void {
    this.current = id;
    // Fuller music during play, calmer in menus, muffled while paused.
    this.sfx.setMusicMode(id === null ? 'game' : id === 'pause' ? 'paused' : 'menu');
    document.querySelectorAll<HTMLElement>('.screen').forEach((el) => el.classList.toggle('hidden', el.id !== `screen-${id}`));
    $('#hud').classList.toggle('hidden', id !== null && id !== 'pause');
  }

  private action(name: string, el: HTMLElement): void {
    this.sfx.unlock();
    this.sfx.click();
    switch (name) {
      case 'play':
        this.showLevels();
        break;
      case 'title':
        this.game.toMenu();
        this.show('title');
        break;
      case 'levels':
        this.game.toMenu();
        this.showLevels();
        break;
      case 'level':
        this.showIntro(Number(el.dataset.level));
        break;
      case 'endless':
        this.showIntro(ENDLESS);
        break;
      case 'start':
        this.startLevel(this.selected, true);
        break;
      case 'resume':
        this.resume();
        break;
      case 'restart':
        this.startLevel(this.selected);
        break;
      case 'next':
        if (this.selected + 1 < LEVEL_COUNT) this.showIntro(this.selected + 1);
        else this.showLevels();
        break;
    }
  }

  private showLevels(): void {
    document.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) =>
      b.setAttribute('aria-pressed', String((b.dataset.mode === 'expert') === this.save.expert)),
    );
    $('.mode-hint').textContent = t(this.save.expert ? 'levels.hintExpert' : 'levels.hintNormal');
    $('#screen-levels .panel').classList.toggle('expert', this.save.expert);
    const stars = (n: number) => [0, 1, 2].map((i) => `<span class="${i < n ? '' : 'off'}">★</span>`).join('');
    $('.level-grid').innerHTML = LEVELS.map((lv) => {
      const locked = lv.index >= this.save.unlocked;
      const best = this.rec.best[lv.index];
      return `<button class="level-card" data-action="level" data-level="${lv.index}" ${locked ? 'disabled' : ''}>
        <div class="level-num">${locked ? '🔒' : lv.index + 1}</div>
        <div class="level-name">${levelName(lv.index)}</div>
        <div class="level-icons">${lv.shapes.map((s) => shapeSvg(s, 16)).join('')}</div>
        <div class="level-stars">${stars(this.rec.stars[lv.index])}</div>
        <div class="level-best">${best ? t('levels.best', { score: fmt(best) }) : '&nbsp;'}</div>
      </button>`;
    }).join('');
    const { endlessBestWave: bw, endlessBestScore: bs } = this.rec;
    $('.endless-slot').innerHTML = `<button class="level-card endless-card" data-action="endless">
        <div class="endless-mark">∞</div>
        <div class="endless-text">
          <div class="endless-title">${t('endless.name')}</div>
          <div class="level-name">${t('endless.tagline')}</div>
        </div>
        <div class="level-best">${bw ? t('endless.best', { wave: bw, score: fmt(bs) }) : t('endless.noRecord')}</div>
      </button>`;
    this.show('levels');
  }

  private showIntro(index: number): void {
    this.selected = index;
    if (index === ENDLESS) {
      this.endlessOrder = shuffledShapes();
      $('.intro-kicker').textContent = t('intro.endlessKicker') + this.modeTag;
      $('.intro-name').textContent = t('endless.name');
      $('.intro-new').innerHTML = '';
      $('.intro-twist').textContent = t('intro.endlessText');
      $('.intro-pool').innerHTML =
        endlessShapes(0, this.endlessOrder).map((sh) => shapeSvg(sh, 30)).join('') +
        (this.rec.endlessBestWave ? `<div class="intro-record">${t('intro.record', { wave: this.rec.endlessBestWave })}</div>` : '');
      this.show('intro');
      return;
    }
    const lv = LEVELS[index];
    $('.intro-kicker').textContent = t('intro.levelOf', { n: index + 1, total: LEVEL_COUNT }) + this.modeTag;
    $('.intro-name').textContent = levelName(index);
    const s = lv.newShape;
    $('.intro-new').innerHTML = s
      ? `<div class="label">${t(index === 0 ? 'intro.firstShape' : 'intro.newShape')}</div>
         ${shapeSvg(s, 130, demoStroke(s))}
         <div class="new-name" style="color:${SHAPES[s].color}">${shapeName(s)}</div>
         <div class="hint">${t(`shape.${s}.hint`)}</div>`
      : '';
    $('.intro-twist').textContent = levelTwist(index) ?? t('intro.defaultTwist', { waves: WAVES_PER_LEVEL });
    $('.intro-pool').innerHTML = lv.shapes.map((sh) => shapeSvg(sh, 30)).join('');
    this.show('intro');
  }

  /** `fromIntro`: an endless run started from its intro keeps the shape order shown there; a retry draws a new one. */
  private startLevel(index: number, fromIntro = false): void {
    this.selected = index;
    this.hudCache = { shield: -1, score: -1, multiplier: -1, wave: -1, level: -1, shapes: '', expert: !this.save.expert, bomb: -1, remaining: '' };
    this.show(null);
    if (index === ENDLESS) this.game.startEndless(this.save.expert, fromIntro ? this.endlessOrder : shuffledShapes());
    else this.game.startLevel(index, this.save.expert);
  }

  pause(): void {
    if (!this.game.isPlaying) return;
    this.game.pause();
    this.show('pause');
  }

  private resume(): void {
    this.show(null);
    this.game.resume();
  }

  private updateHud(h: HudState): void {
    const c = this.hudCache;
    if (Math.abs(h.shield - c.shield) > 0.002) {
      c.shield = h.shield;
      const fill = $('.shield-fill');
      fill.style.width = `${h.shield * 100}%`;
      const color = `hsl(${185 * h.shield}, 100%, 60%)`;
      fill.style.background = color;
      fill.style.boxShadow = `0 0 12px ${color}`;
    }
    if (h.score !== c.score) {
      c.score = h.score;
      $('.hud-score').textContent = fmt(h.score);
    }
    if (h.multiplier !== c.multiplier) {
      const combo = $('.hud-combo');
      combo.textContent = `×${h.multiplier}`;
      combo.classList.toggle('hot', h.multiplier > 1);
      if (h.multiplier > c.multiplier && c.multiplier > 0) {
        combo.classList.add('bump');
        setTimeout(() => combo.classList.remove('bump'), 150);
      }
      c.multiplier = h.multiplier;
    }
    if (h.wave !== c.wave || h.level !== c.level || h.expert !== c.expert) {
      c.wave = h.wave;
      c.level = h.level;
      c.expert = h.expert;
      const tag = h.expert ? t('mode.expertTag') : '';
      if (h.endless) {
        // Endless: the groove reaches full intensity around wave 20.
        this.sfx.setMusicIntensity(Math.min(1, (h.wave - 1) / 20));
        $('.hud-wave').textContent = t('hud.wave', { n: h.wave });
        $('.hud-level').textContent = t('endless.name') + tag;
      } else {
        // The groove builds up over the waves; later levels start hotter.
        this.sfx.setMusicIntensity(((h.wave - 1) / (WAVES_PER_LEVEL - 1)) * 0.75 + ((h.level - 1) / (LEVEL_COUNT - 1)) * 0.35);
        $('.hud-wave').textContent = t('hud.waveOf', { n: h.wave, total: WAVES_PER_LEVEL });
        $('.hud-level').textContent = t('hud.level', { n: h.level }) + tag;
      }
    }
    // Bomb charge ring (updated in small steps to avoid restyling every frame).
    const bomb = Math.floor(h.bomb * 100) / 100;
    if (bomb !== c.bomb) {
      c.bomb = bomb;
      const btn = $('#btn-bomb');
      btn.style.setProperty('--charge', String(bomb));
      btn.classList.toggle('ready', bomb >= 1);
      btn.setAttribute('aria-disabled', String(bomb < 1));
      btn.title = bomb >= 1 ? t('hud.bombReady') : t('hud.bombCharging', { s: Math.max(1, Math.round((1 - h.bomb) * BOMB_CHARGE_TIME)) });
    }
    // Shapes left in the wave, and a bar filling up as the wave is cleared.
    const remKey = `${h.remaining}/${h.waveTotal}`;
    if (remKey !== c.remaining) {
      c.remaining = remKey;
      const text =
        h.remaining === 0 ? t('hud.waveDone') : h.remaining === 1 ? t('hud.remainingOne') : t('hud.remaining', { n: h.remaining });
      $('.hud-remaining-text').textContent = text;
      const done = h.waveTotal > 0 ? 1 - Math.min(h.remaining, h.waveTotal) / h.waveTotal : 0;
      $('.hud-wave-fill').style.width = `${done * 100}%`;
    }
    // Shapes in play (grows during an endless run).
    const key = h.shapes.join(',');
    if (key !== c.shapes) {
      c.shapes = key;
      $('.hud-legend').innerHTML = h.shapes.map((s) => shapeSvg(s, 26)).join('');
    }
  }

  private banner(title: string, sub = ''): void {
    const b = $('#banner');
    $('.banner-title', b).textContent = title;
    $('.banner-sub', b).textContent = sub;
    b.classList.remove('show');
    void b.offsetWidth; // restart animation
    b.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => b.classList.remove('show'), 1900);
  }

  private stats(rows: [string, string][]): string {
    return rows.map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`).join('');
  }

  private levelComplete(r: LevelResult): void {
    const i = r.level;
    const newBest = r.score > this.rec.best[i];
    this.rec.best[i] = Math.max(this.rec.best[i], r.score);
    this.rec.stars[i] = Math.max(this.rec.stars[i], r.stars);
    this.save.unlocked = Math.max(this.save.unlocked, Math.min(LEVEL_COUNT, i + 2));
    writeSave(this.save);

    const last = i === LEVEL_COUNT - 1;
    $('.complete-kicker').textContent = `${t('hud.level', { n: i + 1 })} · ${levelName(i)}${this.modeTag}`;
    $('.complete-title').textContent = t(last ? 'complete.won' : 'complete.title');
    $('#screen-complete .stars').innerHTML = [0, 1, 2].map((k) => `<span class="${k < r.stars ? '' : 'off'}">★</span>`).join('');
    $('.complete-stats').innerHTML =
      this.stats([
        [t('stats.score'), fmt(r.score)],
        [t('stats.best'), fmt(this.rec.best[i])],
        [t('stats.asteroids'), fmt(r.kills)],
        [t('stats.bestCombo'), `×${r.bestMultiplier}`],
        [t('stats.shieldHits'), fmt(r.hits)],
      ]) + (newBest ? `<div class="new-best">${t('stats.newBest')}</div>` : '');
    $('[data-action="next"]', $('#screen-complete')).classList.toggle('hidden', last);
    this.show('complete');
  }

  private gameOver(r: LevelResult): void {
    if (r.endless) {
      const newWave = r.wave > this.rec.endlessBestWave;
      const newScore = r.score > this.rec.endlessBestScore;
      this.rec.endlessBestWave = Math.max(this.rec.endlessBestWave, r.wave);
      this.rec.endlessBestScore = Math.max(this.rec.endlessBestScore, r.score);
      writeSave(this.save);
      $('.over-kicker').textContent = t('intro.endlessKicker') + this.modeTag;
      $('.over-stats').innerHTML =
        this.stats([
          [t('stats.reached'), t('hud.wave', { n: r.wave })],
          [t('stats.duration'), formatDuration(r.duration)],
          [t('stats.score'), fmt(r.score)],
          [t('stats.bestWave'), fmt(this.rec.endlessBestWave)],
          [t('stats.bestScore'), fmt(this.rec.endlessBestScore)],
          [t('stats.asteroids'), fmt(r.kills)],
          [t('stats.bestCombo'), `×${r.bestMultiplier}`],
        ]) + (newWave || newScore ? `<div class="new-best">${t(newWave ? 'stats.newBestWave' : 'stats.newBestScore')}</div>` : '');
      this.show('over');
      return;
    }
    const i = r.level;
    this.rec.best[i] = Math.max(this.rec.best[i], r.score);
    writeSave(this.save);
    $('.over-kicker').textContent = `${t('hud.level', { n: i + 1 })} · ${levelName(i)}${this.modeTag}`;
    $('.over-stats').innerHTML = this.stats([
      [t('stats.reached'), t('hud.waveOf', { n: r.wave, total: WAVES_PER_LEVEL })],
      [t('stats.score'), fmt(r.score)],
      [t('stats.asteroids'), fmt(r.kills)],
      [t('stats.bestCombo'), `×${r.bestMultiplier}`],
    ]);
    this.show('over');
  }
}
