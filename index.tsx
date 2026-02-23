import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';

declare global {
  interface Window {
    __APP_DIAG__?: boolean;
  }
}

// Initialize Eruda for mobile debugging in development or if debug param is present
const urlParams = new URLSearchParams(window.location.search);
const isDebug = import.meta.env.DEV || urlParams.get('debug') === 'true';
const isDiag =
  isDebug ||
  urlParams.get('diag') === '1' ||
  urlParams.get('diag') === 'true' ||
  window.__APP_DIAG__ === true;
const ua = navigator.userAgent;
const isTouchMac = /Macintosh/i.test(ua) && 'ontouchend' in document;
const isIOSLike = /iPhone|iPad|iPod/i.test(ua) || isTouchMac;
const shouldRegisterSw = !(import.meta.env.DEV && isIOSLike);
const IOS_DEV_SW_RELOAD_MARKER = '__ios_dev_sw_cleanup_reloaded_v1';

window.__APP_DIAG__ = isDiag;

if (isDebug) {
  import('eruda').then((eruda) => {
    eruda.default.init();
    console.log('Eruda initialized');
  });
}

// Register Service Worker for caching and offline support.
// In iOS dev mode, skip dev-sw to avoid first-load camera pipeline races.
if (shouldRegisterSw) {
  registerSW({
    onNeedRefresh() {
      console.log('New content available, auto-updating...');
    },
    onOfflineReady() {
      console.log('App ready to work offline');
    },
    onRegisterError(error) {
      if (isDiag) {
        console.error('[DIAG][SW] register error', error);
      }
    },
    onRegisteredSW(swUrl, registration) {
      if (!isDiag) return;
      console.info('[DIAG][SW] registered', { swUrl, scope: registration?.scope });
    }
  });
} else if (isDiag) {
  console.info('[DIAG][SW] skipped in iOS dev mode');
}

const cleanupServiceWorkerAndCachesInIosDev = async (): Promise<void> => {
  if (shouldRegisterSw) return;
  if (!('serviceWorker' in navigator)) return;

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    let unregisteredCount = 0;
    await Promise.all(registrations.map(async (registration) => {
      try {
        const unregistered = await registration.unregister();
        if (unregistered) {
          unregisteredCount += 1;
        }
      } catch (error) {
        if (isDiag) {
          console.warn('[DIAG][SW] unregister failed', error);
        }
      }
    }));
    if (isDiag) {
      console.info('[DIAG][SW] iOS dev cleanup unregister done', {
        registrations: registrations.length,
        unregisteredCount
      });
    }
  } catch (error) {
    if (isDiag) {
      console.warn('[DIAG][SW] iOS dev cleanup getRegistrations failed', error);
    }
  }

  if ('caches' in window) {
    try {
      const cacheKeys = await caches.keys();
      const targetCacheKeys = cacheKeys.filter((key) => (
        key.startsWith('workbox') ||
        key.startsWith('local-') ||
        key.startsWith('mediapipe-') ||
        key.startsWith('raz-') ||
        key.startsWith('game-assets-') ||
        key.startsWith('google-fonts-') ||
        key.startsWith('gstatic-fonts-')
      ));
      let deletedCount = 0;
      await Promise.all(targetCacheKeys.map(async (key) => {
        try {
          const deleted = await caches.delete(key);
          if (deleted) {
            deletedCount += 1;
          }
        } catch (error) {
          if (isDiag) {
            console.warn('[DIAG][SW] cache delete failed', { key, error });
          }
        }
      }));
      if (isDiag) {
        console.info('[DIAG][SW] iOS dev cleanup caches done', {
          targetCaches: targetCacheKeys.length,
          deletedCount
        });
      }
    } catch (error) {
      if (isDiag) {
        console.warn('[DIAG][SW] iOS dev cleanup cache keys failed', error);
      }
    }
  }

  const hasController = !!navigator.serviceWorker.controller;
  if (hasController) {
    const hasReloaded = sessionStorage.getItem(IOS_DEV_SW_RELOAD_MARKER) === '1';
    if (!hasReloaded) {
      sessionStorage.setItem(IOS_DEV_SW_RELOAD_MARKER, '1');
      if (isDiag) {
        console.info('[DIAG][SW] iOS dev cleanup forcing one reload to detach controller');
      }
      window.location.reload();
      return;
    }
  } else {
    sessionStorage.removeItem(IOS_DEV_SW_RELOAD_MARKER);
  }
};

void cleanupServiceWorkerAndCachesInIosDev();

if (isDiag) {
  console.info('[DIAG] enabled');
  if ('serviceWorker' in navigator) {
    const t0 = performance.now();
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      const ms = Math.round(performance.now() - t0);
      console.info('[DIAG][SW] controllerchange', { ms });
    });

    navigator.serviceWorker.ready
      .then((registration) => {
        console.info('[DIAG][SW] ready', { scope: registration.scope });

        const onUpdateFound = () => {
          const foundAt = performance.now();
          const installing = registration.installing;
          console.info('[DIAG][SW] updatefound', { ms: Math.round(foundAt - t0) });

          if (!installing) return;
          const onStateChange = () => {
            const stateAt = performance.now();
            console.info('[DIAG][SW] statechange', {
              state: installing.state,
              ms: Math.round(stateAt - t0),
              sinceUpdateFoundMs: Math.round(stateAt - foundAt)
            });
          };
          installing.addEventListener('statechange', onStateChange);
        };

        registration.addEventListener('updatefound', onUpdateFound);
      })
      .catch((error) => {
        console.error('[DIAG][SW] ready error', error);
      });
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error("Root element not found");

const root = ReactDOM.createRoot(rootElement);
root.render(
  // StrictMode removed to prevent double-initialization of webcam in dev, 
  // though handled in useEffect cleanup, it's safer for hardware integration demos.
  <App />
);
