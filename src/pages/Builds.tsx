import { useLiveQuery } from 'dexie-react-hooks';
import { Blocks, Sparkles } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { Button, EmptyState, PageHeader } from '../components/ui.tsx';
import { db } from '../lib/db.ts';

export function BuildsPage() {
  const builds = useLiveQuery(() => db.builds.orderBy('createdAt').reverse().toArray(), []);
  const navigate = useNavigate();
  if (!builds) return null;

  return (
    <>
      <PageHeader
        title="Builds"
        subtitle={builds.length ? `${builds.length} design${builds.length === 1 ? '' : 's'} made from your bricks` : undefined}
        action={
          builds.length > 0 && (
            <Button variant="primary" onClick={() => navigate('/create')}>
              <Sparkles className="size-5" /> <span className="hidden xs:inline">New design</span>
            </Button>
          )
        }
      />
      {builds.length === 0 ? (
        <EmptyState
          icon={<Blocks className="size-8" />}
          title="No builds yet"
          body="Describe something you would like to make and it will be designed from the pieces in your collection, with instructions to follow."
          action={
            <Button variant="accent" onClick={() => navigate('/create')}>
              <Sparkles className="size-5" /> Design a build
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 xs:grid-cols-2 lg:grid-cols-3">
          {builds.map((build) => (
            <Link key={build.id} to={`/builds/${build.id}`} className="card group overflow-hidden transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-card">
              <div className="relative flex aspect-[4/3] items-center justify-center bg-paper">
                {build.cover ? (
                  <img src={build.cover} alt="" className="size-full object-contain p-3 transition-transform duration-300 group-hover:scale-105" />
                ) : (
                  <Blocks className="size-10 text-callout-line" />
                )}
                {build.step > 0 && (
                  <span className="absolute left-3 top-3 rounded-full bg-[#15171c] px-2.5 py-1 text-xs font-bold text-white">In progress</span>
                )}
              </div>
              <div className="p-4">
                <h2 className="truncate text-xl font-semibold">{build.name}</h2>
                <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-ink-2">{build.description}</p>
                <p className="mt-3 text-sm font-semibold text-ink-3">
                  {build.parts.length} pieces · {new Date(build.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
