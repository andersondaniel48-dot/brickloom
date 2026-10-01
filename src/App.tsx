import { useEffect } from 'react';
import { Route, Routes } from 'react-router';
import { Shell } from './components/Shell.tsx';
import { Button, Logo, Toasts } from './components/ui.tsx';
import { useCatalogStore } from './lib/catalog.ts';
import { initLDraw } from './lib/ldraw.ts';
import { applyTheme, useSettings } from './lib/settings.ts';
import { BuildPage } from './pages/Build.tsx';
import { BuildsPage } from './pages/Builds.tsx';
import { CollectionPage } from './pages/Collection.tsx';
import { CreatePage } from './pages/Create.tsx';
import { HomePage } from './pages/Home.tsx';
import { InstructionsPage } from './pages/Instructions.tsx';
import { ScanPage } from './pages/Scan.tsx';
import { SettingsPage } from './pages/Settings.tsx';

export function App() {
  const { catalog, error, load } = useCatalogStore();
  const theme = useSettings((s) => s.theme);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    if (catalog) void initLDraw(catalog.colorList);
  }, [catalog]);

  if (!catalog) {
    return (
      <div className="studs flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
        <div className={error ? '' : 'animate-bounce'}>
          <Logo size={72} />
        </div>
        {error ? (
          <>
            <div>
              <h1 className="text-2xl font-semibold">The part catalog could not be loaded</h1>
              <p className="mt-2 max-w-md text-ink-2">
                Run <code className="rounded-md bg-ink/8 px-1.5 py-0.5 text-sm">npm run data</code> once to download and build it, then reload.
              </p>
              <p className="mt-2 text-sm text-ink-3">{error}</p>
            </div>
            <Button variant="primary" onClick={() => location.reload()}>
              Reload
            </Button>
          </>
        ) : (
          <p className="font-display text-lg text-ink-2">Opening the brick catalog</p>
        )}
      </div>
    );
  }

  return (
    <>
      <Routes>
        <Route path="/builds/:id/steps" element={<InstructionsPage />} />
        <Route element={<Shell />}>
          <Route index element={<HomePage />} />
          <Route path="collection" element={<CollectionPage />} />
          <Route path="scan" element={<ScanPage />} />
          <Route path="create" element={<CreatePage />} />
          <Route path="builds" element={<BuildsPage />} />
          <Route path="builds/:id" element={<BuildPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
      <Toasts />
    </>
  );
}
