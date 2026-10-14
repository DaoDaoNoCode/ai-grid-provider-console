import '@patternfly/react-core/dist/styles/base.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { HttpConsoleService } from './api/HttpConsoleService';

const container = document.getElementById('root');
if (!container) {
  throw new Error('missing #root element');
}
createRoot(container).render(
  <React.StrictMode>
    <App service={new HttpConsoleService()} />
  </React.StrictMode>,
);
