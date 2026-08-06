import React from 'react';
import { createRoot } from 'react-dom/client';
import api from './utils/api';
if (!window.electronAPI) window.electronAPI = api;
import CollaborationShell from './components/CollaborationShell';
import './styles/app.css';

const root = createRoot(document.getElementById('root'));
root.render(<CollaborationShell />);
