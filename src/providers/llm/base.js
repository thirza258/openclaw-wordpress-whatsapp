'use strict';

/**
 * Common LLM Provider Interface
 * All model integrations (OpenRouter, OpenAI, Anthropic, Google, Ollama) implement this contract.
 */
class BaseLLMProvider {
  constructor(name) {
    this.name = name;
  }

  /**
   * Complete a chat prompt
   * @param {Object} options
   * @param {string} options.model
   * @param {Array<{role: string, content: string}>} options.messages
   * @param {number} [options.temperature=0.7]
   * @param {number} [options.maxTokens=2500]
   * @param {string} [options.campaignId]
   * @param {string} [options.jobId]
   * @returns {Promise<{content: string, model: string, inputTokens: number, outputTokens: number, raw: any}>}
   */
  async complete(options) {
    throw new Error('Method complete() must be implemented by subclass');
  }

  /**
   * Complete a structured prompt expecting clean JSON output
   */
  async completeJson(options) {
    throw new Error('Method completeJson() must be implemented by subclass');
  }
}

module.exports = BaseLLMProvider;
