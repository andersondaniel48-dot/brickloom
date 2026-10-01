// Installing the app to the home screen. Chrome and Edge (Android, desktop) announce that the app is
// installable with a `beforeinstallprompt` event, which has to be caught when it fires and replayed
// from a button press. Safari on iOS has no such event: people add the app from the Share menu.
import { create } from 'zustand';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface InstallState {
  /** The browser has offered an install prompt that can be shown now. */
  available: boolean;
  /** Running as an installed app rather than in a browser tab. */
  installed: boolean;
  install: () => Promise<void>;
}

let deferred: InstallPromptEvent | null = null;

const standalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const useInstall = create<InstallState>((set) => ({
  available: false,
  installed: standalone(),
  install: async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    set({ available: false, installed: outcome === 'accepted' });
  },
}));

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault(); // keep it for our own button instead of the browser's mini-infobar
  deferred = event as InstallPromptEvent;
  useInstall.setState({ available: true });
});
window.addEventListener('appinstalled', () => useInstall.setState({ available: false, installed: true }));

/** iPhones and iPads (which report themselves as Macs but have a touch screen). */
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
