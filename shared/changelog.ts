// What changed in each version of the app, newest first, in words meant for the people using it.
// The first entry is the current version: it is what Settings shows, and what the "What's new"
// notice is checked against. To release, add an entry here and give package.json the same version
// (a test keeps the two in step).

export interface Release {
  version: string;
  /** The day it was published, as YYYY-MM-DD. */
  date: string;
  title: string;
  changes: string[];
}

export const RELEASES: Release[] = [
  {
    version: '1.6.0',
    date: '2026-10-02',
    title: 'Choose your Claude model',
    changes: [
      'Settings now lets you pick which Claude model designs your builds: Fable 5.1, Opus 5.5, Sonnet 5.5 or Haiku 4.5, from the most capable to the cheapest.',
      'Opus 5.5 remains the one used unless you choose otherwise.',
      'The Create tab says which model will design the build.',
    ],
  },
  {
    version: '1.5.0',
    date: '2026-10-02',
    title: 'Design with ChatGPT',
    changes: [
      'Builds can now be designed by the GPT models behind ChatGPT as well as by Claude. Add an OpenAI API key under Settings, and choose which of the two does the designing.',
      'Three GPT models to choose from, trading quality against cost.',
      'An OpenAI key that is rejected, or an account with no API credit, is now reported as such.',
    ],
  },
  {
    version: '1.4.0',
    date: '2026-10-02',
    title: 'Steadier scanning, and scanning sideways',
    changes: [
      'The scanner now works with the phone held sideways: the picture fills the screen, with the shutter under your thumb.',
      'Pieces in the viewfinder are locked onto. Once a piece has been found it stays outlined while you hold the phone, instead of flickering in and out.',
      'Every piece that was locked on when you press the shutter is scanned, even if that one photo came out soft.',
      'Pieces are found on a sheet of paper or in a tray when the desk around it is in the picture too.',
      'The holes in a beam, and a wheel inside its tire, are no longer counted as extra pieces.',
      'A piece lying against the edge of the table is no longer lost.',
      'The viewfinder stays smooth while it looks for pieces.',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-10-02',
    title: 'Version numbers and release notes',
    changes: [
      'Settings now shows which version of Brickloom you have, and how recent its part catalog is.',
      'After an update, the app tells you what changed the first time you open it.',
      'Every earlier version\'s notes can be read from Settings.',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-10-02',
    title: 'A much better scanner',
    changes: [
      'Fixed the black screen when retaking a scan. Retake is now instant.',
      'A full tray no longer comes back with pieces that "could not be reached".',
      'Photos are taken at the camera\'s full resolution, keeping the sharpest of a few frames.',
      'Pieces are found more reliably on dark, colored or unevenly lit surfaces, and shadows are no longer counted as pieces.',
      'Pieces that touch are told apart in many more cases.',
      'Colors are matched more accurately, especially for pieces in shade.',
      'When a match is uncertain, the runners-up are one tap away on the piece\'s card.',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-10-01',
    title: 'Save to your account',
    changes: ['Sign in with Google to save your collection and builds, and to pick them up on your other devices.'],
  },
  {
    version: '1.0.0',
    date: '2026-10-01',
    title: 'First release',
    changes: [
      'Scan pieces with the camera or from a photo.',
      'Add every piece of a set you own by its name or number.',
      'Browse and sort your collection by type, color and shape.',
      'Have a model designed from the pieces you own, with step-by-step instructions.',
      'Install the app on your phone\'s home screen.',
    ],
  },
];

/** The version of the app this code is. */
export const VERSION = RELEASES[0].version;

/** Orders two versions written as numbers separated by dots: negative when `a` is the older. */
export function compareVersions(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** The releases that came after a version, newest first. */
export const releasesSince = (version: string): Release[] => RELEASES.filter((r) => compareVersions(r.version, version) > 0);
