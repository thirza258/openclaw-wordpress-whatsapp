# Product Requirements Document (PRD): OpenClaw WhatsApp API Channel & Daily Social Post Dispatcher

**Primary Gateway:** OpenClaw CLI Gateway (`openclaw message send --channel whatsapp`)  
**Target Recipient:** User Personal WhatsApp (`+1234567890`)  
**Scheduling:** Daily at 02:00 UTC / 09:00 WIB (`cron-daily-social.sh`)

---

## 1. Overview & Problem Statement

### 1.1 Problem Statement
Maintaining an active developer presence across multiple social media networks (X/Twitter, LinkedIn, Instagram, Threads, and Facebook Pages) is critical for driving organic traffic to open-source software and hosted tools. However, individual founders and software developers face recurring obstacles:
1. **Context Fragmentation & Copy Fatigue:** Drafting unique, tailored copy matching the tone, constraints, and conventions of four distinct social platforms every single day consumes 30–60 minutes of deep-work time.
2. **Bot Hallucination & Group Spam Risks:** Standard chatbot integrations often configure conversational auto-replies across all incoming DMs and group chats, leading to accidental bot responses, private context leakage, or annoying chat participants.
3. **Loss of Publishing Control:** Fully automated social media auto-posters frequently publish typos, incorrect links, or poorly timed messages without human review, creating reputational risk.
4. **WhatsApp Protocol Fragility:** Formatting incompatibility (such as sending Markdown tables or unsupported HTML tags to WhatsApp) results in garbled, unreadable text.

