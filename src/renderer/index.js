import React from 'react';
import { createRoot } from 'react-dom/client';
import CollaborationShell from './components/CollaborationShell';
import { I18nProvider } from './i18n';
import './styles/app.css';

const root = createRoot(document.getElementById('root'));
root.render(<I18nProvider><CollaborationShell /></I18nProvider>);
