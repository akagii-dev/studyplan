import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import './style.css';
import { startLanRuntime } from './lanRuntime';
startLanRuntime();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
