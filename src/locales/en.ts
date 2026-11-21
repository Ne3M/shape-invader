/**
 * English texts. This file defines every message key; other languages must provide the same keys
 * (TypeScript checks it). `{name}` placeholders are filled in by t(key, { name: value }).
 * Install guide steps may contain HTML and the {more} / {share} / {add} icons.
 */
export const en = {
  // Language itself (shown in the language switch)
  'lang.code': 'EN',
  'lang.name': 'English',
  'lang.locale': 'en-US',
  'lang.label': 'Language',

  // Title screen
  'title.tagline': 'Draw the shape. Destroy the swarm.',
  'title.play': 'Play',
  'title.install': 'Install app',
  'title.installHint': 'Add it to your Home Screen to play full screen, even offline.',
  'title.help': 'Draw with your finger or mouse. Each shape you draw blasts every asteroid of that shape on screen.',

  // iPhone / iPad install guide
  'install.title': 'Install on {device}',
  'install.foot': 'The game then opens full screen from its icon, even offline.',
  'install.gotIt': 'Got it',
  'install.icon.share': 'Share',
  'install.icon.add': 'Add',
  'install.icon.more': 'More',
  'install.step.addToHome': "Tap <b>Add to Home Screen</b> {add} (scroll down the list if you don't see it).",
  'install.step.share': 'Tap <b>Share</b> {share}.',
  'install.step.add': 'Tap <b>Add</b>.',
  'install.safari.more':
    'Tap the {more} button next to the address bar.<br><small>On older iOS, tap the Share button {share} at the bottom of the screen and skip to step 3.</small>',
  'install.safari.webApp': 'Leave <b>Open as Web App</b> on if you see it, then tap <b>Add</b>.',
  'install.chrome.share': 'Tap the Share button {share} in the address bar.',
  'install.chrome.add':
    'Tap <b>Add</b>.<br><small>Not in the list? Your iOS is too old for this in Chrome: open the page in Safari instead.</small>',
  'install.menu.open': 'Open the browser menu ({more} or ☰).',
  'install.inapp.why': "The game is open <b>inside another app</b>, which can't install it.",
  'install.inapp.open': 'Tap {more} or the compass icon in this screen, then <b>Open in Safari</b> (or “Open in browser”).',
  'install.inapp.again': 'In Safari, tap <b>Install app</b> again and follow the steps.',

  // Level select
  'levels.title': 'Select level',
  'levels.modeLabel': 'Game mode',
  'levels.normal': 'Normal',
  'levels.expert': 'Expert',
  'levels.hintNormal': 'Asteroids fly straight at your ship.',
  'levels.hintExpert': 'Each shape follows its own route: circles spiral in, zigzags zigzag, squares take the stairs…',
  'levels.best': 'Best {score}',
  'common.back': 'Back',
  'common.levelSelect': 'Level select',
  'mode.expertTag': ' · Expert',

  // Endless mode
  'endless.name': 'Endless',
  'endless.tagline': 'As many waves as you can survive',
  'endless.best': 'Best: wave {wave} · {score}',
  'endless.noRecord': 'No record yet',

  // Level intro
  'intro.levelOf': 'Level {n} of {total}',
  'intro.endlessKicker': 'Endless mode',
  'intro.endlessText':
    'No final wave. A new shape joins every 2 waves, then the pace keeps picking up. How far can you go?',
  'intro.record': 'Your best: wave {wave}',
  'intro.firstShape': 'Your first shape',
  'intro.newShape': 'New shape',
  'intro.defaultTwist': '{waves} waves. Draw a shape to blast every asteroid of that shape on screen.',
  'intro.start': 'Start',

  // Pause / results
  'pause.title': 'Paused',
  'pause.resume': 'Resume',
  'pause.restart': 'Restart level',
  'complete.title': 'Level clear!',
  'complete.won': 'You beat Shape Invaders!',
  'complete.next': 'Next level',
  'complete.replay': 'Replay',
  'over.title': 'Shield down',
  'over.retry': 'Retry',
  'stats.score': 'Score',
  'stats.best': 'Best',
  'stats.asteroids': 'Asteroids',
  'stats.bestCombo': 'Best combo',
  'stats.shieldHits': 'Shield hits',
  'stats.reached': 'Reached',
  'stats.bestWave': 'Best wave',
  'stats.bestScore': 'Best score',
  'stats.newBest': 'New best!',
  'stats.newBestWave': 'New best wave!',
  'stats.newBestScore': 'New best score!',

  // HUD and buttons
  'hud.shield': 'Shield',
  'hud.pause': 'Pause',
  'hud.level': 'Level {n}',
  'hud.wave': 'Wave {n}',
  'hud.waveOf': 'Wave {n}/{total}',
  'hud.bomb': 'Bomb',
  'hud.bombLabel': 'Bomb: destroys every shape on screen',
  'hud.bombReady': 'Bomb ready (Space)',
  'hud.bombCharging': 'Bomb charging… {s} s',
  'audio.musicLabel': 'Music on/off',
  'audio.musicOn': 'Music on',
  'audio.musicOff': 'Music off',
  'audio.sfxLabel': 'Sound effects on/off',
  'audio.sfxOn': 'Sound effects on',
  'audio.sfxOff': 'Sound effects off',

  // In-game banners
  'banner.wave': 'Wave {n}',
  'banner.finalWave': 'Final wave',
  'banner.progress': '{n} / {total}',
  'banner.cleared': 'Wave {n} clear · {next}',
  'banner.levelClear': 'Level clear!',
  'banner.newShape': 'New shape: {shape}',

  // In-game floating texts
  'fx.bomb': 'BOMB',
  'fx.bombCount': 'BOMB ×{n}',
  'fx.bombReady': 'Bomb ready',
  'fx.double': 'DOUBLE',
  'fx.triple': 'TRIPLE',
  'fx.quad': 'QUAD',
  'fx.multi': '{n}× MULTI',
  'fx.combo': 'COMBO ×{n}',
  'fx.comboLost': 'Combo lost',

  // Shapes: name, drawing hint, and the message when none is on screen
  'shape.circle.name': 'Circle',
  'shape.circle.hint': 'One smooth loop back to where you started.',
  'shape.circle.none': 'No circle',
  'shape.triangle.name': 'Triangle',
  'shape.triangle.hint': 'Three straight sides, three sharp corners.',
  'shape.triangle.none': 'No triangle',
  'shape.square.name': 'Square',
  'shape.square.hint': 'Four sides, four corners. Tilted works too.',
  'shape.square.none': 'No square',
  'shape.infinity.name': 'Infinity',
  'shape.infinity.hint': 'A sideways 8: loop one way, cross over, loop back.',
  'shape.infinity.none': 'No infinity',
  'shape.line.name': 'Line',
  'shape.line.hint': 'One straight swipe, any direction.',
  'shape.line.none': 'No line',
  'shape.v.name': 'V',
  'shape.v.hint': 'Down to one sharp point, then back up.',
  'shape.v.none': 'No V',
  'shape.wave.name': 'Wave',
  'shape.wave.hint': 'Smooth, rounded curves. No sharp corners.',
  'shape.wave.none': 'No wave',
  'shape.zigzag.name': 'Zigzag',
  'shape.zigzag.hint': 'Sharp back-and-forth, at least three corners.',
  'shape.zigzag.none': 'No zigzag',

  // Levels
  'level.0.name': 'First Contact',
  'level.1.name': 'Sharp Turns',
  'level.2.name': 'Four Corners',
  'level.3.name': 'Endless Loop',
  'level.4.name': 'Straight Shot',
  'level.5.name': 'Point Break',
  'level.6.name': 'Making Waves',
  'level.7.name': 'Zigzag Alley',
  'level.8.name': 'The Swarm',
  'level.9.name': 'Shape Storm',
  'level.8.twist': 'All shapes. Faster, denser waves.',
  'level.9.twist': 'All shapes. Bursts from every side.',
} as const;
