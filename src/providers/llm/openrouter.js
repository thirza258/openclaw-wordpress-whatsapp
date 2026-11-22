'use strict';

const BaseLLMProvider = require('./base');
const config = require('../../config');
const tokenTracker = require('../../utils/token-tracker');
const logger = require('../../utils/logger').child('OpenRouterLLM');

function isCreditOr402Error(status, errText) {
  if (status === 402) return true;
  if (!errText) return false;
  const lower = String(errText).toLowerCase();
  return (
    lower.includes('402') ||
    lower.includes('requires more credits') ||
    lower.includes('credit balance is too low') ||
    lower.includes('insufficient credits') ||
    lower.includes('payment required') ||
    lower.includes('openrouter_credits') ||
    lower.includes('can only afford')
  );
}

class OpenRouterLLMProvider extends BaseLLMProvider {
  constructor() {
    super('openrouter');
    this.apiKey = config.llm.openrouterApiKey;
    this.creditsDepleted = false;
  }

  getCandidateModels(preferredModel) {
    const pool = config.llm.freeModelsPool;
    if (this.creditsDepleted) {
      return pool;
    }
    const primary = preferredModel || config.llm.primaryModel;
    const primaryFree = primary.endsWith(':free') ? primary : `${primary}:free`;
    const otherFree = pool.filter((m) => m !== primary && m !== primaryFree);

    if (primary.endsWith(':free') || primary === 'openrouter/free') {
      return [primary, ...otherFree];
    }
    return [primary, primaryFree, ...otherFree];
  }

  async complete({ model, messages, temperature = 0.7, maxTokens = 2500, campaignId = null, jobId = null, timeoutMs = 60000 }) {
    const modelsToTry = this.getCandidateModels(model);
    let lastError = null;

    for (const candidateModel of modelsToTry) {
      const isFree = candidateModel.endsWith(':free') || candidateModel === 'openrouter/free';
      if (this.creditsDepleted && !isFree) continue;

      const startTime = Date.now();
      try {
        logger.debug(`Calling OpenRouter with model: ${candidateModel}...`);
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': config.wordpress.baseUrl || 'https://openclaw.internal',
            'X-Title': 'OpenClaw Marketing Platform',
          },
          body: JSON.stringify({
            model: candidateModel,
            messages,
            max_tokens: maxTokens,
            temperature,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!res.ok) {
          const errText = await res.text();
          if (isCreditOr402Error(res.status, errText)) {
            this.creditsDepleted = true;
            logger.warn(`OpenRouter 402 on ${candidateModel}, auto-switching to free models pool`);
          }
          throw new Error(`OpenRouter HTTP ${res.status}: ${errText}`);
        }

        const data = await res.json();
        if (data.error) {
          const msg = data.error.message || JSON.stringify(data.error);
          if (isCreditOr402Error(data.error.code, msg)) {
            this.creditsDepleted = true;
          }
          throw new Error(`OpenRouter API error: ${msg}`);
        }

        const choice = data.choices && data.choices[0];
        if (!choice || !choice.message || !choice.message.content) {
          throw new Error('Empty or invalid message content returned from OpenRouter');
        }

        const durationMs = Date.now() - startTime;
        const inputTokens = data.usage?.prompt_tokens || Math.ceil(JSON.stringify(messages).length / 4);
        const outputTokens = data.usage?.completion_tokens || Math.ceil(choice.message.content.length / 4);

        tokenTracker.recordUsage({
          campaignId,
          jobId,
          provider: 'openrouter',
          model: candidateModel,
          inputTokens,
          outputTokens,
          durationMs,
        });

        return {
          content: choice.message.content.trim(),
          model: candidateModel,
          inputTokens,
          outputTokens,
          raw: data,
        };
      } catch (err) {
        logger.warn(`Model ${candidateModel} failed: ${err.message}. Trying next candidate...`);
        lastError = err;
      }
    }

    throw new Error(`All LLM models in pool failed. Last error: ${lastError ? lastError.message : 'Unknown'}`);
  }

  async completeJson(options) {
    const res = await this.complete(options);
    const text = res.content;
    const unescaped = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    try {
      const parsed = JSON.parse(unescaped);
      return { ...res, parsed };
    } catch (e) {
      // Find JSON object slice
      const start = unescaped.indexOf('{');
      const end = unescaped.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end > start) {
        const slice = unescaped.slice(start, end + 1);
        try {
          const parsed = JSON.parse(slice);
          return { ...res, parsed };
        } catch (sliceErr) {
          throw new Error(`Failed to parse LLM JSON output: ${sliceErr.message}`);
        }
      }
      throw new Error(`No JSON object found in response: ${text.slice(0, 200)}...`);
    }
  }
}

module.exports = new OpenRouterLLMProvider();
module.exports.OpenRouterLLMProvider = OpenRouterLLMProvider;
