import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { ToastHost } from './components/ui.jsx';
import { initMotion } from './lib/motion.js';
initMotion();
createRoot(document.getElementById('root')).render(<ToastHost><App /></ToastHost>);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
