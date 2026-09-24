import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import './style.css';
import { startPwa } from './pwaRuntime';
startPwa();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
