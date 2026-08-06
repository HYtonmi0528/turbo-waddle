import React from 'react';
import { createRoot } from 'react-dom/client';
import CollaborationShell from './components/CollaborationShell';
import './styles/app.css';

const root = createRoot(document.getElementById('root'));
root.render(<CollaborationShell />);
