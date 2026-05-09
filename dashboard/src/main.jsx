import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import App from './App.jsx';
import { initTheme } from './lib/theme.js';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/login.css';
import './styles/kanban.css';
import './styles/inbox.css';
import './styles/mobile.css';

initTheme();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <App />
      <Toaster
        position="top-right"
        richColors
        closeButton
        toastOptions={{
          style: {
            fontFamily: 'var(--font-sans)',
          },
        }}
      />
    </HashRouter>
  </React.StrictMode>
);
