# Architecture Document: OpenClaw WhatsApp API Channel & Daily Social Dispatcher

## 1. System Topology & Process Boundaries

The WhatsApp integration inside OpenClaw acts as an outbound gateway service, using WhatsApp Web's multi-device protocol backed by Baileys. It interfaces with the OpenClaw Core Gateway via internal WebSocket and IPC channels:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│ LOCAL HOST (Linux Node: /home/thirzq/.openclaw)                                                 │
│                                                                                                 │
│  ┌────────────────────────────────────────────────────────┐                                     │
│  │ Scheduled Ingestion / CLI Invocation                   │                                     │
│  │                                                        │                                     │
│  │ • cron: 0 2 * * * (09:00 WIB)                          │                                     │
│  │ • scripts/daily-social-post.js                         │                                     │
│  │ • Read: project_catalog.json & articles_log.json       │                                     │
│  │ • State: daily_social_history.json                     │                                     │
│  └───────────────────────────┬────────────────────────────┘                                     │
│                              │                                                                  │
│                              ▼ HTTPS Request                                                    │
│                 ┌───────────────────────────┐                                                   │
│                 │ OpenRouter Inference API  │ (meta-llama/llama-3.3-70b-instruct)               │
│                 └────────────┬──────────────┘                                                   │
│                              │ JSON Response (4 Platform Posts + Visual Concept)                │
│                              ▼                                                                  │
│  ┌────────────────────────────────────────────────────────┐                                     │
│  │ Formatter & Temp Buffer                                │                                     │
│  │ • Formats WhatsApp Markdown (*bold*, bullet lists)     │                                     │
│  │ • Writes to tmp_social_msg_<timestamp>.txt             │                                     │
│  └───────────────────────────┬────────────────────────────┘                                     │
│                              │                                                                  │
│                              ▼ CLI Exec: openclaw message send --channel whatsapp               │
│  ┌────────────────────────────────────────────────────────┐                                     │
│  │ OpenClaw Gateway Process (Node.js :18789)              │                                     │
│  │                                                        │                                     │
│  │ ┌──────────────────────────────────────────────────┐   │                                     │
│  │ │ Channel Manager & Policy Gate                    │   │                                     │
│  │ │ • Inbound Drop: dmPolicy=disabled, group=disabled│   │                                     │
│  │ │ • Outbound Route: @openclaw/whatsapp plugin      │   │                                     │
│  │ └─────────────────────────┬────────────────────────┘   │                                     │
│  │                           ▼                                                                  │
│  │ ┌──────────────────────────────────────────────────┐   │                                     │
│  │ │ @openclaw/whatsapp (Baileys WebSocket Engine)    │   │                                     │
│  │ │ • Noise Key Protocol & Auth Store                │   │                                     │
│  │ │   (~/.openclaw/credentials/whatsapp/)            │   │                                     │
│  │ └─────────────────────────┬────────────────────────┘   │                                     │
│  └───────────────────────────┼────────────────────────────┘                                     │
└──────────────────────────────┼──────────────────────────────────────────────────────────────────┘
                               │ Encrypted TLS WebSocket
                               ▼
                ┌───────────────────────────────┐
                │ WhatsApp Web Multi-Device Net │
                └──────────────┬────────────────┘
                               │ Push Notification
                               ▼
                ┌───────────────────────────────┐
                │ User WhatsApp Device          │
                │ (+1234567890)              │
                └───────────────────────────────┘
```

---

## 2. Inbound & Outbound State Flow

### 2.1 Inbound Message Dropping State Machine
To guarantee complete privacy and zero bot interference in private communications, the OpenClaw Gateway processes incoming WhatsApp packets through a deterministic policy drop gate:

```mermaid
stateDiagram-v2
    [*] --> InboundMessageReceived: WhatsApp Web WebSocket Packet
    InboundMessageReceived --> PolicyCheck: Extract sender JID & chat type
    
    state PolicyCheck {
        [*] --> CheckChatType
        CheckChatType --> DirectMessage: JID ends with @s.whatsapp.net
        CheckChatType --> GroupMessage: JID ends with @g.us
        
        DirectMessage --> InspectDMPolicy: dmPolicy == "disabled"?
        InspectDMPolicy --> DropMessage: Yes (Drop silently)
        
        GroupMessage --> InspectGroupPolicy: groupPolicy == "disabled"?
        InspectGroupPolicy --> DropMessage: Yes (Drop silently)
    }
    
    DropMessage --> [*]: Log debug event & terminate without agent prompt
