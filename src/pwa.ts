import { t, type MessageKey } from './i18n';

/** Installable app support: service worker registration, install button, and an iOS install guide. */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function isInstalled(): boolean {
  return (
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Which iOS browser the page is open in. 'inapp' = a browser inside another app (WhatsApp, Instagram...),
 *  which cannot add anything to the Home Screen. */
export type IosBrowser = 'safari' | 'chrome' | 'firefox' | 'edge' | 'inapp';

/** Returns the iOS browser kind, or null when not on iPhone/iPad. Pure, so it can be unit-tested. */
export function detectIosBrowser(ua: string, platform = '', maxTouchPoints = 0): IosBrowser | null {
  const ios = /iphone|ipad|ipod/i.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1);
  if (!ios) return null;
  if (/CriOS/i.test(ua)) return 'chrome';
  if (/FxiOS/i.test(ua)) return 'firefox';
  if (/EdgiOS/i.test(ua)) return 'edge';
  // Known in-app browsers, plus any web view without Safari's own "Safari/" token.
  if (/FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|Line\/|Twitter|Snapchat|TikTok|musical_ly|BytedanceWebview|GSA\/|Pinterest|WhatsApp/i.test(ua)) return 'inapp';
  if (!/Safari\//.test(ua)) return 'inapp';
  return 'safari';
}

/** Icons shown inside the steps (their labels are translated when used). */
function icons(): Record<'share' | 'add' | 'more', string> {
  return {
    share: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="${t('install.icon.share')}"><path d="M12 3v12M7 8l5-5 5 5M5 12v8h14v-8"/></svg>`,
    add: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-label="${t('install.icon.add')}"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>`,
    more: `<span class="key" aria-label="${t('install.icon.more')}">•••</span>`,
  };
}

/** Step-by-step instructions (HTML, in the current language) for adding the game to the Home Screen. */
export function iosInstallSteps(kind: IosBrowser): string[] {
  const step = (key: MessageKey) => t(key, icons());
  switch (kind) {
    case 'safari':
      return [step('install.safari.more'), step('install.step.share'), step('install.step.addToHome'), step('install.safari.webApp')];
    case 'chrome':
      return [step('install.chrome.share'), step('install.step.addToHome'), step('install.chrome.add')];
    case 'firefox':
    case 'edge':
      return [step('install.menu.open'), step('install.step.share'), step('install.step.addToHome'), step('install.step.add')];
    case 'inapp':
      return [step('install.inapp.why'), step('install.inapp.open'), step('install.inapp.again')];
  }
}

function showIosGuide(kind: IosBrowser, device: string): void {
  const sheet = document.getElementById('install-sheet')!;
  sheet.querySelector('.install-title')!.textContent = t('install.title', { device });
  sheet.querySelector('.install-steps')!.innerHTML = iosInstallSteps(kind)
    .map((s) => `<li>${s}</li>`)
    .join('');
  sheet.querySelector('.install-foot')!.classList.toggle('hidden', kind === 'inapp');
  sheet.classList.remove('hidden');
}

export function setupPwa(): void {
  // The service worker would fight with Vite's hot reload, so it only runs in the built game.
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        /* not served over HTTPS: the game still works, just not installable/offline */
      });
    });
  }

  const btn = document.getElementById('btn-install')!;
  const hint = document.getElementById('install-hint')!;
  const sheet = document.getElementById('install-sheet')!;
  sheet.querySelector('.install-close')!.addEventListener('click', () => sheet.classList.add('hidden'));
  if (isInstalled()) return;

  // iPhone / iPad: browsers there never offer an install prompt to web pages, so show our own
  // button that opens step-by-step instructions for the browser in use.
  const ios = detectIosBrowser(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
  if (ios) {
    const device = /ipad/i.test(navigator.userAgent) || navigator.platform === 'MacIntel' ? 'iPad' : 'iPhone';
    btn.classList.remove('hidden');
    hint.classList.remove('hidden');
    btn.addEventListener('click', () => showIosGuide(ios, device));
    return;
  }

  // Chrome, Edge, Samsung Internet...: the browser's own install prompt behind our button.
  let deferred: BeforeInstallPromptEvent | null = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    btn.classList.remove('hidden');
  });
  btn.addEventListener('click', async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    btn.classList.add('hidden');
  });
  window.addEventListener('appinstalled', () => btn.classList.add('hidden'));
}

/** Dev only: preview the iOS guide on any device (used to check the layout). */
export function previewIosGuide(kind: IosBrowser): void {
  if (import.meta.env.DEV) showIosGuide(kind, 'iPhone');
}
