import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { Type } from "typebox";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { agents, models, db } = require("../../src");
const { isSenderAuthorized } = require("../../src/utils/security");
const config = require("../../src/config");

function handleCampaignCommand(rawArgs, senderId) {
  const auth = isSenderAuthorized(senderId);
  if (!auth.authorized) {
    return {
      text: `⛔ *Access Denied:* ${auth.reason}`,
    };
  }

  const parts = (rawArgs || "").trim().split(/\s+/);
  const sub = parts[0] ? parts[0].toLowerCase() : "list";
  const targetId = parts[1] || "";

  if (sub === "list" || sub === "projects") {
    return (async () => {
      await db.initialize();
      const projects = await models.Projects.getAll(true);
      let msg = `🚀 *REGISTERED PROJECTS IN CATALOG (${projects.length})*\n\n`;
      projects.forEach((p, idx) => {
        msg += `${(idx + 1).toString().padStart(2, "0")}. *${p.name}*\n   ID: \`${p.id}\` | URL: ${p.url || 'None'}\n`;
      });
      msg += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `💡 *To create or plan a campaign:*\n`;
      msg += `• \`/campaign create <project_id>\`\n`;
      msg += `• \`/campaign plan <project_id>\``;
      return { text: msg };
    })();
  }

  if (sub === "create") {
    if (!targetId) return { text: "❌ Missing project ID. Usage: `/campaign create <project_id>`" };
    return (async () => {
      const res = await agents.campaign.createCampaign({ projectId: targetId, planMode: false });
      return {
        text: `🚀 *Campaign Created: ${res.campaignId}*\n\n` +
          `Project: *${res.project}*\n` +
          `Status: *${res.status}*\n\n` +
          `Article generated (${res.article.wordCount} words).\n` +
          `Quality Gate passed. SEO Score: ${res.qualityScores.seoScoreNumeric}/100.\n\n` +
          `Reply with \`approve ${res.campaignId}\` to trigger multi-channel publication.`,
      };
    })();
  }

  if (sub === "plan") {
    if (!targetId) return { text: "❌ Missing project ID. Usage: `/campaign plan <project_id>`" };
    return (async () => {
      const res = await agents.campaign.createCampaign({ projectId: targetId, planMode: true });
      return {
        text: `📋 *PLAN ONLY: ${res.project}*\n\n` +
          `${res.plannedActions.join("\n")}\n\n` +
          `Estimated AI usage: ~${res.estimatedTokens} tokens ($${res.estimatedCostUsd})\n\n` +
          `_No external publication will occur._`,
      };
    })();
  }

  if (sub === "approve") {
    if (!targetId) return { text: "❌ Missing campaign ID. Usage: `approve <campaign_id>`" };
    return (async () => {
      const res = await agents.campaign.approve(targetId, senderId || 'whatsapp');
      return {
        text: `✅ *Campaign ${targetId} Approved & Published!*\n\n` +
          `Status: *${res.status}*\n` +
          `Channels Published: ${(res.results || []).map(r => r.channel).join(', ')}`,
      };
    })();
  }

  if (sub === "reject") {
    if (!targetId) return { text: "❌ Missing campaign ID. Usage: `reject <campaign_id>`" };
    return (async () => {
      const res = await agents.campaign.reject(targetId, senderId || 'whatsapp');
      return {
        text: `❌ *Campaign ${targetId} Rejected.*`,
      };
    })();
  }

  if (sub === "status") {
    if (!targetId) return { text: "❌ Missing campaign ID. Usage: `status <campaign_id>`" };
    return (async () => {
      const res = await agents.campaign.getStatus(targetId);
      return {
        text: `📊 *Campaign Status: ${res.campaignId}*\n\n` +
          `Project: *${res.projectName}*\n` +
          `Status: *${res.status}*\n` +
          `Step: ${res.currentStep}\n` +
          `AI Cost: $${res.aiUsage.totalCostUsd} (${res.aiUsage.totalTokens} tokens)\n` +
          `Publications: ${res.publications.length > 0 ? res.publications.map(p => `${p.channel}: ${p.status}`).join(', ') : 'None yet'}`,
      };
    })();
  }

  return {
    text: `🚀 *Marketing Campaign Commands*\n\n` +
      `• \`campaign list\` - Show registered projects\n` +
      `• \`campaign create <project_id>\` - Generate full campaign and pause for approval\n` +
      `• \`campaign plan <project_id>\` - Plan actions only without side effects\n` +
      `• \`approve <campaign_id>\` - Authorize publication\n` +
      `• \`reject <campaign_id>\` - Reject campaign\n` +
      `• \`status <campaign_id>\` - View current progress\n` +
      `• \`rollback <campaign_id>\` - Unpublish/withdraw posts`,
  };
}

