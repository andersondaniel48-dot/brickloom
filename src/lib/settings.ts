import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'system' | 'light' | 'dark';

interface Settings {
  theme: Theme;
  /** Anthropic API key entered in the app; sent only to this app's own server. */
  apiKey: string;
  setTheme: (theme: Theme) => void;
  setApiKey: (key: string) => void;
}

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      theme: 'system',
      apiKey: '',
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      setApiKey: (apiKey) => set({ apiKey: apiKey.trim() }),
    }),
    { name: 'brickloom-settings' },
  ),
);

export function applyTheme(theme: Theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
