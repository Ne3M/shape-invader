import { describe, expect, it } from 'vitest';
import { detectIosBrowser, iosInstallSteps } from '../src/pwa';

// Real-world user agents.
const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/137.0.7151.79 Mobile/15E148 Safari/604.1',
  iphoneFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/139.0 Mobile/15E148 Safari/605.1.15',
  iphoneEdge:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/137.3296.52 Mobile/15E148 Safari/605.1.15',
  iphoneInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 380.0.0.29.109 (iPhone15,2; iOS 18_5; fr_FR; fr; scale=3.00; 1179x2556)',
  iphoneFacebook:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/500.0.0.0;FBBV/1;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.5]',
  iphoneWebView: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  ipadDesktopMode:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
};

describe('iOS install guide', () => {
  it('recognizes the iOS browser in use', () => {
    expect(detectIosBrowser(UA.iphoneSafari)).toBe('safari');
    expect(detectIosBrowser(UA.iphoneChrome)).toBe('chrome');
    expect(detectIosBrowser(UA.iphoneFirefox)).toBe('firefox');
    expect(detectIosBrowser(UA.iphoneEdge)).toBe('edge');
  });

  it('spots browsers inside other apps, which cannot install', () => {
    expect(detectIosBrowser(UA.iphoneInstagram)).toBe('inapp');
    expect(detectIosBrowser(UA.iphoneFacebook)).toBe('inapp');
    expect(detectIosBrowser(UA.iphoneWebView)).toBe('inapp');
  });

  it('treats an iPad in desktop mode as iOS, but not a Mac or Android', () => {
    expect(detectIosBrowser(UA.ipadDesktopMode, 'MacIntel', 5)).toBe('safari');
    expect(detectIosBrowser(UA.macSafari, 'MacIntel', 0)).toBeNull();
    expect(detectIosBrowser(UA.androidChrome, 'Linux armv8l', 5)).toBeNull();
  });

  it('gives steps that lead to Add to Home Screen (or to Safari from another app)', () => {
    for (const kind of ['safari', 'chrome', 'firefox', 'edge'] as const) {
      expect(iosInstallSteps(kind).join(' ')).toContain('Add to Home Screen');
    }
    expect(iosInstallSteps('inapp').join(' ')).toContain('Open in Safari');
  });
});
