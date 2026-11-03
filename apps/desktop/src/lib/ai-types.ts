export type AiProvider = 'openai' | 'anthropic' | 'deepseek';
export interface AiProviderSettings { provider: AiProvider; model: string; vision: boolean; hasKey: boolean }
export interface AiSettings { providers: AiProviderSettings[] }
export interface AiSettingsInput { provider: AiProvider; model: string; vision: boolean; apiKey?: string; removeKey?: boolean }
export interface PhotoAnalysis { photoId: string; provider: AiProvider; model: string; text: string; analyzedAt: string }
