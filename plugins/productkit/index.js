import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { Type } from "typebox";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveModule(subpath) {
  const candidates = [
    path.resolve(__dirname, "../../", subpath),
    path.resolve("/home/thirzq/openclaw-wordpress-whatsapp", subpath),
    path.resolve(process.cwd(), subpath),
    path.resolve(process.env.HOME || "", "openclaw-wordpress-whatsapp", subpath),
  ];
  for (const c of candidates) {
    try {
      return require(c);
    } catch (e) {
      if (e.code !== "MODULE_NOT_FOUND" && !e.message?.includes("Cannot find module")) throw e;
    }
  }
  return require(candidates[0]);
}

const { agents, models, db } = resolveModule("src");
const { isSenderAuthorized } = resolveModule("src/utils/security");
const config = resolveModule("src/config");

function findProjectInCatalog(input, projects) {
  if (!input) return null;
  const raw = input.trim().toLowerCase();

  // 1. Exact ID match
  let found = projects.find((p) => p.id.toLowerCase() === raw);
  if (found) return found;

  // 2. Normalized without dashes or spaces (e.g. "ragreader" -> "rag-reader")
  const clean = raw.replace(/[-_\s]/g, "");
  found = projects.find((p) => p.id.replace(/[-_\s]/g, "").toLowerCase() === clean);
  if (found) return found;

  // 3. Substring match on ID or name
  found = projects.find((p) => p.id.toLowerCase().includes(raw) || p.name.toLowerCase().includes(raw));
  return found || null;
}

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
        msg += `${(idx + 1).toString().padStart(2, "0")}. *${p.name}*\n   ID: \`${p.id}\` | URL: ${p.url || "None"}\n`;
      });
      msg += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `💡 *To create, plan or launch:*\n`;
      msg += `• \`/campaign create <project_id>\`\n`;
      msg += `• \`/campaign plan <project_id>\`\n`;
      msg += `• \`productkit.js <project_id>\``;
      return { text: msg };
    })();
  }

  if (sub === "create") {
    if (!targetId) return { text: "❌ Missing project ID. Usage: `/campaign create <project_id>`" };
    return (async () => {
      await db.initialize();
      const projects = await models.Projects.getAll(true);
      const matched = findProjectInCatalog(targetId, projects);
      const projId = matched ? matched.id : targetId;
      const res = await agents.campaign.createCampaign({ projectId: projId, planMode: false });
      return {
        text:
          `🚀 *Campaign Created: ${res.campaignId}*\n\n` +
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
      await db.initialize();
      const projects = await models.Projects.getAll(true);
      const matched = findProjectInCatalog(targetId, projects);
      const projId = matched ? matched.id : targetId;
      const res = await agents.campaign.createCampaign({ projectId: projId, planMode: true });
      return {
        text:
          `📋 *PLAN ONLY: ${res.project}*\n\n` +
          `${res.plannedActions.join("\n")}\n\n` +
          `Estimated AI usage: ~${res.estimatedTokens} tokens ($${res.estimatedCostUsd})\n\n` +
          `_No external publication will occur._`,
      };
    })();
  }

  if (sub === "approve") {
    if (!targetId) return { text: "❌ Missing campaign ID. Usage: `approve <campaign_id>`" };
    return (async () => {
      const res = await agents.campaign.approve(targetId, senderId || "whatsapp");
      return {
        text:
          `✅ *Campaign ${targetId} Approved & Published!*\n\n` +
          `Status: *${res.status}*\n` +
          `Channels Published: ${(res.results || []).map((r) => r.channel).join(", ")}`,
      };
    })();
  }

  if (sub === "reject") {
    if (!targetId) return { text: "❌ Missing campaign ID. Usage: `reject <campaign_id>`" };
    return (async () => {
      const res = await agents.campaign.reject(targetId, senderId || "whatsapp");
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
        text:
          `📊 *Campaign Status: ${res.campaignId}*\n\n` +
          `Project: *${res.projectName}*\n` +
          `Status: *${res.status}*\n` +
          `Step: ${res.currentStep}\n` +
          `AI Cost: $${res.aiUsage.totalCostUsd} (${res.aiUsage.totalTokens} tokens)\n` +
          `Publications: ${res.publications.length > 0 ? res.publications.map((p) => `${p.channel}: ${p.status}`).join(", ") : "None yet"}`,
      };
    })();
  }

  if (sub === "preview") {
    if (!targetId) return { text: "❌ Missing campaign ID. Usage: `preview <campaign_id>`" };
    return (async () => {
      const res = await agents.campaign.preview(targetId);
      return {
        text:
          `📄 *Campaign Preview: ${res.campaignId}*\n\n` +
          `Project: *${res.project}*\n` +
          `Title: *${res.article?.title || "N/A"}*\n` +
          `Word Count: ${res.article?.wordCount || 0} words\n` +
          `Focus Keyphrase: \`${res.article?.focusKeyphrase || "N/A"}\`\n\n` +
          `Variants: ${res.variants.length} social post(s)`,
      };
    })();
  }

  if (sub === "rollback") {
    if (!targetId) return { text: "❌ Missing campaign ID. Usage: `rollback <campaign_id>`" };
    return (async () => {
      const res = await agents.campaign.rollback(targetId);
      return {
        text:
          `🔄 *Campaign ${targetId} Rolled Back!*\n\n` +
          `Status: *${res.status}*\n` +
          `Withdrawn: ${res.withdrawnPublications?.length || 0} post(s)`,
      };
    })();
  }

  if (sub === "cancel") {
    if (!targetId) return { text: "❌ Missing campaign ID. Usage: `cancel <campaign_id>`" };
    return (async () => {
      const res = await agents.campaign.cancel(targetId);
      return {
        text: `🛑 *Campaign ${targetId} Cancelled.*`,
      };
    })();
  }

  if (sub === "help") {
    return {
      text:
        `🚀 *Marketing Campaign & ProductKit Commands*\n\n` +
        `• \`campaign list\` or \`productkit.js list\` - Show registered projects\n` +
        `• \`campaign create <project_id>\` - Generate full campaign and pause for approval\n` +
        `• \`campaign plan <project_id>\` - Plan actions only without side effects\n` +
        `• \`productkit.js <project_id>\` - Generate launch kit for project\n` +
        `• \`approve <campaign_id>\` - Authorize publication\n` +
        `• \`reject <campaign_id>\` - Reject campaign\n` +
        `• \`preview <campaign_id>\` - Preview generated content\n` +
        `• \`status <campaign_id>\` - View current progress & metrics\n` +
        `• \`rollback <campaign_id>\` - Unpublish/withdraw posts\n` +
        `• \`cancel <campaign_id>\` - Cancel campaign`,
    };
  }

  // If sub is not a known command verb, check if it directly names a project (e.g. `productkit.js ragreader`)
  return (async () => {
    await db.initialize();
    const projects = await models.Projects.getAll(true);
    const matched = findProjectInCatalog(sub, projects);
    if (matched) {
      const isPlan = parts.includes("--dry-run") || parts.includes("--plan") || parts.includes("-n");
      const res = await agents.campaign.createCampaign({ projectId: matched.id, planMode: isPlan });
      if (isPlan) {
        return {
          text:
            `📋 *PLAN ONLY: ${res.project}*\n\n` +
            `${res.plannedActions.join("\n")}\n\n` +
            `Estimated AI usage: ~${res.estimatedTokens} tokens ($${res.estimatedCostUsd})\n\n` +
            `_No external publication will occur._`,
        };
      }
      return {
        text:
          `🚀 *Launch Kit Generated for ${res.project}*\n\n` +
          `Campaign: \`${res.campaignId}\` [${res.status}]\n` +
          `Article: ${res.article.wordCount} words | SEO Score: ${res.qualityScores.seoScoreNumeric}/100\n\n` +
          `Reply with \`approve ${res.campaignId}\` to trigger external publication.`,
      };
    }

    return {
      text:
        `❓ Unknown command: \`${sub}\`\n\n` +
        `Send \`campaign help\` or \`productkit.js help\` for available commands.`,
    };
  })();
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
        return agents.campaign.approve(campaignId, "agent");
      },
    }),
    tool({
      name: "campaign_reject",
      description: "Reject a campaign that is waiting in READY_FOR_APPROVAL status.",
      parameters: Type.Object({
        campaignId: Type.String({ description: "The campaign ID to reject" }),
        reason: Type.Optional(Type.String({ description: "Rejection reason" })),
      }),
      execute: async ({ campaignId, reason }) => {
        return agents.campaign.reject(campaignId, "agent", reason || "");
      },
    }),
    tool({
      name: "campaign_preview",
      description: "Preview generated article and social variants for a campaign.",
      parameters: Type.Object({
        campaignId: Type.String({ description: "The campaign ID" }),
      }),
      execute: async ({ campaignId }) => {
        return agents.campaign.preview(campaignId);
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
        const authNum = (config.whatsapp.authorizedNumbers && config.whatsapp.authorizedNumbers[0]) || "";
        return handleCampaignCommand(command, authNum);
      },
    }),
  ],
});

