import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { TextContextMenu } from './components/TextContextMenu';
import { ToastProvider } from './components/ToastProvider';
import { installInputModality } from './lib/input-modality';
import './index.css';

const removeInputModality = installInputModality(document);
import.meta.hot?.dispose(removeInputModality);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ToastProvider><TextContextMenu /><App /></ToastProvider></React.StrictMode>,
);
