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

window.__APP_DIAG__ = isDiag;

if (isDebug) {
  import('eruda').then((eruda) => {
    eruda.default.init();
    console.log('Eruda initialized');
  });
}

// Register Service Worker for caching and offline support
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
