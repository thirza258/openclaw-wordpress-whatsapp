import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { Type } from "typebox";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

function resolveWordpressDir() {
  const candidates = [
    process.env.WORDPRESS_SKILL_DIR,
    path.resolve(process.cwd(), "scripts"),
    path.resolve(process.cwd()),
    path.join(os.homedir(), ".openclaw/workspace/skills/wordpress"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../skills/wordpress")
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "project_catalog.json")) || fs.existsSync(path.join(c, "scripts/project_catalog.json"))) {
      return c;
    }
  }
  return candidates[0] || process.cwd();
}

const AUTHORIZED_NUMBERS = (process.env.AUTHORIZED_NUMBERS || process.env.TARGET_PHONE_NUMBER || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

function loadCatalog() {
  try {
    const dir = resolveWordpressDir();
    const candidateFiles = [
      path.join(dir, "project_catalog.json"),
      path.join(dir, "scripts/project_catalog.json"),
      path.join(dir, "project_catalog.example.json"),
      path.join(dir, "scripts/project_catalog.example.json")
    ];
    for (const catPath of candidateFiles) {
      if (fs.existsSync(catPath)) {
        const parsed = JSON.parse(fs.readFileSync(catPath, "utf8"));
        return Array.isArray(parsed) ? parsed : (parsed.projects || []);
      }
    }
    console.error("[ProductKit] Catalog not found in candidates:", candidateFiles);
  } catch (e) {
    console.error("[ProductKit] Error loading catalog:", e);
  }
  return [];
}

function loadLaunchHistory() {
  try {
    const dir = resolveWordpressDir();
    const histPath = path.join(dir, "launch_history.json");
    if (fs.existsSync(histPath)) {
      return JSON.parse(fs.readFileSync(histPath, "utf8"));
    }
  } catch (e) {
    console.error("[ProductKit] Error loading launch history:", e);
  }
  return { launches: [] };
}

function formatProjectList() {
  const projects = loadCatalog();
  const history = loadLaunchHistory();

  let msg = `🚀 *REGISTERED PROJECTS IN CATALOG (${projects.length})* 🚀\n`;
  msg += `*(One-Time Platform Submissions)*\n\n`;

  projects.forEach((p, idx) => {
    const launched = (history.launches || []).find(l => l.project_id === p.id);
    const status = launched ? `✅ [LAUNCHED on ${launched.date}]` : `⏳ [NOT YET LAUNCHED]`;
    msg += `${(idx + 1).toString().padStart(2, "0")}. *${p.name}*\n   ID: \`${p.id}\` — ${status}\n`;
  });

  msg += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `💡 *To generate & send Launch Kit to WhatsApp:*\n`;
  msg += `Send: \`productkit.js <project_id>\`\n`;
  msg += `Example: \`productkit.js rag-reader\` or \`productkit.js voltquest\``;

  return msg;
}

function formatHelp() {
  return `🚀 *Product Launch Kit Command Center*\n\n` +
    `Commands sent from authorized numbers (configured via AUTHORIZED_NUMBERS or TARGET_PHONE_NUMBER) are automatically processed:\n\n` +
    `• \`productkit.js list\`\n` +
    `  Show all projects in catalog with their launch status.\n\n` +
    `• \`productkit.js <project_id>\`\n` +
    `  Generate complete Launch Kit (Product Hunt, AlternativeTo, BetaList, SaaSHub, TAAFT, Futurepedia, DevHunt, Peerlist) + 3 in-app screenshots (signed in when credentials exist) and deliver directly to this WhatsApp chat.\n` +
    `  Example: \`productkit.js ragreader\` or \`productkit.js voltquest\`\n\n` +
    `• \`productkit.js help\`\n` +
    `  Display this command reference.`;
}

function normalizeProjectId(input, catalog) {
  if (!input) return null;
  const raw = input.trim().toLowerCase();

  // 1. Exact ID match
  let found = catalog.find(p => p.id.toLowerCase() === raw);
  if (found) return found;

  // 2. Normalized without dashes or spaces (e.g. "ragreader" -> "rag-reader")
  const clean = raw.replace(/[-_\s]/g, "");
  found = catalog.find(p => p.id.replace(/[-_\s]/g, "").toLowerCase() === clean);
  if (found) return found;

  // 3. Substring match on ID or name
  found = catalog.find(p => p.id.toLowerCase().includes(raw) || p.name.toLowerCase().includes(raw));
  return found || null;
}

function triggerLaunchKit(project) {
  const dir = resolveWordpressDir();
  const candidates = [
    path.join(dir, "project-launch-kit.js"),
    path.join(dir, "scripts/project-launch-kit.js"),
    path.resolve(__dirname, "../../scripts/project-launch-kit.js")
  ];
  const scriptPath = candidates.find(c => fs.existsSync(c)) || candidates[0];
  const logPath = path.join(dir, "launch-kit.log");
  const nodeBinary = process.execPath;
  let stdioConfig = "ignore";
  try {
    const outLog = fs.openSync(logPath, "a");
    stdioConfig = ["ignore", outLog, outLog];
  } catch (e) {
    console.error("[ProductKit] Could not open log file, falling back to ignore:", e);
  }
  const child = spawn(nodeBinary, [scriptPath, "--project", project.id, "--send"], {
    detached: true,
    stdio: stdioConfig,
    cwd: dir,
    env: {
      ...process.env
    }
  });
  child.unref();
}

function handleCommand(rawArgs) {
  const catalog = loadCatalog();
  const sub = (rawArgs || "").trim();

  if (!sub || sub.toLowerCase() === "list" || sub.toLowerCase() === "--list") {
    return { text: formatProjectList() };
  }

  if (sub.toLowerCase() === "help" || sub.toLowerCase() === "--help" || sub.toLowerCase() === "-h") {
    return { text: formatHelp() };
  }

  const project = normalizeProjectId(sub, catalog);
  if (!project) {
    return {
      text: `❌ *Project not found:* \`${sub}\`\n\n` +
        `Send \`productkit.js list\` to view available project IDs in the catalog.`
    };
  }

  // Trigger one-time launch kit in background
  triggerLaunchKit(project);

  return {
    text: `🚀 *One-Time Launch Kit initiated for: ${project.name}!*\n\n` +
      `📸 *Capturing 3 In-App Screenshots:*\n` +
      `1️⃣ Desktop App Workspace (1280x800)\n` +
      `2️⃣ Feature / Deep Workspace View (1440x900)\n` +
      `3️⃣ Mobile In-App View (390x844)\n` +
      `🔐 Signs in with the project's account when credentials exist.\n\n` +
      `📝 *Drafting Directory Submissions:*\n` +
      `Product Hunt, AlternativeTo, BetaList, SaaSHub, TAAFT, Futurepedia, DevHunt, and Peerlist.\n\n` +
      `⏳ Generating assets now. The 3 gallery screenshots and full submission kit will arrive in this chat in ~30 seconds!`
  };
}

function isAuthorized(senderId) {
  if (!senderId) return true; // Local session or CLI
  if (AUTHORIZED_NUMBERS.length === 0) return true; // Default allow if unconfigured
  return AUTHORIZED_NUMBERS.some(num => senderId.includes(num));
}

const plugin = defineToolPlugin({
  id: "productkit",
  name: "ProductKit",
  description: "Product launch kit command handler for WhatsApp and CLI.",
  tools: (tool) => [
    tool({
      name: "productkit_command",
      description: "Execute a productkit command (list, launch kit generation, or help).",
      parameters: Type.Object({
        command: Type.String({ description: "Command to execute: 'list', 'help', or project ID like 'ragreader'." })
      }),
      execute: async ({ command }) => {
        return handleCommand(command);
      }
    })
  ]
});

const originalRegister = plugin.register;
plugin.register = function(api) {
  if (originalRegister) {
    originalRegister(api);
  }

  // 1. Register official slash command /productkit
  api.registerCommand({
    name: "productkit",
    description: "Generate and send product launch kit or list catalog projects",
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx) => {
      if (!isAuthorized(ctx.senderId)) {
        return { text: "⛔ Unauthorized sender." };
      }
      return handleCommand(ctx.args || ctx.rest || "");
    }
  });

  // 2. Chat hook matching 'productkit.js ...' or 'productkit ...' without requiring slash
  api.on(
    "before_agent_reply",
    async (event, ctx) => {
      const body = (event.cleanedBody || "").trim();
      const match = body.match(/^\/?productkit(?:\.js)?(?:\s+(.*))?$/i);
      if (match) {
        const senderId = ctx?.senderId || "";
        if (senderId && !isAuthorized(senderId)) {
          return {
            handled: true,
            reply: { text: "⛔ Unauthorized. Commands can only be sent from the authorized owner number." }
          };
        }
        const rawArgs = match[1] || "";
        const result = handleCommand(rawArgs);
        return {
          handled: true,
          reply: result
        };
      }
      return undefined;
    },
    { eligibleTriggers: ["user"] }
  );
};

export default plugin;
