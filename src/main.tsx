import '@fontsource-variable/inter';
import '@fontsource-variable/outfit';
import './index.css';
import './lib/install.ts'; // listens for the browser's install offer from the first moment
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App.tsx';
import { initAccounts } from './lib/cloud/index.ts';

// Before the router reads the address: a returning Google sign-in arrives in the address fragment.
initAccounts();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* The app may live under a sub-path (GitHub Pages serves it at /<repository>/). */}
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