const originalRegister = plugin.register;
plugin.register = function (api) {
  if (originalRegister) {
    originalRegister(api);
  }

  // 1. Register slash command /campaign
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

  // 2. Register slash command /productkit
  api.registerCommand({
    name: "productkit",
    description: "Generate and send product launch kit or list catalog projects",
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx) => {
      const senderId = ctx.senderId || "";
      return handleCampaignCommand(ctx.args || ctx.rest || "", senderId);
    },
  });

  // 3. Natural text listener in before_agent_reply
  api.on(
    "before_agent_reply",
    async (event, ctx) => {
      const body = (event.cleanedBody || "").trim();
      const campaignMatch = body.match(/^\/?campaign(?:\.js)?(?:\s+(.*))?$/i);
      const productkitMatch = body.match(/^\/?productkit(?:\.js)?(?:\s+(.*))?$/i);
      const approveMatch = body.match(/^(?:approve|reject|preview|status|rollback|cancel)\s+(cmp_[a-zA-Z0-9_]+)/i);

      if (campaignMatch) {
        const senderId = ctx?.senderId || "";
        const rawArgs = campaignMatch[1] || "";
        const result = await handleCampaignCommand(rawArgs, senderId);
        return {
          handled: true,
          reply: result,
        };
      }

      if (productkitMatch) {
        const senderId = ctx?.senderId || "";
        const rawArgs = productkitMatch[1] || "";
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
