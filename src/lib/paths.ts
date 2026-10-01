/**
 * URL of a file that ships with the app (the catalog, part geometry, set inventories).
 * The app may be served from a sub-path, as on GitHub Pages (`/<repository>/`), so these are never
 * written as bare absolute paths.
 */
export const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;
