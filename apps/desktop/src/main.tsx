import React from 'react';
import ReactDOM from 'react-dom/client';
import { invoke, isTauri } from '@tauri-apps/api/core';
import App from './App';
import { TextContextMenu } from './components/TextContextMenu';
import { ToastProvider } from './components/ToastProvider';
import { installInputModality } from './lib/input-modality';
import { getLocale, resumeLanguageSettings } from './lib/i18n';
import './index.css';

const removeInputModality = installInputModality(document);
import.meta.hot?.dispose(removeInputModality);

async function mountApp() {
  const locale = getLocale();
  document.documentElement.lang = locale;
  if (isTauri()) {
    await invoke('set_interface_locale', { locale }).catch((error) => console.error(error));
  }
  const resumeSettings = resumeLanguageSettings();
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode><ToastProvider><TextContextMenu /><App resumeSettings={resumeSettings} /></ToastProvider></React.StrictMode>,
  );
}

void mountApp();
