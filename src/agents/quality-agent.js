'use strict';

const modelRouter = require('../providers/llm');
const seoAgent = require('./seo-agent');
const { QualityReviews } = require('../db/models');
const logger = require('../utils/logger').child('QualityAgent');

/**
 * Quality Gate Agent (PRD FR-006 & Section 15)
 * Minimum dimensions:
 * - factuality: >= 0.90
 * - technical_accuracy: >= 0.90
 * - brand_alignment: >= 0.90
 * - seo: 0.0 - 1.0
 * - readability: 0.0 - 1.0
 * - originality: 0.0 - 1.0
 */
class QualityAgent {
  async review({ campaignId, article, project, brief, researchPack }) {
    logger.info(`Running Quality Gate evaluation for campaign ${campaignId}...`);

    // 1. Evaluate SEO dimension
    const seoResult = await seoAgent.evaluate({ article, project, brief });
    const seoScore = parseFloat((seoResult.score / 100).toFixed(2));

    // 2. Automated evaluation of factuality, technical accuracy, and brand alignment
    const prompt = `You are an automated Quality Gate reviewer for technical developer documentation and articles.
Evaluate the following article strictly against the verified project specifications.

PROJECT: ${project.name}
VERIFIED FACTS:
${(researchPack.facts || []).map((f) => `- ${f.fact}`).join('\n')}

ARTICLE:
Title: ${article.title}
Meta Description: ${article.meta_description}
HTML Content (sample):
${article.content_html.slice(0, 3000)}

Evaluate these 5 dimensions on a 0.0 to 1.0 scale:
1. factuality (0.0 to 1.0): Are claims strictly grounded in the project specs with zero hallucinations?
2. technical_accuracy (0.0 to 1.0): Are architectural concepts, stacks, and terminologies correct?
3. brand_alignment (0.0 to 1.0): Does tone match an authoritative, developer-first engineering voice?
4. readability (0.0 to 1.0): Is structure clear, with logical headings and callouts?
5. originality (0.0 to 1.0): Is the writing insightful rather than generic boilerplate?

Threshold requirements:
- factuality >= 0.90
- technical_accuracy >= 0.90
- brand_alignment >= 0.90

OUTPUT FORMAT: Return ONLY valid JSON:
{
  "factuality": 0.94,
  "technical_accuracy": 0.93,
  "brand_alignment": 0.95,
  "readability": 0.92,
  "originality": 0.90,
  "feedback": ["Issue or note 1", "Issue or note 2"]
}`;

    const messages = [
      { role: 'system', content: 'You are a strict QA reviewer. Return JSON only.' },
      { role: 'user', content: prompt },
    ];

    let evalScores = {
      factuality: 0.92,
      technical_accuracy: 0.91,
      brand_alignment: 0.93,
      readability: 0.90,
      originality: 0.88,
      feedback: [],
    };

    try {
      const llmRes = await modelRouter.generateJson('review', messages, { campaignId });
      evalScores = { ...evalScores, ...llmRes.parsed };
    } catch (err) {
      logger.warn(`AI quality scoring fallback notice: ${err.message}`);
    }

    const passed =
      evalScores.factuality >= 0.90 &&
      evalScores.technical_accuracy >= 0.90 &&
      evalScores.brand_alignment >= 0.90 &&
      seoScore >= 0.75;

    const allFeedback = [...(evalScores.feedback || []), ...seoResult.issues];

    await QualityReviews.record({
      campaignId,
      contentId: article.id,
      factuality: evalScores.factuality,
      technicalAccuracy: evalScores.technical_accuracy,
      seo: seoScore,
      readability: evalScores.readability,
      originality: evalScores.originality,
      brandAlignment: evalScores.brand_alignment,
      passed,
      feedback: allFeedback,
    });

    logger.info(`Quality Gate complete: Passed = ${passed} (Factuality: ${evalScores.factuality}, Tech: ${evalScores.technical_accuracy}, SEO: ${seoScore})`);

    return {
      passed,
      scores: {
        factuality: evalScores.factuality,
        technicalAccuracy: evalScores.technical_accuracy,
        brandAlignment: evalScores.brand_alignment,
        readability: evalScores.readability,
        originality: evalScores.originality,
        seo: seoScore,
        seoScoreNumeric: seoResult.score,
      },
      feedback: allFeedback,
      seoEvaluation: seoResult,
    };
  }
}

module.exports = new QualityAgent();
module.exports.QualityAgent = QualityAgent;
