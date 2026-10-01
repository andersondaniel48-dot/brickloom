import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, Blocks, Package, PackageOpen, ScanLine, Settings, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { PartThumb } from '../components/PartThumb.tsx';
import { Button, ColorDot, Logo, toast } from '../components/ui.tsx';
import { useCatalog } from '../lib/catalog.ts';
import { addPieces, db } from '../lib/db.ts';
import { rowName, useInventory, useStats } from '../lib/inventory.ts';
import { STARTER_COLLECTION } from '../lib/starter.ts';

export function HomePage() {
  const catalog = useCatalog();
  const rows = useInventory();
  const stats = useStats(rows, catalog);
  const builds = useLiveQuery(() => db.builds.orderBy('createdAt').reverse().limit(4).toArray(), []);
  const navigate = useNavigate();
  const [loadingStarter, setLoadingStarter] = useState(false);

  if (!rows) return null;

  const loadStarter = async () => {
    setLoadingStarter(true);
    await addPieces(STARTER_COLLECTION);
    toast(`Added ${STARTER_COLLECTION.reduce((n, p) => n + p.qty, 0)} sample pieces`);
    setLoadingStarter(false);
  };

  const mobileHeader = (
    <div className="mb-5 flex items-center justify-between lg:hidden">
      <div className="flex items-center gap-2.5">
        <Logo size={34} />
        <span className="font-display text-xl font-bold">Brickloom</span>
      </div>
      <Link to="/settings" aria-label="Settings" className="flex size-10 items-center justify-center rounded-full text-ink-2 hover:bg-ink/5">
        <Settings className="size-5" />
      </Link>
    </div>
  );

  if (rows.length === 0) {
    return (
      <>
        {mobileHeader}
        <section className="relative overflow-hidden rounded-[32px] bg-[#15171c] px-6 py-12 text-[#f4f1ea] sm:px-12 sm:py-16">
          <div className="studs pointer-events-none absolute inset-0 opacity-60 [--stud:rgba(255,255,255,0.07)]" />
          <div className="relative max-w-xl">
            <span className="inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1 text-sm font-semibold text-accent-ink">
              <Sparkles className="size-4" /> Welcome
            </span>
            <h1 className="mt-5 text-[40px] font-bold leading-[1.05] sm:text-6xl">Every brick you own, ready to become something new.</h1>
            <p className="mt-5 text-lg leading-relaxed text-white/70">
              Photograph a handful of pieces and Brickloom names and counts them. Then describe a model and get step-by-step instructions built only from what is in your collection.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button variant="accent" size="lg" onClick={() => navigate('/scan')}>
                <ScanLine className="size-5" /> Scan your first bricks
              </Button>
              <Button size="lg" className="border-white/15 bg-white/10 text-white hover:border-white/30" disabled={loadingStarter} onClick={loadStarter}>
                <PackageOpen className="size-5" /> Try a sample collection
              </Button>
            </div>
            <button
              type="button"
              onClick={() => navigate('/collection?add=sets')}
              className="mt-5 inline-flex items-center gap-2 text-[15px] font-semibold text-white/75 underline decoration-white/30 underline-offset-4 hover:text-white"
            >
              <Package className="size-4" /> Own a set? Add all of its pieces at once
            </button>
          </div>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-3">
          {[
            { n: '1', title: 'Scan', body: 'Lay pieces on a plain surface and take one photo, or add a whole set by its number.', color: 'var(--red)' },
            { n: '2', title: 'Sort', body: 'Browse your collection by type, color or shape. Search across every part ever made.', color: 'var(--blue)' },
            { n: '3', title: 'Build', body: 'Ask for anything. The designer uses only bricks you have and draws instructions to follow.', color: 'var(--green)' },
          ].map((step) => (
            <div key={step.n} className="card p-6">
              <span className="flex size-10 items-center justify-center rounded-full font-display text-lg font-bold text-white" style={{ background: step.color }}>
                {step.n}
              </span>
              <h3 className="mt-4 text-xl font-semibold">{step.title}</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">{step.body}</p>
            </div>
          ))}
        </section>
      </>
    );
  }

  const recent = rows
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8);

  return (
    <>
      {mobileHeader}

      {/* Collection at a glance */}
      <section className="relative overflow-hidden rounded-[32px] bg-[#15171c] p-6 text-[#f4f1ea] sm:p-9">
        <div className="studs pointer-events-none absolute inset-0 opacity-60 [--stud:rgba(255,255,255,0.07)]" />
        <div className="relative">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-white/55">Your collection</p>
          <div className="mt-2 flex flex-wrap items-end gap-x-10 gap-y-4">
            <div>
              <div className="tabular font-display text-[64px] font-bold leading-none sm:text-[88px]">{stats.pieces.toLocaleString()}</div>
              <div className="mt-1 text-lg text-white/70">pieces</div>
            </div>
            <dl className="flex gap-8 pb-1.5">
              {[
                ['Different parts', stats.parts],
                ['Colors', stats.colors],
                ['Ready to build', stats.buildable],
              ].map(([label, value]) => (
                <div key={label}>
                  <dd className="tabular font-display text-3xl font-semibold">{value.toLocaleString()}</dd>
                  <dt className="text-sm text-white/60">{label}</dt>
                </div>
              ))}
            </dl>
          </div>

          {/* Color spectrum: one segment per color, sized by piece count */}
          <div className="mt-7 flex h-4 gap-[3px] overflow-hidden rounded-full">
            {stats.byColor.map(({ color, qty }) => (
              <div
                key={color}
                title={`${catalog.color(color).name}: ${qty}`}
                className="h-full min-w-1 first:rounded-l-full last:rounded-r-full"
                style={{ flexGrow: qty, background: `#${catalog.color(color).rgb}`, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)' }}
              />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-white/70">
            {stats.byColor.slice(0, 6).map(({ color, qty }) => (
              <span key={color} className="inline-flex items-center gap-1.5">
                <ColorDot color={catalog.color(color)} size={12} />
                {catalog.color(color).name} <span className="tabular text-white/45">{qty}</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Primary actions */}
      <section className="mt-4 grid gap-4 sm:grid-cols-2">
        <Link to="/scan" className="group card relative flex items-center gap-5 overflow-hidden bg-accent p-6 text-accent-ink transition-transform active:scale-[0.99]" style={{ background: 'var(--accent)', borderColor: 'transparent' }}>
          <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-accent-ink text-accent">
            <ScanLine className="size-7" strokeWidth={2.3} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-2xl font-bold">Scan bricks</span>
            <span className="block text-[15px] opacity-75">One photo, many pieces</span>
          </span>
          <ArrowRight className="size-6 transition-transform group-hover:translate-x-1" />
        </Link>
        <Link to="/create" className="group card flex items-center gap-5 p-6 transition-transform active:scale-[0.99]">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-ink text-bg">
            <Sparkles className="size-7" strokeWidth={2.3} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-2xl font-bold">Design a build</span>
            <span className="block text-[15px] text-ink-2">From the bricks you own</span>
          </span>
          <ArrowRight className="size-6 text-ink-3 transition-transform group-hover:translate-x-1" />
        </Link>
      </section>

      {/* Builds */}
      {builds && builds.length > 0 && (
        <section className="mt-9">
          <SectionHeader title="Your builds" to="/builds" />
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {builds.map((build) => (
              <Link key={build.id} to={`/builds/${build.id}`} className="card group overflow-hidden transition-shadow hover:shadow-card">
                <div className="flex aspect-[4/3] items-center justify-center bg-paper">
                  {build.cover ? <img src={build.cover} alt="" className="size-full object-contain p-2 transition-transform duration-300 group-hover:scale-105" /> : <Blocks className="size-8 text-callout-line" />}
                </div>
                <div className="p-3.5">
                  <div className="truncate font-display font-semibold">{build.name}</div>
                  <div className="text-sm text-ink-3">{build.parts.length} pieces</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Recently added */}
      <section className="mt-9">
        <SectionHeader title="Recently added" to="/collection" />
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 md:grid-cols-8">
          {recent.map((row) => (
            <Link key={row.key} to="/collection" title={rowName(row, catalog)} className="card studs-fine relative aspect-square p-2 transition-transform hover:-translate-y-0.5">
              <PartThumb part={row.part} color={row.color} image={row.image} className="size-full" />
              <span className="tabular absolute bottom-1.5 right-1.5 rounded-full bg-ink px-1.5 text-[11px] font-bold leading-5 text-bg">{row.qty}</span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}

function SectionHeader({ title, to }: { title: string; to: string }) {
  return (
    <div className="mb-3.5 flex items-center justify-between">
      <h2 className="text-2xl font-semibold">{title}</h2>
      <Link to={to} className="inline-flex items-center gap-1 text-sm font-semibold text-ink-2 hover:text-ink">
        See all <ArrowRight className="size-4" />
      </Link>
    </div>
  );
}
