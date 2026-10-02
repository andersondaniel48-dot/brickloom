import { Sparkles } from 'lucide-react';
import { VERSION } from '../../shared/changelog.ts';
import { useWhatsNew } from '../lib/whats-new.ts';
import { Button, Sheet } from './ui.tsx';

/** A date written as YYYY-MM-DD, the way people write dates where the app is being used. */
export const formatDay = (date: string) => new Date(`${date.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

/** Release notes: shown unasked after an update, and on request from Settings. */
export function WhatsNew() {
  const { releases, news, close } = useWhatsNew();

  return (
    <Sheet
      open={Boolean(releases)}
      onClose={close}
      title={news ? 'What\'s new' : 'Release notes'}
      footer={
        <Button variant="accent" size="lg" className="w-full" onClick={close}>
          Got it
        </Button>
      }
    >
      {news && (
        <p className="mb-5 flex items-start gap-3 rounded-2xl bg-accent/15 p-3.5 text-[15px] leading-snug">
          <Sparkles className="mt-0.5 size-5 shrink-0" />
          <span>
            Brickloom has updated itself to <span className="font-semibold">version {VERSION}</span>. Here is what changed.
          </span>
        </p>
      )}
      <ol className="flex flex-col gap-6">
        {releases?.map((release) => (
          <li key={release.version}>
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="tabular rounded-full bg-ink px-2.5 py-0.5 text-xs font-bold text-bg">{release.version}</span>
              <h3 className="text-[17px] font-semibold">{release.title}</h3>
            </div>
            <p className="mt-1 text-sm text-ink-3">{formatDay(release.date)}</p>
            <ul className="mt-2.5 flex flex-col gap-2 text-[15px] leading-snug text-ink-2">
              {release.changes.map((change) => (
                <li key={change} className="flex gap-2.5">
                  <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" />
                  <span>{change}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </Sheet>
  );
}
