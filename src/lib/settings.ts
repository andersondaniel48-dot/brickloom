import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'system' | 'light' | 'dark';

/** The companies whose models can do the designing. */
export type Provider = 'claude' | 'openai';

export interface ModelChoice {
  id: string;
  name: string;
  /** What choosing it means for the builder, in a line. */
  note: string;
}

/** Anthropic's current models, most capable first. */
export const CLAUDE_MODELS: readonly ModelChoice[] = [
  { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', note: 'The most capable, for the hardest designs. Slowest, and the highest cost.' },
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', note: 'Recommended. Strong designs at a moderate cost.' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', note: 'Faster, at half the cost of Opus.' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', note: 'Fastest and cheapest. Simpler designs.' },
];
const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';

/** OpenAI's models worth offering, most capable first. The first is the default. */
export const OPENAI_MODELS: readonly ModelChoice[] = [
  { id: 'gpt-6-astra', name: 'GPT-6 Astra', note: 'The most capable. Best designs, highest cost.' },
  { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', note: 'Close to the best, at about a fifth of the cost.' },
  { id: 'gpt-6-luna', name: 'GPT-6 Luna', note: 'Fastest and by far the cheapest. Simpler designs.' },
];

/** The models on offer from each provider. */
export const MODELS: Record<Provider, readonly ModelChoice[]> = { claude: CLAUDE_MODELS, openai: OPENAI_MODELS };

/** A model's name as people know it, or its id if it is not one of those on offer. */
export const modelName = (provider: Provider, id: string) => MODELS[provider].find((m) => m.id === id)?.name ?? id;

interface Settings {
  theme: Theme;
  /** Anthropic API key entered in the app; sent only to Anthropic. */
  apiKey: string;
  claudeModel: string;
  /** OpenAI API key entered in the app; sent only to OpenAI. */
  openaiKey: string;
  openaiModel: string;
  /** Whose model to design with, when there is a key for both. */
  provider: Provider;
  setTheme: (theme: Theme) => void;
  setApiKey: (key: string) => void;
  setClaudeModel: (model: string) => void;
  setOpenaiKey: (key: string) => void;
  setOpenaiModel: (model: string) => void;
  setProvider: (provider: Provider) => void;
}

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      theme: 'system',
      apiKey: '',
      claudeModel: DEFAULT_CLAUDE_MODEL,
      openaiKey: '',
      openaiModel: OPENAI_MODELS[0].id,
      provider: 'claude',
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      setApiKey: (apiKey) => set({ apiKey: apiKey.trim() }),
      setClaudeModel: (claudeModel) => set({ claudeModel }),
      setOpenaiKey: (openaiKey) => set({ openaiKey: openaiKey.trim() }),
      setOpenaiModel: (openaiModel) => set({ openaiModel }),
      setProvider: (provider) => set({ provider }),
    }),
    { name: 'brickloom-settings' },
  ),
);

/** Which model will design the next build: null when no key has been entered, and the offline quick-builder steps in. */
export type Designer = { provider: Provider; apiKey: string; model: string } | null;

/** The builder's choice of provider, as long as there is a key for it; otherwise whichever provider there is a key for. */
export function designerFor(s: Pick<Settings, 'provider' | 'apiKey' | 'claudeModel' | 'openaiKey' | 'openaiModel'>): Designer {
  const claude: Designer = s.apiKey ? { provider: 'claude', apiKey: s.apiKey, model: s.claudeModel } : null;
  const openai: Designer = s.openaiKey ? { provider: 'openai', apiKey: s.openaiKey, model: s.openaiModel } : null;
  return s.provider === 'openai' ? (openai ?? claude) : (claude ?? openai);
}

export function applyTheme(theme: Theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
