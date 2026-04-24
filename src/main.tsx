// Polyfill Buffer for @react-pdf/renderer in the browser — must run BEFORE
// any other import so synchronous `Buffer` references resolve.
import { Buffer as _Buffer } from 'buffer';
(globalThis as any).Buffer = (globalThis as any).Buffer || _Buffer;
(globalThis as any).global = globalThis;

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { initSentry } from './services/sentry';

// Initialise Sentry before rendering (no-op without VITE_SENTRY_DSN)
initSentry().catch(() => {});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>
);

// Register service worker for PWA — force update check on every load
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // Force check for new SW on every page load
      reg.update();
      // When a new SW becomes waiting, tell it to activate immediately
      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing;
        if (newSW) {
          newSW.addEventListener('statechange', () => {
            if (newSW.state === 'activated') {
              // New service worker activated — reload to use fresh assets
              window.location.reload();
            }
          });
        }
      });
    }).catch(() => {});
  });
}