```

### 2.2 Outbound Daily Social Post Kit Flow

```mermaid
sequenceDiagram
    autonumber
    participant Cron as Daily Cron (cron-daily-social.sh)
    participant Script as Orchestrator (daily-social-post.js)
    participant Catalog as project_catalog.json
    participant History as daily_social_history.json
    participant WP as WordPress REST API (:8085)
    participant AI as OpenRouter API
    participant Gateway as OpenClaw Gateway CLI
    participant WA as Baileys Engine (@openclaw/whatsapp)
    participant User as User WhatsApp (+1234567890)

    Cron->>Script: Trigger execution (02:00 UTC / 09:00 WIB)
    Script->>Catalog: Ingest registered project catalog
    Script->>History: Read last_project_id & posting timestamps
    Script->>Script: Compute candidate project for rotation
    Script->>WP: GET /wp/v2/posts (Locate project permalink)
    WP-->>Script: Return published article metadata & excerpt
    Script->>AI: Send prompt with project + article context
    AI-->>Script: Return structured JSON (X, Threads, IG, FB, Visual Concept)
    Script->>Script: Format WhatsApp text (*bold*, unicode dividers, copy blocks)
    Script->>Gateway: Exec openclaw message send --channel whatsapp --target +62812...
    Gateway->>WA: Forward message payload to active Baileys socket
    WA->>User: Deliver notification with ready-to-copy social kit
    WA-->>Gateway: Delivery ACK
    Gateway-->>Script: Success exit code 0
    Script->>History: Append run entry & update last_project_id
```

---

## 3. Data Formats & Payloads

### 3.1 Project History Schema (`daily_social_history.json`)
```json
{
  "last_run_timestamp": "2026-10-31T02:00:00.000Z",
  "last_project_id": "uptime-medics",
  "history": [
    {
      "date": "2026-10-31",
      "project_id": "uptime-medics",
      "project_name": "Uptime Medics",
      "title": "High-Performance Distributed Uptime Monitoring in Rust",
      "link": "https://wordpress.nevatal.id/uptime-medics-monitoring/",
      "sent_to": "+1234567890"
    }
  ]
}
```

### 3.2 Formatted WhatsApp Message Contract
```
🚀 *DAILY SOCIAL MEDIA POST KIT*
📅 *Date:* 2026-10-31
🏷️ *Featured Project:* Uptime Medics
🔗 *Live Link:* https://uptime.nevatal.id
📖 *WordPress Article:* https://wordpress.nevatal.id/uptime-medics-monitoring/

━━━━━━━━━━━━━━━━━━━━━━━━━━
🐦 *1. X (TWITTER)* [Tap to Copy]
━━━━━━━━━━━━━━━━━━━━━━━━━━
Enterprise uptime monitors charge $50/mo just for basic HTTP ping checks.

We built Uptime Medics in pure Rust:
• Single binary (<30MB RAM)
• Zero-signup community monitoring
• Multi-hop SSRF & DNS rebinding defense
• Token bucket rate limiting

Explore the live tool: https://uptime.nevatal.id
#RustLang #DevOps

━━━━━━━━━━━━━━━━━━━━━━━━━━
🧵 *2. THREADS* [Tap to Copy]
━━━━━━━━━━━━━━━━━━━━━━━━━━
...

━━━━━━━━━━━━━━━━━━━━━━━━━━
📸 *3. INSTAGRAM* [Tap to Copy]
━━━━━━━━━━━━━━━━━━━━━━━━━━
...
💡 *Visual Concept Suggestion:*
...

━━━━━━━━━━━━━━━━━━━━━━━━━━
📘 *4. FACEBOOK PAGE* [Tap to Copy]
━━━━━━━━━━━━━━━━━━━━━━━━━━
...

━━━━━━━━━━━━━━━━━━━━━━━━━━
✨ *Daily post kit prepared!* Copy and publish each platform whenever you're ready.
```

---

## 4. Security, Credentials & Isolation

1. **Credential Store:** `~/.openclaw/credentials/whatsapp/` contains the Baileys multi-device authentication state:
   - `creds.json`: Noise protocol cryptographic keys, identity keypairs, signed prekeys.
   - Filesystem permissions: `0700` directory access, restricted to local user `thirzq`.
2. **Rate Limiting & Anti-Ban Safeguards:**
   - Single message batch transmission per day.
   - Message transmission occurs over authenticated persistent WebSocket with backoff retries.
   - No unsolicited marketing or mass recipient broadcast lists.
