// Settings for "Sign in with Google" and saving collections to an account.
//
// Leave these empty to run the app without accounts: everything stays on each device.
// To turn accounts on, create a Firebase project and fill these in (the README walks through it).
// None of these values is a secret. They identify the project; what protects people's data is the
// Firestore security rules, which only let each signed-in person read and write their own.
export const cloudConfig = {
  firebase: {
    apiKey: 'AIzaSyB3ldghJbpZ6wXObuEJR1oqQm-vP-FdSR8',
    authDomain: 'brickloom-48d46.firebaseapp.com',
    projectId: 'brickloom-48d46',
    appId: '1:317015474226:web:803dded072ae808b0abc2b',
  },
  /** The "Web client ID" shown in Firebase under Authentication > Sign-in method > Google. */
  googleClientId: '317015474226-vta39lmgs69svmp4guba5jarohkj3liu.apps.googleusercontent.com',
};

export const cloudConfigured = Boolean(cloudConfig.firebase.apiKey && cloudConfig.firebase.projectId && cloudConfig.googleClientId);
