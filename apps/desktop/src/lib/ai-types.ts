export type AiProvider = 'openai' | 'anthropic' | 'deepseek';
export interface AiConnection { provider: AiProvider; model: string; vision: boolean; hasKey: boolean }
export interface AiSettings { connection: AiConnection | null }
export interface AiSettingsInput { provider: AiProvider; model: string; vision: boolean; apiKey?: string }
export interface PhotoAnalysis { photoId: string; provider: AiProvider; model: string; text: string; analyzedAt: string }
export const aiProviders: { id: AiProvider; name: string; model: string }[] = [
  { id: 'openai', name: 'OpenAI', model: 'gpt-5.4-mini' },
  { id: 'anthropic', name: 'Claude', model: 'claude-opus-5-5' },
  { id: 'deepseek', name: 'DeepSeek', model: 'deepseek-flash' },
];
export function providerName(provider: AiProvider) { return aiProviders.find((item) => item.id === provider)!.name; }
