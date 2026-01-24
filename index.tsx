import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';

// Initialize Eruda for mobile debugging in development or if debug param is present
const urlParams = new URLSearchParams(window.location.search);
const isDebug = import.meta.env.DEV || urlParams.get('debug') === 'true';

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
});

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error("Root element not found");

const root = ReactDOM.createRoot(rootElement);
root.render(
  // StrictMode removed to prevent double-initialization of webcam in dev, 
  // though handled in useEffect cleanup, it's safer for hardware integration demos.
  <App />
);