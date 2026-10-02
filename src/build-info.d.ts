/** Which build of the app this is, filled in by vite.config.ts. */
declare const __BUILD__: {
  /** Short id of the commit it was built from, or "dev" where that is not known. */
  commit: string;
  /** When it was built, as an ISO timestamp. */
  time: string;
};
