// Entry point for designing a build: Claude when the builder has entered an API key, otherwise the
// small offline quick-builder. Everything runs on the device; there is no app server.
import type { DesignEvent, DesignRequest } from '../../shared/design.ts';
import { quickBuild } from '../../shared/quick.ts';
import type { Catalog } from './catalog.ts';

export type { DesignEvent, DesignResult, DesignSize } from '../../shared/design.ts';

export async function runDesign(
  request: DesignRequest,
  catalog: Catalog,
  options: { apiKey: string; signal: AbortSignal; onEvent: (event: DesignEvent) => void },
): Promise<void> {
  const { apiKey, signal, onEvent } = options;
  const designCatalog = await catalog.forDesign();

  if (!apiKey) {
    onEvent({ type: 'status', message: 'Quick-building from your bricks' });
    const design = quickBuild(request, designCatalog);
    onEvent(
      design
        ? { type: 'done', design }
        : { type: 'error', message: 'There are not enough plain bricks in your collection to build with yet. Add a few more.' },
    );
    return;
  }

  // The Anthropic SDK is only needed here, so it is loaded on first use rather than with the app.
  const { designWithClaude, describeError } = await import('./claude-designer.ts');
  try {
    await designWithClaude(request, designCatalog, onEvent, { apiKey, signal });
  } catch (err) {
    if (signal.aborted) return;
    console.error('design failed:', err);
    onEvent({ type: 'error', message: describeError(err) });
  }
}
