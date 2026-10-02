// Entry point for designing a build: an AI model when the builder has entered an API key for one,
// otherwise the small offline quick-builder. Everything runs on the device; there is no app server.
import type { DesignEvent, DesignRequest } from '../../shared/design.ts';
import { quickBuild } from '../../shared/quick.ts';
import type { Catalog } from './catalog.ts';
import type { Designer } from './settings.ts';

export type { DesignEvent, DesignResult, DesignSize } from '../../shared/design.ts';

export async function runDesign(
  request: DesignRequest,
  catalog: Catalog,
  options: { designer: Designer; signal: AbortSignal; onEvent: (event: DesignEvent) => void },
): Promise<void> {
  const { designer, signal, onEvent } = options;
  const designCatalog = await catalog.forDesign();

  if (!designer) {
    onEvent({ type: 'status', message: 'Quick-building from your bricks' });
    const design = quickBuild(request, designCatalog);
    onEvent(
      design
        ? { type: 'done', design }
        : { type: 'error', message: 'There are not enough plain bricks in your collection to build with yet. Add a few more.' },
    );
    return;
  }

  // Each company's SDK is only needed for its own designer, so it is loaded on first use rather than with the app.
  let describe: (err: unknown) => string | Promise<string> = () => 'Something went wrong while designing.';
  try {
    if (designer.provider === 'openai') {
      const { designWithOpenAI, describeError } = await import('./openai-designer.ts');
      describe = (err) => describeError(err, designer.apiKey, designer.model);
      await designWithOpenAI(request, designCatalog, onEvent, { apiKey: designer.apiKey, model: designer.model, signal });
    } else {
      const { designWithClaude, describeError } = await import('./claude-designer.ts');
      describe = (err) => describeError(err, designer.model);
      await designWithClaude(request, designCatalog, onEvent, { apiKey: designer.apiKey, model: designer.model, signal });
    }
  } catch (err) {
    if (signal.aborted) return;
    console.error('design failed:', err);
    const message = await describe(err);
    if (!signal.aborted) onEvent({ type: 'error', message });
  }
}
