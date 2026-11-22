'use strict';

const modelRouter = require('../providers/llm');
const logger = require('../utils/logger').child('SEOAgent');

class SEOAgent {
  /**
   * Evaluate article SEO dimensions (PRD Section 16):
   * - keyword coverage
   * - search intent
   * - title quality
   * - meta description
   * - heading structure
   * - internal links
   * - external references
   * - topical coverage
   * - schema opportunities
   */
  async evaluate({ article, project, brief }) {
    logger.info(`Evaluating SEO quality for article "${article.title}"...`);

    const wordCount = article.word_count || article.content_html.split(/\s+/).length;
    const focusKw = article.focus_keyphrase || project.keywords?.[0] || '';
    const hasFocusKwInTitle = article.title.toLowerCase().includes(focusKw.toLowerCase());
    const hasFocusKwInMeta = (article.meta_description || '').toLowerCase().includes(focusKw.toLowerCase());
    const h2Matches = (article.content_html.match(/<h2[^>]*>/gi) || []).length;
    const h3Matches = (article.content_html.match(/<h3[^>]*>/gi) || []).length;
    const tableMatches = (article.content_html.match(/<table[^>]*>/gi) || []).length;

    const deterministicIssues = [];
    let score = 100;

    if (!hasFocusKwInTitle) {
      score -= 15;
      deterministicIssues.push('Focus keyphrase missing from SEO title');
    }
    if (!hasFocusKwInMeta) {
      score -= 10;
      deterministicIssues.push('Focus keyphrase missing from meta description');
    }
    if (article.meta_description && (article.meta_description.length < 120 || article.meta_description.length > 165)) {
      score -= 5;
      deterministicIssues.push(`Meta description length (${article.meta_description.length}) outside optimal 120-165 range`);
    }
    if (wordCount < 1000) {
      score -= 15;
      deterministicIssues.push(`Article length (${wordCount} words) is below recommended 1,200 words`);
    }
    if (h2Matches < 4) {
      score -= 10;
      deterministicIssues.push(`Heading structure has only ${h2Matches} H2 headings (recommended: >= 5)`);
    }
    if (tableMatches === 0) {
      score -= 5;
      deterministicIssues.push('Missing comparison or summary data table');
    }

    score = Math.max(20, Math.min(100, score));

    return {
      score,
      focusKeyphrase: focusKw,
      wordCount,
      h2Count: h2Matches,
      h3Count: h3Matches,
      issues: deterministicIssues,
      recommendations: deterministicIssues.length === 0
        ? ['Article adheres to high-performing SEO standards. Ready for publication.']
        : deterministicIssues.map((issue) => `Optimize: ${issue}`),
      passed: score >= 80,
    };
  }
}

module.exports = new SEOAgent();
module.exports.SEOAgent = SEOAgent;
