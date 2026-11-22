'use strict';

const db = require('../db');
const { Projects, Campaigns, CampaignBriefs, Approvals, Content, QualityReviews, Assets, Publications } = require('../db/models');
const researchAgent = require('./research-agent');
const contentAgent = require('./content-agent');
const qualityAgent = require('./quality-agent');
const screenshotTools = require('../tools/screenshots');
const wpTools = require('../tools/wordpress');
const socialTools = require('../tools/social');
const whatsAppTools = require('../tools/whatsapp');
const tokenTracker = require('../utils/token-tracker');
const logger = require('../utils/logger').child('CampaignAgent');

class CampaignAgent {
  /**
   * Create new campaign (PRD FR-002, FR-003, Section 8, Section 20)
   */
  async createCampaign({ projectId, briefOverride = {}, planMode = false, channels = ['wordpress', 'bluesky', 'x'] }) {
    await db.initialize();
    const project = await Projects.getById(projectId);
    if (!project) {
      throw new Error(`Project [${projectId}] not found in registry. Send "campaign list" to view registered projects.`);
    }

    logger.info(`Creating campaign for project "${project.name}" (Plan mode: ${planMode})...`);

    // 1. Initialize Campaign record in DRAFT
    const campaign = await Campaigns.create({
      projectId: project.id,
      planMode,
      metadata: { initiatedVia: 'agent', channels },
    });

    // 2. Create Canonical Campaign Brief
    const brief = await CampaignBriefs.create({
      campaignId: campaign.id,
      objective: briefOverride.objective || `Launch technical marketing and organic search distribution for ${project.name}`,
      primaryMessage: briefOverride.primaryMessage || project.description || `Explore ${project.name}`,
      targetAudience: briefOverride.targetAudience || project.target_audience || ['Developers', 'Engineers', 'Architects'],
      targetKeywords: briefOverride.targetKeywords || project.keywords || [project.name],
      channels: briefOverride.channels || channels,
      callToAction: briefOverride.callToAction || `Experience ${project.name} live at ${project.url || 'https://nevatal.id'}`,
      constraints: briefOverride.constraints || ['No paywalled features', '100% verifiable architecture'],
    });

    // 3. Plan Mode Handler (PRD Section 20)
    if (planMode) {
      await Campaigns.updateStatus(campaign.id, 'PLANNED', 'PLAN_MODE_COMPLETE');
      return {
        campaignId: campaign.id,
        project: project.name,
        planMode: true,
        status: 'PLANNED',
        plannedActions: [
          '1. Research project specifications & competitors',
          '2. Extract verifiable technical facts and architecture provenance',
          '3. Generate 1,200-1,800 word SEO canonical article',
          '4. Generate multi-channel social variants (WordPress, X, Threads, Bluesky, TikTok, WhatsApp)',
          '5. Capture desktop, feature, and mobile web screenshots',
          '6. Stage WordPress post draft and upload media assets',
          '7. Request human approval before external publishing',
        ],
        estimatedTokens: 45000,
        estimatedCostUsd: 0.15,
        note: 'PLAN ONLY: No external publications or live changes will occur without approval.',
      };
    }

    // 4. State: RESEARCHING
    await Campaigns.updateStatus(campaign.id, 'RESEARCHING', 'EXTRACTING_FACTS');
    const researchPack = await researchAgent.run({ campaignId: campaign.id, project, brief });

    // 5. State: CONTENT_GENERATING
    await Campaigns.updateStatus(campaign.id, 'CONTENT_GENERATING', 'WRITING_ARTICLE');
    const article = await contentAgent.generateArticle({ campaignId: campaign.id, project, brief, researchPack });

    // Multi-channel social variants
    const variants = await contentAgent.generateMultiChannelVariants({
      campaignId: campaign.id,
      contentId: article.id,
      project,
      brief,
      article,
    });

    // 6. State: QUALITY_REVIEW
    await Campaigns.updateStatus(campaign.id, 'QUALITY_REVIEW', 'EVALUATING_DIMENSIONS');
    const qualityResult = await qualityAgent.review({
      campaignId: campaign.id,
      article,
      project,
      brief,
      researchPack,
    });

    // 7. State: ASSETS_GENERATING
    await Campaigns.updateStatus(campaign.id, 'ASSETS_GENERATING', 'CAPTURING_SCREENSHOTS');
    let assetCapture = null;
    try {
      assetCapture = await screenshotTools.captureDesktop({ campaignId: campaign.id, project });
    } catch (shotErr) {
      logger.warn(`Asset capture warning: ${shotErr.message}`);
    }

    // 8. State: READY_FOR_APPROVAL (PRD FR-008 Human Approval Gate)
    await Campaigns.updateStatus(campaign.id, 'READY_FOR_APPROVAL', 'WAITING_HUMAN_APPROVAL');
    await Approvals.request({
      campaignId: campaign.id,
      channel: 'whatsapp',
      notes: `SEO score: ${qualityResult.scores.seoScoreNumeric}/100, Tech score: ${Math.round(qualityResult.scores.technicalAccuracy * 100)}/100`,
    });

    // Dispatch notification to WhatsApp
    await whatsAppTools.sendApprovalRequest({
      campaignId: campaign.id,
      projectName: project.name,
      wordCount: article.word_count,
      seoScore: qualityResult.scores.seoScoreNumeric,
      technicalScore: Math.round(qualityResult.scores.technicalAccuracy * 100),
      channels: brief.channels,
      liveUrl: project.url || 'https://nevatal.id',
    });

    const costSummary = tokenTracker.getCampaignTotal(campaign.id);
    await Campaigns.recordCost(campaign.id, costSummary.totalCostUsd, costSummary.totalTokens);

    return {
      campaignId: campaign.id,
      project: project.name,
      status: 'READY_FOR_APPROVAL',
      article: {
        id: article.id,
        title: article.title,
        wordCount: article.word_count,
        focusKeyphrase: article.focus_keyphrase,
      },
      variantsCount: variants.length,
      qualityScores: qualityResult.scores,
      assets: assetCapture ? [assetCapture.filename] : [],
      tokensUsed: costSummary.totalTokens,
      costUsd: costSummary.totalCostUsd,
      instructions: `Campaign is waiting for your approval. Reply with "approve ${campaign.id}" to publish.`,
    };
  }

