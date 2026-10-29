import { CssBaseline, ThemeProvider } from '@mui/material';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { App } from './App';
import { STATIC_MODE } from './api';
import { MachineProvider, ToastProvider } from './hooks';
import { theme } from './theme';

const Router = STATIC_MODE ? HashRouter : BrowserRouter;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ToastProvider>
        {/* Static hosting cannot rewrite deep links, so the browser-only build uses hash URLs. */}
        <Router>
          <MachineProvider>
            <App />
          </MachineProvider>
        </Router>
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>,
);
