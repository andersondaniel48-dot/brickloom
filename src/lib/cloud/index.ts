// The app's entry points to accounts. The Firebase code behind them is loaded on demand, and not at
// all when accounts are not configured (see src/cloud-config.ts).
import { cloudConfigured } from '../../cloud-config.ts';
import './dirty.ts';
import { captureSignInReply, startGoogleSignIn } from './google.ts';
import { useAccount } from './store.ts';

export { useAccount } from './store.ts';
export const accountsEnabled = cloudConfigured;

const engine = () => import('./engine.ts');

/** Call once, before the app renders: picks up a returning Google sign-in and restores a saved one. */
export function initAccounts() {
  if (!cloudConfigured) {
    useAccount.setState({ ready: true });
    return;
  }
  captureSignInReply();
  engine()
    .then((e) => e.start())
    .catch((err) => {
      console.error('accounts could not start', err);
      useAccount.setState({ ready: true, error: 'Accounts are unavailable right now.' });
    });
}

export const signIn = () => startGoogleSignIn();
export const signOut = async () => (await engine()).signOut();
export const syncNow = async () => (await engine()).sync();
export const deleteAccountData = async () => (await engine()).deleteAccountData();