  /**
   * Human Approval Command Handler (PRD FR-008 & Section 19)
   */
  async approve(campaignId, responderId = 'human') {
    const campaign = await Campaigns.getById(campaignId);
    if (!campaign) throw new Error(`Campaign [${campaignId}] not found`);
    if (campaign.status !== 'READY_FOR_APPROVAL') {
      throw new Error(`Campaign [${campaignId}] is in status ${campaign.status}, cannot approve.`);
    }

    logger.info(`Approving campaign ${campaignId} by ${responderId}...`);
    await Approvals.respond({ campaignId, status: 'approved', responderId });
    await Campaigns.updateStatus(campaignId, 'APPROVED', 'SCHEDULED_FOR_PUBLISHING');

    // Execute publication workflow immediately
    return this.executePublishing(campaignId);
  }

  /**
   * Human Reject Command Handler
   */
  async reject(campaignId, responderId = 'human', reason = '') {
    const campaign = await Campaigns.getById(campaignId);
    if (!campaign) throw new Error(`Campaign [${campaignId}] not found`);
    logger.info(`Rejecting campaign ${campaignId} by ${responderId}...`);
    await Approvals.respond({ campaignId, status: 'rejected', responderId, notes: reason });
    await Campaigns.updateStatus(campaignId, 'FAILED', `REJECTED_BY_HUMAN: ${reason}`);
    return { campaignId, status: 'REJECTED', reason };
  }

  /**
   * Cancel Command Handler
   */
  async cancel(campaignId) {
    const campaign = await Campaigns.getById(campaignId);
    if (!campaign) throw new Error(`Campaign [${campaignId}] not found`);
    logger.info(`Cancelling campaign ${campaignId}...`);
    await Campaigns.updateStatus(campaignId, 'CANCELLED', 'USER_CANCELLED');
    return { campaignId, status: 'CANCELLED' };
  }

  /**
   * Preview Command Handler
   */
  async preview(campaignId) {
    const campaign = await Campaigns.getById(campaignId);
    if (!campaign) throw new Error(`Campaign [${campaignId}] not found`);
    const project = await Projects.getById(campaign.project_id);
    const article = await Content.getByCampaignId(campaignId);
    const variants = await Content.getVariants(campaignId);
    const review = await QualityReviews.getLatestForCampaign(campaignId);

    return {
      campaignId,
      project: project?.name,
      status: campaign.status,
      article: article ? {
        title: article.title,
        slug: article.slug,
        wordCount: article.word_count,
        focusKeyphrase: article.focus_keyphrase,
        metaDescription: article.meta_description,
        excerpt: article.excerpt,
      } : null,
      variants: variants.map((v) => ({ channel: v.channel, text: v.text_content })),
      qualityReview: review ? {
        passed: review.passed,
        scores: {
          factuality: review.factuality,
          technicalAccuracy: review.technical_accuracy,
          seo: review.seo,
          brandAlignment: review.brand_alignment,
        },
      } : null,
    };
  }

