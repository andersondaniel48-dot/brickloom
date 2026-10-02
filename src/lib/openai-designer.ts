// The AI designer, with one of OpenAI's GPT models doing the designing.
// Runs in the browser and calls the OpenAI API directly with the key the builder entered in
// Settings, so the app needs no server of its own. The key is the builder's own and stays on
// their device; that is what makes `dangerouslyAllowBrowser` acceptable here.
//
// The key is an API key from platform.openai.com, billed by use. A ChatGPT subscription does not
// come with one: OpenAI sells the two separately, and offers no way for an app like this to draw
// on a subscription.
import OpenAI from 'openai';
import type { DesignCatalog, DesignEvent, DesignRequest } from '../../shared/design.ts';
import { DesignSession, SUBMIT_TOOL, SYSTEM, sentenceFeed } from './design-core.ts';

const TOOL: OpenAI.Responses.FunctionTool = {
  type: 'function',
  name: SUBMIT_TOOL.name,
  description: SUBMIT_TOOL.description,
  parameters: SUBMIT_TOOL.parameters,
  // Not strict: strict mode wants every property required, and most of a build's are optional.
  strict: false,
};

/** Runs the design conversation, emitting progress as it goes. */
export async function designWithOpenAI(
  request: DesignRequest,
  catalog: DesignCatalog,
  emit: (event: DesignEvent) => void,
  options: { apiKey: string; model: string; signal?: AbortSignal },
): Promise<void> {
  const session = new DesignSession(request, catalog, emit);
  if (!session.ready()) return;

  const client = new OpenAI({ apiKey: options.apiKey, dangerouslyAllowBrowser: true });
  // Each turn sends only what is new; the conversation so far is referred to by the id of the last response.
  let input: OpenAI.Responses.ResponseInput = [{ role: 'user', content: session.brief() }];
  let previous: string | undefined;
  let summaries = true;

  emit({ type: 'status', message: 'Studying your collection' });

  while (true) {
    const stream = client.responses.stream(
      {
        model: options.model,
        instructions: SYSTEM,
        input,
        previous_response_id: previous,
        tools: [TOOL],
        parallel_tool_calls: false,
        max_output_tokens: 64000,
        reasoning: { effort: 'high', ...(summaries ? { summary: 'auto' as const } : {}) },
      },
      { signal: options.signal },
    );
    const feed = sentenceFeed(emit);
    stream.on('response.reasoning_summary_text.delta', (event) => feed(event.delta));

    let response: OpenAI.Responses.Response;
    try {
      response = await stream.finalResponse();
    } catch (err) {
      // Summaries of the model's reasoning are only shown to organizations OpenAI has verified.
      // They are a nicety (something to read while waiting), so do without rather than fail.
      if (summaries && err instanceof OpenAI.BadRequestError && /summar|verif/i.test(err.message)) {
        summaries = false;
        continue;
      }
      throw err;
    }
    if (response.status === 'failed') throw new Error(response.error?.message ?? 'The model could not finish its answer.');

    const calls = response.output.filter((item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === 'function_call');
    if (!calls.length && response.output.some((item) => item.type === 'message' && item.content.some((part) => part.type === 'refusal'))) {
      emit({ type: 'error', message: 'The designer declined this request. Try describing the model differently.' });
      return;
    }
    // An answer cut off at the token limit may end in half a build, so never run it.
    if (!calls.length || response.status === 'incomplete') break;

    previous = response.id;
    input = calls.map((call) => {
      let reply;
      try {
        reply = session.call(call.name, JSON.parse(call.arguments));
      } catch {
        reply = { text: 'The arguments were not valid JSON. Submit the build again.', error: true };
      }
      return { type: 'function_call_output' as const, call_id: call.call_id, output: reply.text };
    });
  }

  session.finish('openai');
}

const KEY_REJECTED = 'The OpenAI API key was rejected. Check the key in Settings.';
const NO_CREDIT =
  'This OpenAI account has no API credit. API use is paid for separately from a ChatGPT subscription: add credit under Billing at platform.openai.com.';

/** Turns an SDK failure into a message a builder can act on. */
export async function describeError(err: unknown, apiKey: string, model: string): Promise<string> {
  const noModel = `This API key cannot use the model ${model}. Choose another model in Settings.`;
  if (err instanceof OpenAI.AuthenticationError) return KEY_REJECTED;
  // Out of money and out of rate look the same from the status code alone.
  if (err instanceof OpenAI.RateLimitError) return err.code === 'insufficient_quota' ? NO_CREDIT : 'The designer is rate limited right now. Wait a moment and try again.';
  if (err instanceof OpenAI.NotFoundError || err instanceof OpenAI.PermissionDeniedError) return noModel;
  if (err instanceof OpenAI.APIConnectionError) {
    // When OpenAI turns down a key, its answer lacks the headers a browser needs to read it, so a
    // rejected key looks exactly like no connection at all. Asking about the model instead gets
    // an answer that can be read, and tells the two apart.
    try {
      const res = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (res.status === 401) return KEY_REJECTED;
      if (res.status === 404 || res.status === 403) return noModel;
      if (res.ok) return 'OpenAI turned the request down without giving a reason this app can read. The usual cause is an account with no API credit, which is paid for separately from a ChatGPT subscription: check Billing at platform.openai.com.';
    } catch {
      // no answer to this either: there really is no connection
    }
    return 'Could not reach the OpenAI API. Check your internet connection.';
  }
  if (err instanceof OpenAI.APIError) return `The designer hit an API error (${err.status ?? 'unknown'}). Please try again.`;
  return err instanceof Error ? err.message : 'Something went wrong while designing.';
}
