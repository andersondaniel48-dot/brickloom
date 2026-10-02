import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'system' | 'light' | 'dark';

/** The companies whose models can do the designing. */
export type Provider = 'claude' | 'openai';

/** OpenAI's models worth offering, best first. The first is the default. */
export const OPENAI_MODELS = [
  { id: 'gpt-6-astra', name: 'GPT-6 Astra', note: 'The most capable. Best designs, highest cost.' },
  { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', note: 'Close to the best, at about a fifth of the cost.' },
  { id: 'gpt-6-luna', name: 'GPT-6 Luna', note: 'Fastest and by far the cheapest. Simpler designs.' },
] as const;

interface Settings {
  theme: Theme;
  /** Anthropic API key entered in the app; sent only to Anthropic. */
  apiKey: string;
  /** OpenAI API key entered in the app; sent only to OpenAI. */
  openaiKey: string;
  openaiModel: string;
  /** Whose model to design with, when there is a key for both. */
  provider: Provider;
  setTheme: (theme: Theme) => void;
  setApiKey: (key: string) => void;
  setOpenaiKey: (key: string) => void;
  setOpenaiModel: (model: string) => void;
  setProvider: (provider: Provider) => void;
}

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      theme: 'system',
      apiKey: '',
      openaiKey: '',
      openaiModel: OPENAI_MODELS[0].id,
      provider: 'claude',
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      setApiKey: (apiKey) => set({ apiKey: apiKey.trim() }),
      setOpenaiKey: (openaiKey) => set({ openaiKey: openaiKey.trim() }),
      setOpenaiModel: (openaiModel) => set({ openaiModel }),
      setProvider: (provider) => set({ provider }),
    }),
    { name: 'brickloom-settings' },
  ),
);

/** Which model will design the next build: null when no key has been entered, and the offline quick-builder steps in. */
export type Designer = { provider: 'claude'; apiKey: string } | { provider: 'openai'; apiKey: string; model: string } | null;

/** The builder's choice of provider, as long as there is a key for it; otherwise whichever provider there is a key for. */
export function designerFor(s: Pick<Settings, 'provider' | 'apiKey' | 'openaiKey' | 'openaiModel'>): Designer {
  const claude: Designer = s.apiKey ? { provider: 'claude', apiKey: s.apiKey } : null;
  const openai: Designer = s.openaiKey ? { provider: 'openai', apiKey: s.openaiKey, model: s.openaiModel } : null;
  return s.provider === 'openai' ? (openai ?? claude) : (claude ?? openai);
}

export function applyTheme(theme: Theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
