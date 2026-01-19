import ReactDOM from 'react-dom/client';
import App from './App';

// Initialize Eruda for mobile debugging in development
if (import.meta.env.DEV) {
  import('eruda').then((eruda) => eruda.default.init());
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error("Root element not found");

const root = ReactDOM.createRoot(rootElement);
root.render(
  // StrictMode removed to prevent double-initialization of webcam in dev, 
  // though handled in useEffect cleanup, it's safer for hardware integration demos.
  <App />
);