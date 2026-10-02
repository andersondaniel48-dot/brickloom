import assert from 'node:assert/strict';
import { test } from 'node:test';
import { abilitiesOf, tuningFor } from '../src/lib/claude-designer.ts';

const yes = { supported: true };
const no = { supported: false };

/** What the Models API says about a model, cut down to the parts that matter here. */
function info(id: string, options: { adaptive: boolean; effort: boolean; fallbacks?: string[]; maxTokens: number }) {
  return {
    id,
    max_tokens: options.maxTokens,
    allowed_fallback_models: options.fallbacks ?? [],
    capabilities: {
      batch: yes,
      citations: yes,
      code_execution: yes,
      compaction: null,
      context_management: { supported: false, clear_thinking_20251015: null, clear_tool_uses_20250919: null, compact_20260112: null },
      effort: { supported: options.effort, low: yes, medium: yes, high: options.effort ? yes : no, max: no, xhigh: null },
      image_input: yes,
      pdf_input: yes,
      structured_outputs: yes,
      thinking: { supported: true, types: { adaptive: options.adaptive ? yes : no, enabled: yes } },
    },
  };
}

test('a current model thinks for itself, at high effort, and may fall back', () => {
  const tuning = tuningFor(abilitiesOf(info('claude-opus-5-5', { adaptive: true, effort: true, fallbacks: ['claude-sonnet-5-5'], maxTokens: 128000 })));
  assert.deepEqual(tuning.thinking, { type: 'adaptive', display: 'summarized' });
  assert.deepEqual(tuning.output_config, { effort: 'high' });
  assert.equal(tuning.fallbacks, 'default');
  assert.deepEqual(tuning.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(tuning.max_tokens, 64000);
});

test('a model without those is not asked for them', () => {
  const tuning = tuningFor(abilitiesOf(info('claude-haiku-4-5-20251001', { adaptive: false, effort: false, maxTokens: 64000 })));
  assert.equal(tuning.thinking.type, 'enabled');
  if (tuning.thinking.type === 'enabled') {
    assert.ok(tuning.thinking.budget_tokens >= 1024, 'the API wants a thinking budget of at least 1024 tokens');
    assert.ok(tuning.thinking.budget_tokens < tuning.max_tokens, 'the thinking budget must leave room for the answer');
  }
  assert.ok(!('output_config' in tuning));
  assert.ok(!('fallbacks' in tuning) && !('betas' in tuning));
});

test('the answer is never asked to be longer than the model can write', () => {
  const tuning = tuningFor(abilitiesOf(info('claude-small', { adaptive: false, effort: false, maxTokens: 32000 })));
  assert.equal(tuning.max_tokens, 32000);
  if (tuning.thinking.type === 'enabled') assert.ok(tuning.thinking.budget_tokens < 32000);
});

test('when a model says nothing about itself, the documentation is taken at its word', () => {
  const bare = { capabilities: null, allowed_fallback_models: null, max_tokens: null };
  assert.equal(tuningFor(abilitiesOf({ id: 'claude-sonnet-5-5', ...bare })).thinking.type, 'adaptive');
  assert.equal(tuningFor(abilitiesOf({ id: 'claude-haiku-4-5-20251001', ...bare })).thinking.type, 'enabled');
  assert.ok(!('fallbacks' in tuningFor(abilitiesOf({ id: 'claude-opus-5-5', ...bare }))));
});
