// The AI designer, with Claude doing the designing.
// Runs in the browser and calls the Anthropic API directly with the key the builder entered in
// Settings, so the app needs no server of its own. The key is the builder's own and stays on
// their device; that is what makes `dangerouslyAllowBrowser` acceptable here.
import Anthropic from '@anthropic-ai/sdk';
import type { DesignCatalog, DesignEvent, DesignRequest } from '../../shared/design.ts';
import { DesignSession, SUBMIT_TOOL, SYSTEM, sentenceFeed } from './design-core.ts';

const MODEL = 'claude-opus-5-5';

const TOOL: Anthropic.Beta.BetaTool = {
  name: SUBMIT_TOOL.name,
  description: SUBMIT_TOOL.description,
  eager_input_streaming: true,
  input_schema: SUBMIT_TOOL.parameters,
};

/** Runs the design conversation, emitting progress as it goes. */
export async function designWithClaude(
  request: DesignRequest,
  catalog: DesignCatalog,
  emit: (event: DesignEvent) => void,
  options: { apiKey: string; signal?: AbortSignal },
): Promise<void> {
  const session = new DesignSession(request, catalog, emit);
  if (!session.ready()) return;

  const client = new Anthropic({ apiKey: options.apiKey, dangerouslyAllowBrowser: true });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: session.brief() }];
  let jsonRetries = 0;

  emit({ type: 'status', message: 'Studying your collection' });

  while (true) {
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 64000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: { effort: 'high' },
        cache_control: { type: 'ephemeral' },
        system: SYSTEM,
        tools: [TOOL],
        messages,
      },
      { signal: options.signal },
    );
    stream.on('thinking', sentenceFeed(emit));

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      // With eager input streaming a tool input that is not parseable JSON rejects here; re-issue the turn.
      if (err instanceof Anthropic.APIError || options.signal?.aborted || jsonRetries++ >= 2) throw err;
      continue;
    }

    if (message.stop_reason === 'refusal') {
      emit({ type: 'error', message: 'The designer declined this request. Try describing the model differently.' });
      return;
    }

    const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    // A tool input cut off at max_tokens can parse as a valid partial object, so never run it.
    if (!toolUses.length || message.stop_reason === 'max_tokens') break;

    messages.push({ role: 'assistant', content: message.content });
    messages.push({
      role: 'user',
      content: toolUses.map((use): Anthropic.Beta.BetaToolResultBlockParam => {
        const reply = session.call(use.name, use.input);
        return { type: 'tool_result', tool_use_id: use.id, content: reply.text, ...(reply.error ? { is_error: true } : {}) };
      }),
    });
  }

  session.finish('claude');
}

/** Turns an SDK failure into a message a builder can act on. */
export function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'The Anthropic API key was rejected. Check the key in Settings.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'This API key is not allowed to use the designer model.';
  if (err instanceof Anthropic.RateLimitError) return 'The designer is rate limited right now. Wait a moment and try again.';
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API. Check your internet connection.';
  if (err instanceof Anthropic.APIError) return `The designer hit an API error (${err.status ?? 'unknown'}). Please try again.`;
  return err instanceof Error ? err.message : 'Something went wrong while designing.';
}
