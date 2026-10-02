// "Sign in with Google" by full-page redirect.
//
// The usual pop-up sign-in does not work in an app installed to an iPhone home screen (the pop-up
// opens in a separate browser that cannot report back), and the SDK's own redirect flow depends on
// third-party storage that Safari and Chrome now block. So the app sends the browser to Google
// itself and receives an ID token back in the address fragment, which works everywhere, including
// installed apps, and needs no server.
import { cloudConfig } from '../../cloud-config.ts';

const PENDING = 'brickloom-oauth';

/** The address Google sends people back to: the app's root, which must be registered as a redirect URI. */
export const redirectUri = () => `${location.origin}${import.meta.env.BASE_URL}`;

const random = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

/** Leaves the app for Google's sign-in page. */
export function startGoogleSignIn() {
  const nonce = random();
  const state = random();
  // Remember where the person was, and the two values that prove the reply belongs to this request.
  localStorage.setItem(PENDING, JSON.stringify({ nonce, state, returnTo: location.pathname + location.search }));
  const params = new URLSearchParams({
    client_id: cloudConfig.googleClientId,
    redirect_uri: redirectUri(),
    response_type: 'id_token',
    scope: 'openid email profile',
    nonce,
    state,
    prompt: 'select_account',
  });
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

export type SignInReply = { idToken: string } | { error: string };

let reply: SignInReply | null = null;

/** The `nonce` claim of an ID token, without verifying it (Firebase verifies the signature). */
function nonceOf(idToken: string): string | null {
  try {
    const payload = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return (JSON.parse(atob(payload)) as { nonce?: string }).nonce ?? null;
  } catch {
    return null;
  }
}

/**
 * Call once at startup, before the router reads the address. If the page was opened by Google's
 * redirect, keeps the reply for `takeSignInReply`, removes it from the address bar and history, and
 * returns to the screen the person started from.
 */
export function captureSignInReply() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (!fragment.has('id_token') && !fragment.has('error')) return;

  let pending: { nonce: string; state: string; returnTo: string } | null = null;
  try {
    pending = JSON.parse(localStorage.getItem(PENDING) ?? 'null');
  } catch {
    pending = null;
  }
  localStorage.removeItem(PENDING);

  const idToken = fragment.get('id_token');
  if (fragment.has('error')) {
    // "access_denied" just means the person backed out.
    reply = fragment.get('error') === 'access_denied' ? null : { error: 'Google could not sign you in. Please try again.' };
  } else if (!pending || fragment.get('state') !== pending.state || !idToken || nonceOf(idToken) !== pending.nonce) {
    reply = { error: 'That sign-in reply did not match a request from this app. Please try again.' };
  } else {
    reply = { idToken };
  }

  const returnTo = pending?.returnTo?.startsWith(import.meta.env.BASE_URL) ? pending.returnTo : import.meta.env.BASE_URL;
  history.replaceState(null, '', returnTo);
}

/** The reply captured at startup, if any. Returns it once. */
export function takeSignInReply(): SignInReply | null {
  const taken = reply;
  reply = null;
  return taken;
}
