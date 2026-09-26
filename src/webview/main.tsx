import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from './app/AppShell';
import './design/tokens.css';
// Themes layer on top of the base tokens, so they must load after them.
import './design/themes.css';
import './app/app.css';
import './app/splitpane.css';
import './features/review/review.css';
import './features/settings/settings.css';

const container = document.getElementById('root');

if (container) {
  createRoot(container).render(
    <StrictMode>
      <AppShell />
    </StrictMode>,
  );
}
