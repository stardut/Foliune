import { call } from './api';
import type { AiProvider, AiSettings, AiSettingsInput, PhotoAnalysis } from './ai-types';
export const loadAiSettings = () => call<AiSettings>('ai_settings');
export const saveAiSettings = (input: AiSettingsInput) => call<AiSettings>('ai_save_settings', { input });
export const analyzePhoto = (photoId: string, provider: AiProvider, prompt?: string) => call<PhotoAnalysis>('ai_analyze_photo', { photoId, provider, prompt: prompt ?? null });
export const listPhotoAnalyses = () => call<PhotoAnalysis[]>('ai_list_analyses');
export const runAiText = (provider: AiProvider, prompt: string) => call<string>('ai_run_text', { provider, prompt });