const plugin = defineToolPlugin({
  id: "productkit",
  name: "ProductKit",
  description: "Autonomous Marketing Operations Platform for OpenClaw.",
  tools: (tool) => [
    tool({
      name: "campaign_create",
      description: "Create an autonomous marketing campaign for a registered project.",
      parameters: Type.Object({
        projectId: Type.String({ description: "Target project ID (e.g. 'rag-reader', 'english-practice')" }),
        planMode: Type.Optional(Type.Boolean({ description: "Run in plan-only mode without executing" })),
      }),
      execute: async ({ projectId, planMode }) => {
        return agents.campaign.createCampaign({ projectId, planMode: Boolean(planMode) });
      },
    }),
    tool({
      name: "campaign_plan",
      description: "Generate a marketing execution plan for a project without performing external actions.",
      parameters: Type.Object({
        projectId: Type.String({ description: "Target project ID" }),
      }),
      execute: async ({ projectId }) => {
        return agents.campaign.createCampaign({ projectId, planMode: true });
      },
    }),
    tool({
      name: "campaign_approve",
      description: "Approve a campaign that is waiting in READY_FOR_APPROVAL status.",
      parameters: Type.Object({
        campaignId: Type.String({ description: "The campaign ID to approve" }),
      }),
      execute: async ({ campaignId }) => {
        return agents.campaign.approve(campaignId, 'agent');
      },
    }),
    tool({
      name: "campaign_status",
      description: "Check the status and publication details of a campaign.",
      parameters: Type.Object({
        campaignId: Type.String({ description: "The campaign ID" }),
      }),
      execute: async ({ campaignId }) => {
        return agents.campaign.getStatus(campaignId);
      },
    }),
    tool({
      name: "campaign_rollback",
      description: "Rollback and unpublish external posts for a campaign.",
      parameters: Type.Object({
        campaignId: Type.String({ description: "The campaign ID to rollback" }),
      }),
      execute: async ({ campaignId }) => {
        return agents.campaign.rollback(campaignId);
      },
    }),
    tool({
      name: "campaign_list",
      description: "List all projects registered in the marketing platform.",
      parameters: Type.Object({}),
      execute: async () => {
        await db.initialize();
        return models.Projects.getAll(true);
      },
    }),
    tool({
      name: "productkit_command",
      description: "Execute campaign or legacy productkit command.",
      parameters: Type.Object({
        command: Type.String({ description: "Command text" }),
      }),
      execute: async ({ command }) => {
        return handleCampaignCommand(command, config.whatsapp.authorizedNumbers[0]);
      },
    }),
  ],
});

const originalRegister = plugin.register;
plugin.register = function (api) {
  if (originalRegister) {
    originalRegister(api);
  }

  // Register slash command /campaign
  api.registerCommand({
    name: "campaign",
    description: "Create, plan, approve, or manage marketing campaigns",
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx) => {
      const senderId = ctx.senderId || "";
      return handleCampaignCommand(ctx.args || ctx.rest || "", senderId);
    },
  });

  // Natural text listener: "campaign create ...", "approve cmp_...", etc.
  api.on(
    "before_agent_reply",
    async (event, ctx) => {
      const body = (event.cleanedBody || "").trim();
      const campaignMatch = body.match(/^\/?campaign(?:\.js)?(?:\s+(.*))?$/i);
      const approveMatch = body.match(/^(?:approve|reject|preview|status|rollback)\s+(cmp_[a-zA-Z0-9_]+)/i);

      if (campaignMatch) {
        const senderId = ctx?.senderId || "";
        const rawArgs = campaignMatch[1] || "";
        const result = await handleCampaignCommand(rawArgs, senderId);
        return {
          handled: true,
          reply: result,
        };
      }

      if (approveMatch) {
        const senderId = ctx?.senderId || "";
        const result = await handleCampaignCommand(body, senderId);
        return {
          handled: true,
          reply: result,
        };
      }

      return undefined;
    },
    { eligibleTriggers: ["user"] }
  );
};

export default plugin;