  /**
   * Publish execution with idempotent safeguards across channels
   */
  async executePublishing(campaignId) {
    logger.info(`Executing publishing for campaign ${campaignId}...`);
    await Campaigns.updateStatus(campaignId, 'PUBLISHING', 'DISPATCHING_PUBLICATIONS');

    const campaign = await Campaigns.getById(campaignId);
    const project = await Projects.getById(campaign.project_id);
    const article = await Content.getByCampaignId(campaignId);
    const brief = await CampaignBriefs.getByCampaignId(campaignId);
    const channels = brief?.channels || ['wordpress'];
    const publicationResults = [];

    // 1. WordPress Publication
    if (channels.includes('wordpress') && article) {
      try {
        // Upload screenshot if asset exists
        const assets = await Assets.getByCampaignId(campaignId);
        let featuredMediaId = 0;
        const desktopShot = assets.find((a) => a.asset_type === 'desktop_screenshot');
        if (desktopShot && desktopShot.file_path) {
          try {
            const uploaded = await screenshotTools.uploadToWordPress({
              campaignId,
              assetId: desktopShot.id,
              filePath: desktopShot.file_path,
              project,
            });
            featuredMediaId = uploaded.id;
          } catch (e) {}
        }

        // Create draft post
        const draft = await wpTools.createDraft({
          campaignId,
          title: article.title,
          contentHtml: article.content_html,
          slug: article.slug,
          excerpt: article.excerpt,
          focusKeyphrase: article.focus_keyphrase,
          metaDescription: article.meta_description,
          category: project.wordpress_category,
          tags: project.keywords,
          featuredMediaId,
        });

        // Publish post idempotently
        const pubResult = await wpTools.publish({
          campaignId,
          postId: draft.id,
        });
        publicationResults.push({ channel: 'wordpress', ...pubResult });
      } catch (wpErr) {
        logger.error(`WordPress publication failed: ${wpErr.message}`);
        publicationResults.push({ channel: 'wordpress', status: 'failed', error: wpErr.message });
      }
    }

    // 2. Social Channels Publication
    const variants = await Content.getVariants(campaignId);
    for (const channel of channels) {
      if (channel === 'wordpress') continue;
      const variant = variants.find((v) => v.channel.toLowerCase() === channel.toLowerCase());
      if (variant) {
        try {
          const res = await socialTools.publish({
            campaignId,
            channel,
            content: variant.text_content,
          });
          publicationResults.push({ channel, ...res });
        } catch (socErr) {
          logger.error(`Social publish failed for ${channel}: ${socErr.message}`);
          publicationResults.push({ channel, status: 'failed', error: socErr.message });
        }
      }
    }

    await Campaigns.updateStatus(campaignId, 'PUBLISHED', 'ALL_CHANNELS_PROCESSED');

    const publishedChannels = publicationResults.filter((p) => p.status === 'published').map((p) => p.channel);
    await whatsAppTools.sendStatusUpdate({
      campaignId,
      projectName: project.name,
      status: 'PUBLISHED',
      currentStep: 'COMPLETED',
      channelsPublished: publishedChannels,
    });

    return {
      campaignId,
      status: 'PUBLISHED',
      results: publicationResults,
    };
  }

  /**
   * Compensating Rollback (PRD Section 34)
   */
  async rollback(campaignId) {
    logger.info(`Executing compensating rollback for campaign ${campaignId}...`);
    const publications = await Publications.getByCampaignId(campaignId);
    const rollbackResults = [];

    for (const pub of publications) {
      if (pub.status !== 'published') continue;
      if (pub.channel === 'wordpress' && pub.external_id) {
        const res = await wpTools.rollback({ campaignId, postId: pub.external_id });
        rollbackResults.push({ channel: 'wordpress', ...res });
      } else {
        const res = await socialTools.rollback({ campaignId, channel: pub.channel, externalId: pub.external_id });
        rollbackResults.push({ channel: pub.channel, ...res });
      }
    }

    await Campaigns.updateStatus(campaignId, 'CANCELLED', 'ROLLED_BACK');
    return {
      campaignId,
      status: 'ROLLED_BACK',
      withdrawnPublications: rollbackResults,
    };
  }

  /**
   * Status Command Handler (PRD Section 19)
   */
  async getStatus(campaignId) {
    const campaign = await Campaigns.getById(campaignId);
    if (!campaign) throw new Error(`Campaign [${campaignId}] not found`);
    const project = await Projects.getById(campaign.project_id);
    const publications = await Publications.getByCampaignId(campaignId);
    const approval = await Approvals.getLatest(campaignId);
    const costSummary = tokenTracker.getCampaignTotal(campaignId);

    return {
      campaignId,
      projectName: project?.name,
      status: campaign.status,
      currentStep: campaign.current_step,
      planMode: campaign.plan_mode,
      approvalStatus: approval?.status || 'none',
      publications: publications.map((p) => ({ channel: p.channel, status: p.status, url: p.external_url })),
      aiUsage: {
        totalTokens: campaign.total_tokens || costSummary.totalTokens,
        totalCostUsd: campaign.total_ai_cost || costSummary.totalCostUsd,
      },
      createdAt: campaign.created_at,
      updatedAt: campaign.updated_at,
    };
  }
}

module.exports = new CampaignAgent();
module.exports.CampaignAgent = CampaignAgent;
