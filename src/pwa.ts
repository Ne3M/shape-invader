/** Installable app support: service worker registration, install button and iOS hint. */

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

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
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
  if (isInstalled()) return;

  // Chrome, Edge, Samsung Internet...: offer our own install button.
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

  // iOS Safari has no install prompt: explain the manual steps.
  if (isIos()) hint.classList.remove('hidden');
}
