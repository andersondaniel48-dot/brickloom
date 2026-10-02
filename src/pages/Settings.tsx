import { Check, Download, KeyRound, Monitor, Moon, PackageOpen, ScrollText, Share, Smartphone, Sun, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { VERSION } from '../../shared/changelog.ts';
import { AccountSection } from '../components/Account.tsx';
import { Button, PageHeader, Segmented, toast } from '../components/ui.tsx';
import { formatDay } from '../components/WhatsNew.tsx';
import { useCatalog } from '../lib/catalog.ts';
import { accountsEnabled, useAccount } from '../lib/cloud/index.ts';
import { addPieces, db, type NewPiece } from '../lib/db.ts';
import { isIOS, useInstall } from '../lib/install.ts';
import { useInventory, useStats } from '../lib/inventory.ts';
import { asset } from '../lib/paths.ts';
import { OPENAI_MODELS, designerFor, useSettings, type Provider, type Theme } from '../lib/settings.ts';
import { STARTER_COLLECTION } from '../lib/starter.ts';
import { useWhatsNew } from '../lib/whats-new.ts';

export function SettingsPage() {
  const catalog = useCatalog();
  const rows = useInventory();
  const stats = useStats(rows, catalog);
  const { theme, setTheme } = useSettings();
  const { available, installed, install } = useInstall();
  const signedIn = useAccount((s) => Boolean(s.user));
  const fileRef = useRef<HTMLInputElement>(null);
  const showReleaseNotes = useWhatsNew((s) => s.open);

  // When the part catalog this copy of the app is using was put together.
  const [catalogDate, setCatalogDate] = useState<string | null>(null);
  useEffect(() => {
    fetch(asset('catalog/meta.json'))
      .then((res) => res.json() as Promise<{ builtAt?: string }>)
      .then((meta) => setCatalogDate(meta.builtAt ?? null))
      .catch(() => undefined);
  }, []);

  const exportCollection = () => {
    const data = { app: 'brickloom', version: 1, exportedAt: new Date().toISOString(), pieces: (rows ?? []).map(({ part, color, qty, name, image }) => ({ part, color, qty, name, image })) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `brickloom-collection-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importCollection = async (file: File | undefined) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as { pieces?: NewPiece[] };
      const pieces = (data.pieces ?? []).filter((p) => typeof p.part === 'string' && Number.isInteger(p.color) && Number.isInteger(p.qty) && p.qty > 0);
      if (!pieces.length) throw new Error('empty');
      await addPieces(pieces);
      toast(`Imported ${pieces.reduce((n, p) => n + p.qty, 0)} pieces`);
    } catch {
      toast('That file is not a Brickloom collection', 'error');
    }
  };

  const clearCollection = async () => {
    if (!confirm(`Remove all ${stats.pieces} pieces from your collection? Your builds are kept. This cannot be undone.`)) return;
    await db.transaction('rw', db.inventory, db.sets, () => Promise.all([db.inventory.clear(), db.sets.clear()]));
    toast('Collection cleared');
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Settings" />

      <AccountSection />

      <Section title="Appearance">
        <Segmented<Theme>
          className="w-full"
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'system', label: <Label icon={<Monitor className="size-4" />}>Auto</Label> },
            { value: 'light', label: <Label icon={<Sun className="size-4" />}>Light</Label> },
            { value: 'dark', label: <Label icon={<Moon className="size-4" />}>Dark</Label> },
          ]}
        />
      </Section>

      <Section title="Install on this device" description="Put Brickloom on your home screen so it opens full screen like any other app.">
        {installed ? (
          <p className="flex items-center gap-2.5 text-[15px] font-semibold">
            <span className="flex size-5 items-center justify-center rounded-full bg-brick-green text-white">
              <Check className="size-3.5" strokeWidth={3.5} />
            </span>
            Brickloom is installed here.
          </p>
        ) : available ? (
          <Button variant="accent" onClick={() => void install()}>
            <Smartphone className="size-4" /> Install Brickloom
          </Button>
        ) : isIOS() ? (
          <p className="flex items-start gap-2.5 text-[15px] leading-relaxed text-ink-2">
            <Share className="mt-0.5 size-5 shrink-0 text-ink" />
            <span>
              In Safari, tap the <span className="font-semibold text-ink">Share</span> button, then <span className="font-semibold text-ink">Add to Home Screen</span>.
            </span>
          </p>
        ) : (
          <p className="text-[15px] leading-relaxed text-ink-2">
            {window.isSecureContext
              ? 'Open your browser\'s menu and choose Install app or Add to Home screen.'
              : 'This address is not secure (https), so the browser will not offer to install the app. See the README for how to publish it.'}
          </p>
        )}
      </Section>

      <DesignerSection />

      <Section title="Your collection" description={`${stats.pieces.toLocaleString()} pieces, ${signedIn ? 'stored on this device and saved to your account' : 'stored only on this device'}.`}>
        <div className="flex flex-wrap gap-2.5">
          <Button onClick={exportCollection} disabled={!rows?.length}>
            <Download className="size-4" /> Export
          </Button>
          <Button onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" /> Import
          </Button>
          <Button
            onClick={async () => {
              await addPieces(STARTER_COLLECTION);
              toast('Sample collection added');
            }}
          >
            <PackageOpen className="size-4" /> Add sample pieces
          </Button>
          <Button variant="danger" onClick={clearCollection} disabled={!rows?.length}>
            <Trash2 className="size-4" /> Clear collection
          </Button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => (void importCollection(e.target.files?.[0]), (e.target.value = ''))} />
        </div>
      </Section>

      <Section title="About">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[15px]">
            <dt className="text-ink-2">Version</dt>
            <dd className="tabular font-semibold">{VERSION}</dd>
            <dt className="text-ink-2">Build</dt>
            <dd className="tabular">
              <span className="font-mono text-sm">{__BUILD__.commit}</span>
              <span className="text-ink-3"> · {formatDay(__BUILD__.time)}</span>
            </dd>
            <dt className="text-ink-2">Part catalog</dt>
            <dd className="tabular">{catalogDate ? formatDay(catalogDate) : '…'}</dd>
          </dl>
          <Button onClick={showReleaseNotes}>
            <ScrollText className="size-4" /> Release notes
          </Button>
        </div>
        <div className="space-y-2.5 text-[15px] leading-relaxed text-ink-2">
          <p>
            The catalog of {catalog.size.toLocaleString()} parts and {catalog.colorList.length} colors comes from{' '}
            <ExternalLink href="https://rebrickable.com">Rebrickable</ExternalLink>. 3D part geometry comes from the{' '}
            <ExternalLink href="https://www.ldraw.org">LDraw</ExternalLink> parts library (CC BY 4.0). Scanned pieces are identified by{' '}
            <ExternalLink href="https://brickognize.com">Brickognize</ExternalLink>, which receives a cropped photo of each piece.
            {accountsEnabled && ' If you sign in, your collection and builds are also stored in Google Firebase under your account, where only you can read them.'}
          </p>
          <p className="text-sm text-ink-3">LEGO® is a trademark of the LEGO Group, which does not sponsor, authorize or endorse this app.</p>
        </div>
      </Section>
    </div>
  );
}

const PROVIDERS: Record<Provider, { name: string; company: string; placeholder: string; keysUrl: string; keysAt: string }> = {
  claude: { name: 'Claude', company: 'Anthropic', placeholder: 'sk-ant-...', keysUrl: 'https://console.anthropic.com/settings/keys', keysAt: 'console.anthropic.com' },
  openai: { name: 'ChatGPT', company: 'OpenAI', placeholder: 'sk-...', keysUrl: 'https://platform.openai.com/api-keys', keysAt: 'platform.openai.com' },
};

/** Which AI designs the builds, and the API key it needs. */
function DesignerSection() {
  const settings = useSettings();
  const { provider, setProvider, apiKey, setApiKey, openaiKey, setOpenaiKey, openaiModel, setOpenaiModel } = settings;
  const saved = provider === 'openai' ? openaiKey : apiKey;
  const save = provider === 'openai' ? setOpenaiKey : setApiKey;
  const [draft, setDraft] = useState(saved);
  // Each service has its own key: show the right one when switching between them.
  useEffect(() => setDraft(saved), [provider, saved]);
  const { name, company, placeholder, keysUrl, keysAt } = PROVIDERS[provider];
  const inUse = designerFor(settings);

  return (
    <Section
      title="AI designer"
      description="Designs are created by an AI model, which you connect with an API key of your own. A key is stored only in this browser on this device, and is sent only to the company that issued it, when you ask for a design."
    >
      <Segmented<Provider>
        className="mb-3 w-full"
        value={provider}
        onChange={setProvider}
        options={(['claude', 'openai'] as const).map((p) => ({
          value: p,
          label: (
            <Label icon={(p === 'openai' ? openaiKey : apiKey) ? <Check className="size-4 text-brick-green" strokeWidth={3} /> : null}>
              {PROVIDERS[p].name} <span className="font-normal text-ink-3">({PROVIDERS[p].company})</span>
            </Label>
          ),
        }))}
      />

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save(draft);
          toast(draft.trim() ? `${company} API key saved` : `${company} API key removed`);
        }}
      >
        <label className="relative min-w-0 flex-1">
          <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label={`${company} API key`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            className="h-11 w-full rounded-2xl border border-line bg-surface-2 pl-10 pr-4 font-mono text-sm outline-none placeholder:text-ink-3 focus:border-ink"
          />
        </label>
        <Button type="submit" variant="primary" disabled={draft.trim() === saved}>
          {saved && draft.trim() === saved ? (
            <>
              <Check className="size-4" strokeWidth={3} /> Saved
            </>
          ) : (
            'Save'
          )}
        </Button>
      </form>

      {provider === 'openai' && (
        <label className="mt-3 block">
          <span className="mb-1.5 block text-sm font-semibold">Model</span>
          <select
            value={openaiModel}
            onChange={(e) => setOpenaiModel(e.target.value)}
            className="h-11 w-full rounded-2xl border border-line bg-surface-2 px-3.5 text-[15px] outline-none focus:border-ink"
          >
            {OPENAI_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <span className="mt-1.5 block text-sm text-ink-3">{OPENAI_MODELS.find((m) => m.id === openaiModel)?.note}</span>
        </label>
      )}

      <div className="mt-3 space-y-2 text-sm leading-relaxed text-ink-3">
        <p>
          Keys come from <ExternalLink href={keysUrl}>{keysAt}</ExternalLink> and are paid for by use.{' '}
          {provider === 'openai'
            ? 'A ChatGPT Plus subscription does not include one: OpenAI bills its API separately, and a subscription cannot be connected to an app like this.'
            : 'A Claude subscription does not include one: Anthropic bills its API separately.'}
        </p>
        <p>
          {inUse
            ? `Builds are now designed by ${PROVIDERS[inUse.provider].name}${inUse.provider !== provider ? `, as there is no key for ${name} yet` : ''}.`
            : 'Without a key, the Create tab uses a simple offline builder.'}{' '}
          Each device needs its key entered once; use a key with a spending limit, since anyone with access to this device's browser can use it.
        </p>
      </div>
    </Section>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="card mb-4 p-5 sm:p-6">
      <h2 className="text-xl font-semibold">{title}</h2>
      {description && <p className="mt-1 text-[15px] leading-relaxed text-ink-2">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Label({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center justify-center gap-2">
      {icon}
      {children}
    </span>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="font-semibold text-ink underline decoration-ink/25 underline-offset-2 hover:decoration-ink">
      {children}
    </a>
  );
}
