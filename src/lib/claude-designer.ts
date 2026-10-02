// The AI designer, with Claude doing the designing.
// Runs in the browser and calls the Anthropic API directly with the key the builder entered in
// Settings, so the app needs no server of its own. The key is the builder's own and stays on
// their device; that is what makes `dangerouslyAllowBrowser` acceptable here.
import Anthropic from '@anthropic-ai/sdk';
import type { DesignCatalog, DesignEvent, DesignRequest } from '../../shared/design.ts';
import { DesignSession, SUBMIT_TOOL, SYSTEM, resilientTurn, sentenceFeed } from './design-core.ts';

const TOOL: Anthropic.Beta.BetaTool = {
  name: SUBMIT_TOOL.name,
  description: SUBMIT_TOOL.description,
  eager_input_streaming: true,
  input_schema: SUBMIT_TOOL.parameters,
};

/** What a model can be asked for. Claude models differ, and asking one for something it lacks is an error. */
export interface Abilities {
  /** Decides for itself how much to think, rather than being given a budget. */
  adaptiveThinking: boolean;
  /** Takes an effort setting. */
  effort: boolean;
  /** Can hand a request it declines on policy grounds to a substitute model. */
  fallbacks: boolean;
  /** The most it can write in one answer, in tokens. */
  maxTokens: number;
}

/** For when the model cannot be asked about itself: what the documentation says of each family. */
function assumedAbilities(model: string): Abilities {
  const older = /haiku-4|sonnet-4-5|opus-4-5/.test(model);
  return { adaptiveThinking: !older, effort: !older, fallbacks: false, maxTokens: older ? 64000 : 128000 };
}

/** Reads a model's abilities from what the Models API says about it. */
export function abilitiesOf(info: Pick<Anthropic.Beta.BetaModelInfo, 'id' | 'capabilities' | 'allowed_fallback_models' | 'max_tokens'>): Abilities {
  const assumed = assumedAbilities(info.id);
  const caps = info.capabilities;
  return {
    adaptiveThinking: caps ? caps.thinking.types.adaptive.supported : assumed.adaptiveThinking,
    effort: caps ? caps.effort.supported && caps.effort.high.supported : assumed.effort,
    fallbacks: Boolean(info.allowed_fallback_models?.length),
    maxTokens: info.max_tokens ?? assumed.maxTokens,
  };
}

/** The part of a request that depends on the model: how long an answer, how to think, how hard to try. */
export function tuningFor(abilities: Abilities) {
  const max_tokens = Math.min(64000, abilities.maxTokens);
  return {
    max_tokens,
    thinking: abilities.adaptiveThinking
      ? ({ type: 'adaptive', display: 'summarized' } as const)
      : // A fixed allowance for thinking, leaving most of the answer for the build itself.
        ({ type: 'enabled', budget_tokens: Math.min(24000, Math.floor(max_tokens * 0.4)), display: 'summarized' } as const),
    ...(abilities.effort ? { output_config: { effort: 'high' as const } } : {}),
    ...(abilities.fallbacks ? { betas: ['server-side-fallback-2026-07-01' as const], fallbacks: 'default' as const } : {}),
  };
}

const known = new Map<string, Abilities>();

async function abilities(client: Anthropic, model: string, signal?: AbortSignal): Promise<Abilities> {
  const cached = known.get(model);
  if (cached) return cached;
  let found: Abilities;
  try {
    found = abilitiesOf(await client.beta.models.retrieve(model, undefined, { signal }));
    known.set(model, found);
  } catch (err) {
    // A rejected key, or a model this key may not use, will fail the design too: say so now.
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError || err instanceof Anthropic.NotFoundError || signal?.aborted) throw err;
    found = assumedAbilities(model);
  }
  return found;
}

/** Runs the design conversation, emitting progress as it goes. */
export async function designWithClaude(
  request: DesignRequest,
  catalog: DesignCatalog,
  emit: (event: DesignEvent) => void,
  options: { apiKey: string; model: string; signal?: AbortSignal },
): Promise<void> {
  const session = new DesignSession(request, catalog, emit);
  if (!session.ready()) return;

  emit({ type: 'status', message: 'Studying your collection' });

  const client = new Anthropic({ apiKey: options.apiKey, dangerouslyAllowBrowser: true });
  const tuning = tuningFor(await abilities(client, options.model, options.signal));
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: session.brief() }];
  let jsonRetries = 0;

  while (true) {
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await resilientTurn(
        (signal, alive) => {
          const stream = client.beta.messages.stream(
            {
              model: options.model,
              ...tuning,
              cache_control: { type: 'ephemeral' },
              system: SYSTEM,
              tools: [TOOL],
              messages,
            },
            { signal },
          );
          stream.on('thinking', sentenceFeed(emit));
          stream.on('streamEvent', alive);
          return stream.finalMessage();
        },
        { signal: options.signal, emit, lostConnection: (err) => err instanceof Anthropic.APIConnectionError },
      );
      jsonRetries = 0;
    } catch (err) {
      // With eager input streaming a tool input that is not parseable JSON rejects here; re-issue the turn.
      // (So does a connection that breaks in the middle of an answer; the next attempt then finds it gone and waits.)
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
export function describeError(err: unknown, model: string): string {
  if (err instanceof Anthropic.AuthenticationError) return 'The Anthropic API key was rejected. Check the key in Settings.';
  if (err instanceof Anthropic.PermissionDeniedError || err instanceof Anthropic.NotFoundError) return `This API key cannot use the model ${model}. Choose another model in Settings.`;
  if (err instanceof Anthropic.RateLimitError) return 'The designer is rate limited right now. Wait a moment and try again.';
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API. Check your internet connection.';
  if (err instanceof Anthropic.APIError) return `The designer hit an API error (${err.status ?? 'unknown'}). Please try again.`;
  return err instanceof Error ? err.message : 'Something went wrong while designing.';
}
