import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
// Display faces of the game UI, bundled so the desktop app needs no network:
// Montserrat Black Italic for Latin letters and digits, Zen Kaku Gothic New Black for Japanese.
import '@fontsource/montserrat/900-italic.css';
import '@fontsource/zen-kaku-gothic-new/900.css';
// Body weights, used while the UI boost sets all text in the title faces (the default).
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/700.css';
import '@fontsource/zen-kaku-gothic-new/500.css';
import '@fontsource/zen-kaku-gothic-new/700.css';
import './index.css';
import { startLanRuntime } from './lanRuntime';
startLanRuntime();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