### 1.2 Solution
The **OpenClaw WhatsApp API Channel & Daily Social Post Dispatcher** is an asynchronous outbound editorial agent integrated into OpenClaw. It enforces a strict security boundary:
* **Strict Inbound Lockdown:** Inbound DMs and group chat automated replies are permanently disabled (`dmPolicy: "disabled"`, `groupPolicy: "disabled"`, `selfChatMode: false`). OpenClaw never automatically talks back to incoming WhatsApp chats.
* **Outbound Daily Social Post Kit Delivery:** Every morning at 09:00 WIB (02:00 UTC), OpenClaw reviews recently published WordPress articles (`https://wordpress.nevatal.id`) and server project architectures, generates multi-platform post drafts (X, Threads, Instagram, Facebook Pages, Bluesky, Quora, TikTok, Reddit, Substack, Product Hunt, AlternativeTo, SaaSHub, BetaList, There's An AI For That, Futurepedia, DevHunt, and Peerlist), and pushes them to the user's private WhatsApp.
* **Human-in-the-Loop Review:** The user receives a single, beautifully structured WhatsApp message with "Tap to Copy" sections. The user can review, modify, or post directly to social platforms with zero friction.
* **Multi-Platform Tone Optimization:** Leverages OpenRouter LLMs with specialized prompts to format punchy character-limited tweets, threaded commentary, Instagram captions with suggested visual scene concepts, and professional Facebook summaries.

---

## 2. Goals & Non-Goals

### 2.1 Goals
* **Automated Daily Draft Generation:** Deliver a daily social media copy kit every morning at 02:00 UTC / 09:00 WIB without manual intervention.
* **Zero Incoming Interference:** Guarantee that the bot never intercepts, processes, or auto-responds to inbound WhatsApp messages from family, friends, or groups.
* **Platform-Tailored Copywriting:** Produce four distinct variations per run:
  1. *X (Twitter):* Under 280 characters, hook-driven, 1–2 hashtags, project link.
  2. *Threads:* Conversational, curious, open question to prompt community replies.
  3. *Instagram:* Rich storytelling caption, line breaks, visual composition suggestion (for Midjourney/DALL-E or screenshots), and categorized hashtag block.
  4. *Facebook Page:* 2–3 cohesive paragraphs detailing real-world engineering value and architecture.
* **Strict WhatsApp Typography Compliance:** Sanitize all text to use WhatsApp-supported formatting (`*bold*`, `_italic_`, `~strikethrough~`, ````code````, bullet lists). Never transmit Markdown tables (`|---|`) or header hashtags (`# Title`).
* **Intelligent Project Rotation:** Track past deliveries in `daily_social_history.json` to avoid repeating the same project consecutively.

### 2.2 Non-Goals
* **Not a Customer Support Auto-Responder:** Will not function as an automated CRM or customer service chatbot.
* **Not Automated Direct-to-Social Publisher:** Will not post directly to X or Facebook APIs automatically; preserves human oversight via WhatsApp delivery.
* **Not an Inbound Assistant on Personal Number:** The agent does not read user incoming personal messages.

---

## 3. Product Architecture & Messaging Pipeline

```
┌────────────────────────────────────────────────────────────────────────┐
│             OpenClaw WhatsApp Channel & Delivery Engine               │
├───────────────────────────────────┬────────────────────────────────────┤
│ Trigger & Context Layer           │ AI Copywriting Engine              │
├───────────────────────────────────┼────────────────────────────────────┤
│ • Crontab: 02:00 UTC (09:00 WIB)  │ • OpenRouter API:                  │
│ • Catalog: project_catalog.json   │   - LLaMA 3.3 70B / DeepSeek Chat  │
│ • WordPress REST: Latest Post     │ • Multi-Platform System Prompts    │
│ • Rotation: daily_social_history  │ • WhatsApp Formatter & Sanitizer   │
├───────────────────────────────────┴────────────────────────────────────┤
│ Transport & Gateway Layer                                              │
├────────────────────────────────────────────────────────────────────────┤
│ • OpenClaw CLI Gateway: openclaw message send --channel whatsapp       │
│ • Plugin: @openclaw/whatsapp (Baileys WebSocket to WhatsApp Web)       │
│ • Recipient: +1234567890 (User Personal Device)                     │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Content Ingestion & Project Selection
1. **Catalog Parsing:** Reads active project definitions from `skills/wordpress/project_catalog.json` (covering local and remote projects).
2. **History Check:** Inspects `daily_social_history.json` to identify the timestamp and project ID of the last delivery.
3. **Next Candidate Selection:** Chooses the next unposted project in rotation (or allows manual override via `--project <id>`).
4. **Article Reconciliation:** Queries WordPress REST API (`/wp-json/wp/v2/posts`) to match the latest live article permalink and excerpt.

### 3.2 Multi-Platform Social Copy Generation
The generation prompt enforces platform-specific formatting rules:

| Platform | Length / Constraint | Structural Requirements | Tone |
|---|---|---|---|
| **X (Twitter)** | $\le 280$ characters | Hook sentence + value drop + link + 2 hashtags | Direct, provocative, engineer-focused |
| **Threads** | $200–400$ characters | Casual observation + link + conversation starter | Thought-provoking, approachable |
| **Instagram** | $600–1,000$ characters | Narrative breakdown + Visual Concept Suggestion + 10-15 hashtags | Visual storytelling, educational |
| **Facebook Page** | $500–800$ characters | Problem $\rightarrow$ Solution $\rightarrow$ Link $\rightarrow$ Call to action | Professional, authoritative |

### 3.3 Visual Concept Prompting (Instagram Specialization)
Because Instagram requires visual media, the generator produces an actionable **Visual Concept Suggestion** alongside the caption:
- Suggests screenshot layouts (e.g., "Split-screen comparing MNA circuit simulation against oscilloscope waveform").
- Suggests generative AI prompts (e.g., "A hyper-detailed 3D isometric laboratory with glowing neon Arduino boards and schematic blueprints").

---

## 4. WhatsApp Formatting & Compliance Engine

### 4.1 Syntax Transformation Rules
Because WhatsApp does not support CommonMark tables or standard `#` headers, the output formatter enforces:
* **Headers:** Translated to bold caps separated by decorative unicode bars (e.g., `━━━━━━━━━━━━━━━━━━━━━━━━━━ \n 🐦 *1. X (TWITTER)* [Tap to Copy]`).
* **Tables:** Transformed into clean emoji-prefixed bullet lists.
* **Emphasis:** Uses single asterisks `*bold*` instead of `**bold**`.
* **Monospace:** Inline snippets use single backticks; multi-line code uses triple backticks.

### 4.2 Safe Execution & Delivery
To prevent shell escaping bugs when delivering multiline text containing quotes and special symbols through bash:
1. The script writes the formatted payload to a temporary file: `tmp_social_msg_<timestamp>.txt`.
2. The command executes:
   ```bash
   PATH="/home/thirzq/.nvm/versions/node/v26.13.0/bin:$PATH" \
   openclaw message send --channel whatsapp \
     --target "+1234567890" \
     --message "$(cat '/path/to/tmp_file.txt')"
   ```
3. The temporary file is unlinked immediately in a `finally` block.

### 4.3 Decentralized Social Dispatcher Extensions (Bluesky & Mastodon)
To extend distribution beyond traditional walled gardens, the dispatcher integrates directly with dedicated background queue workers and OpenClaw skills:
* **Bluesky Bot (`bluesky-bot`):** AT Protocol agent worker supporting scheduled skeet publishing, multi-turn thread chaining with partial-thread cancel warnings, and persistent SQLite queue processing.
* **Mastodon Bot (`mastodon-bot`):** ActivityPub API client with persistent queueing and automated toot scheduling.
* **Workflow:** Upon user confirmation of morning WhatsApp drafts, approved kits can be piped directly into `bluesky-bot` and `mastodon-bot` queues for automated multi-network broadcast.

---

## 5. Security & Inbound Safeguards

### 5.1 OpenClaw Gateway Configuration (`openclaw.json`)
```json
{
  "channels": {
    "whatsapp": {
      "enabled": true,
      "selfChatMode": false,
      "dmPolicy": "disabled",
      "groupPolicy": "disabled",
      "allowFrom": []
    }
  },
  "plugins": {
    "entries": {
      "whatsapp": {
        "enabled": true
      }
    }
  }
}
```

* **`dmPolicy: "disabled"`**: Direct messages from any sender are dropped without processing.
* **`groupPolicy: "disabled"`**: The bot remains completely passive in all joined groups.
* **`selfChatMode: false`**: Disables reflective self-chat evaluation loops.
* **Credential Isolation:** WhatsApp Web session keys and cryptographic noise tokens are stored in `~/.openclaw/credentials/whatsapp/` with strict `0700` filesystem permissions.

---

## 6. Operational Commands & Maintenance

```bash
# 1. Preview social kit without sending (Dry Run):
npm run --prefix /home/thirzq/.openclaw/workspace/skills/wordpress daily-social:dry

# 2. Generate and deliver immediately to WhatsApp:
npm run --prefix /home/thirzq/.openclaw/workspace/skills/wordpress daily-social

# 3. Force delivery for a specific project:
node /home/thirzq/.openclaw/workspace/skills/wordpress/scripts/daily-social-post.js --project voltquest --send

# 4. Inspect catalog and recent WhatsApp delivery history:
npm run --prefix /home/thirzq/.openclaw/workspace/skills/wordpress daily-social:list

# 5. WhatsApp administrative check and session verification:
openclaw plugins run whatsapp doctor
```
