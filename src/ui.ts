import type { Sfx } from './audio';
import type { Game, HudState, LevelResult } from './game';
import { LEVELS, LEVEL_COUNT, WAVES_PER_LEVEL } from './levels';
import { SHAPE_ORDER, SHAPES, demoStroke, shapeSvg } from './shapes';
import { writeSave, type SaveData } from './storage';

type ScreenId = 'title' | 'levels' | 'intro' | 'pause' | 'complete' | 'over';

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

export class UI {
  private current: ScreenId | null = 'title';
  private selected = 0;
  private hudCache = { shield: -1, score: -1, multiplier: -1, wave: -1, level: -1 };
  private bannerTimer = 0;

  constructor(
    private game: Game,
    private sfx: Sfx,
    private save: SaveData,
  ) {
    $('.title-shapes').innerHTML = SHAPE_ORDER.map((s) => shapeSvg(s, 30)).join('');
    this.sfx.setMuted(save.sfxMuted);
    this.sfx.setMusicMuted(save.musicMuted);
    this.updateMuteButtons();

    // Browsers only allow audio after a user gesture: start it on the first touch or click anywhere.
    document.addEventListener('pointerdown', () => this.sfx.unlock(), { once: true });
    document.addEventListener('keydown', () => this.sfx.unlock(), { once: true });

    document.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (btn) this.action(btn.dataset.action!, btn);
    });
    $('#btn-pause').addEventListener('click', () => this.pause());
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
    game.onBanner = (t, s) => this.banner(t, s);
    game.onLevelComplete = (r) => this.levelComplete(r);
    game.onGameOver = (r) => this.gameOver(r);
  }

  private updateMuteButtons(): void {
    const music = $('#btn-music');
    const sfx = $('#btn-sfx');
    music.classList.toggle('muted', this.save.musicMuted);
    sfx.classList.toggle('muted', this.save.sfxMuted);
    music.setAttribute('aria-pressed', String(!this.save.musicMuted));
    sfx.setAttribute('aria-pressed', String(!this.save.sfxMuted));
    music.title = this.save.musicMuted ? 'Music off' : 'Music on';
    sfx.title = this.save.sfxMuted ? 'Sound effects off' : 'Sound effects on';
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
      case 'start':
        this.startLevel(this.selected);
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
    const stars = (n: number) => [0, 1, 2].map((i) => `<span class="${i < n ? '' : 'off'}">★</span>`).join('');
    $('.level-grid').innerHTML = LEVELS.map((lv) => {
      const locked = lv.index >= this.save.unlocked;
      return `<button class="level-card" data-action="level" data-level="${lv.index}" ${locked ? 'disabled' : ''}>
        <div class="level-num">${locked ? '🔒' : lv.index + 1}</div>
        <div class="level-name">${lv.name}</div>
        <div class="level-icons">${lv.shapes.map((s) => shapeSvg(s, 16)).join('')}</div>
        <div class="level-stars">${stars(this.save.stars[lv.index])}</div>
        <div class="level-best">${this.save.best[lv.index] ? `Best ${this.save.best[lv.index].toLocaleString()}` : '&nbsp;'}</div>
      </button>`;
    }).join('');
    this.show('levels');
  }

  private showIntro(index: number): void {
    this.selected = index;
    const lv = LEVELS[index];
    $('.intro-kicker').textContent = `Level ${index + 1} of ${LEVEL_COUNT}`;
    $('.intro-name').textContent = lv.name;
    const s = lv.newShape;
    $('.intro-new').innerHTML = s
      ? `<div class="label">${index === 0 ? 'Your first shape' : 'New shape'}</div>
         ${shapeSvg(s, 130, demoStroke(s))}
         <div class="new-name" style="color:${SHAPES[s].color}">${SHAPES[s].name}</div>
         <div class="hint">${SHAPES[s].hint}</div>`
      : '';
    $('.intro-twist').textContent = lv.twist ?? `${WAVES_PER_LEVEL} waves. Draw a shape to blast every asteroid of that shape on screen.`;
    $('.intro-pool').innerHTML = lv.shapes.map((sh) => shapeSvg(sh, 30)).join('');
    this.show('intro');
  }

  private startLevel(index: number): void {
    this.selected = index;
    $('.hud-legend').innerHTML = LEVELS[index].shapes.map((s) => shapeSvg(s, 26)).join('');
    this.hudCache = { shield: -1, score: -1, multiplier: -1, wave: -1, level: -1 };
    this.show(null);
    this.game.startLevel(index);
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
      $('.hud-score').textContent = h.score.toLocaleString();
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
    if (h.wave !== c.wave || h.level !== c.level) {
      c.wave = h.wave;
      c.level = h.level;
      // The groove builds up over the waves; later levels start hotter.
      this.sfx.setMusicIntensity(((h.wave - 1) / (WAVES_PER_LEVEL - 1)) * 0.75 + ((h.level - 1) / (LEVEL_COUNT - 1)) * 0.35);
      $('.hud-wave').textContent = `Wave ${h.wave}/${WAVES_PER_LEVEL}`;
      $('.hud-level').textContent = `Level ${h.level}`;
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
    const newBest = r.score > this.save.best[i];
    this.save.best[i] = Math.max(this.save.best[i], r.score);
    this.save.stars[i] = Math.max(this.save.stars[i], r.stars);
    this.save.unlocked = Math.max(this.save.unlocked, Math.min(LEVEL_COUNT, i + 2));
    writeSave(this.save);

    const last = i === LEVEL_COUNT - 1;
    $('.complete-kicker').textContent = `Level ${i + 1} · ${LEVELS[i].name}`;
    $('.complete-title').textContent = last ? 'You beat Shape Invaders!' : 'Level clear!';
    $('#screen-complete .stars').innerHTML = [0, 1, 2].map((k) => `<span class="${k < r.stars ? '' : 'off'}">★</span>`).join('');
    $('.complete-stats').innerHTML =
      this.stats([
        ['Score', r.score.toLocaleString()],
        ['Best', this.save.best[i].toLocaleString()],
        ['Asteroids', String(r.kills)],
        ['Best combo', `×${r.bestMultiplier}`],
        ['Shield hits', String(r.hits)],
      ]) + (newBest ? '<div class="new-best">New best!</div>' : '');
    $('[data-action="next"]', $('#screen-complete')).classList.toggle('hidden', last);
    this.show('complete');
  }

  private gameOver(r: LevelResult): void {
    const i = r.level;
    this.save.best[i] = Math.max(this.save.best[i], r.score);
    writeSave(this.save);
    $('.over-kicker').textContent = `Level ${i + 1} · ${LEVELS[i].name}`;
    $('.over-stats').innerHTML = this.stats([
      ['Reached', `Wave ${r.wave}/${WAVES_PER_LEVEL}`],
      ['Score', r.score.toLocaleString()],
      ['Asteroids', String(r.kills)],
      ['Best combo', `×${r.bestMultiplier}`],
    ]);
    this.show('over');
  }
}
