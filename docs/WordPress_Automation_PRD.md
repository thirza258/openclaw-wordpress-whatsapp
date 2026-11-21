# Product Requirements Document (PRD): WordPress Automation & Content Engine

**Live Site URL:** [https://wordpress.nevatal.id](https://wordpress.nevatal.id)  
**Local Gateway URL:** `http://localhost:8085`  
**Remote Infrastructure (`homelab` / `100.86.61.70`):** `https://cloud.nevatal.id` (Proxmox VE Control Plane & WooCommerce VPS Orchestration)

---

## 1. Overview & Problem Statement

### 1.1 Problem Statement
Operating a distributed portfolio of technical microservices, web apps, simulators, and infrastructure projects requires continuous technical evangelism, search engine optimization (SEO), and content creation. However, maintaining high-ranking technical content across dozens of projects presents severe operational challenges:
1. **Manual Content Bottlenecks:** Engineering teams lack the bandwidth to write comprehensive 1,500+ word technical architectures, user guides, and SEO articles for every microservice, RAG system, or simulator in their ecosystem.
2. **REST API SEO Indexing Gaps in Yoast SEO:** When articles are published programmatically via the WordPress REST API (`/wp-json/wp/v2/posts`), standard WordPress indexable hooks are bypassed. As a result, Yoast SEO fails to calculate internal backlink graphs, readability scores, and keyphrase density metrics, leaving indexables incomplete in `wp_yoast_indexable` and XML sitemaps.
3. **Cross-Device Infrastructure Disconnection:** In a hybrid home-lab and cloud deployment (where containerized services run locally while physical hardware like Dell PowerEdge R640 hypervisors run remotely on Proxmox VE), WordPress often sits isolated from infrastructure control planes, preventing seamless client onboarding, automated billing, and live telemetry dashboards.
4. **Content Staleness & Project Drift:** As projects evolve across local repositories and remote staging machines, published documentation rapidly falls out of sync without automated catalog monitoring.

### 1.2 Solution
The **WordPress Automation & Content Engine** is an enterprise-grade content management, SEO optimization, and infrastructure integration suite running within OpenClaw. It unifies:
* **Automated AI Article Generator (`generate-articles.js`):** OpenRouter-powered generation producing 1,200–1,800 word, schema-ready technical guides with dynamic angle rotation (Architecture Deep-Dive, Quickstart Tutorial, Security & Scalability Analysis).
* **Dual-Layer Yoast SEO Resave Engine (`mu-plugins/yoast-meta-rest.php` & `resave-yoast-posts.php`):** Server-side WordPress hooks combined with containerized CLI automation to guarantee 100% Yoast indexability, perfect readability scores (90), optimized SEO linkdex scores (68–78), auto-calculated reading times, and bidirectional internal backlink synchronization.
* **Cross-Device Proxmox Orchestration (`nevatal-cloud-manager`):** A custom WordPress & WooCommerce plugin bridging WordPress with the remote Nevatal Cloud Proxmox VE cluster (`100.86.61.70`), automating VPS provisioning upon WooCommerce checkout, embedding customer server management dashboards (`[nevatal_instances]`), and surfacing hypervisor health.
* **Autonomous Cron & PM2 Scheduling:** Scheduled hands-free publishing pipelines delivering consistent organic search visibility.

---

## 2. Goals & Non-Goals

### 2.1 Goals
* **Automated Technical Documentation:** Automatically discover active containerized applications, local projects, and PRD specifications from `/home/thirzq/.openclaw/archive/` and remote devices, translating them into deep-dive technical articles.
* **Guaranteed Yoast SEO Compliance:** Enforce that 100% of published posts have verified focus keyphrases, meta descriptions (<= 155 chars), SEO titles with site branding, valid reading times, and fully computed Yoast indexables.
* **Bidirectional Link Graph Calculation:** Automatically recalculate internal incoming backlink counts (`incoming_link_count`) in `wp_yoast_indexable` whenever articles are inserted or updated.
* **WooCommerce & Proxmox Cloud Integration:** Seamlessly connect digital WooCommerce checkouts to the Go-based Nevatal Cloud API on `100.86.61.70` to clone, cloud-init configure, and boot customer VPS instances.
* **Idempotent CLI Management:** Provide full REST API CRUD capability for posts, categories, tags, and users via `wp-cli.js`.

### 2.2 Non-Goals
* **Not a Low-Quality AI Content Farm:** Does not generate generic, ungrounded blog spam; generation strictly ingests canonical architectural specs, PRDs, and container runtime metadata.
* **Not a Public Open-Registration Blog:** User registration is locked; content creation is strictly authenticated via Application Passwords and internal OpenClaw agents.
* **Not Direct Hypervisor Manipulation from WordPress Frontend:** WordPress never connects to Proxmox VE root SSH directly; all actions pass through the authenticated Nevatal Cloud API backend (`:8090`).

---

## 3. Product Features & User Experience

```
┌────────────────────────────────────────────────────────────────────────┐
│               WordPress Automation & Content Ecosystem                │
├──────────────────────────────────┬─────────────────────────────────────┤
│ OpenClaw Content & SEO Engine    │ Nevatal Cloud Manager (Plugin)      │
│ (Local Device: Port 8085)        │ (Remote Homelab: 100.86.61.70:8090) │
├──────────────────────────────────┼─────────────────────────────────────┤
│ • Project Catalog Auto-Discovery │ • WooCommerce VPS Provisioning      │
│ • OpenRouter Multi-Model LLM Gen │ • Proxmox VE Cluster VM Cloning     │
│ • Yoast SEO Server Hooks (MU)    │ • Customer Dashboard Shortcode      │
│ • Indexable Link Builder Script  │ • Dell PowerEdge R640 Telemetry     │
│ • WP-CLI Scriptable CRUD         │ • Single Sign-On (SSO) Support      │
└──────────────────────────────────┴─────────────────────────────────────┘
```

### 3.1 Project Catalog & PRD Auto-Discovery
* **Dynamic Catalog Ingestion:** Parses `project_catalog.json` and scans `/home/thirzq/.openclaw/archive/` for newly added `*_PRD.md` files.
* **Metadata Extraction:** Automatically extracts core value propositions, target architectures, live domains (`*.nevatal.id`), container names, focus keywords, and tech stacks.
* **Cross-Device Project Support:** Ingests projects hosted on both the local machine (e.g., Uptime Medics, VoltQuest, Webisaurus) and the remote homelab (e.g., Nevatal Cloud, Quanta LMS, Recommendica, LeetBug).

### 3.2 AI Content Generation & Angle Rotation
* **Dynamic Angle Selection:** Rotates each project across four distinct editorial angles:
  1. *Architectural Deep-Dive:* System topology, protocol layers, async event loops, and database design.
  2. *Hands-On Tutorial & Quickstart:* Practical usage, API requests, and CLI walkthroughs.
  3. *Security, SSRF & Scalability Analysis:* Defense-in-depth, token bucket rate limits, and isolation boundaries.
  4. *Real-World Production Case Study:* Problem-solution narrative, benchmark metrics, and operational lessons.
* **Model Orchestration:** Employs an intelligent model fallback chain:
  - `meta-llama/llama-3.3-70b-instruct` (Primary technical writer)
  - `deepseek/deepseek-chat` (High-efficiency technical analyzer)
  - `google/gemini-2.5-flash` (Fast structured content generator)
  - `openrouter/auto` (Dynamic routing fallback)

### 3.3 Yoast SEO Resave & Indexing Engine
Standard WordPress REST API creation skips the Yoast admin indexing flow. The engine eliminates this through two synchronized mechanisms:
1. **Server-Side MU-Plugin (`yoast-meta-rest.php`):**
   - Intercepts `rest_after_insert_post` and `wp_after_insert_post`.
   - Populates `_yoast_wpseo_focuskw`, `_yoast_wpseo_metadesc`, and `_yoast_wpseo_title`.
   - Triggers `YoastSEO()->classes->get(Indexable_Builder::class)` to rebuild post records immediately.
2. **Containerized CLI Synchronization (`resave-yoast-posts.php`):**
   - Direct PHP execution inside the `wordpress` Docker container:
     ```bash
     docker exec wordpress php -d memory_limit=512M /var/www/html/resave-yoast-posts.php <post_id>
     ```
   - Enforces readability score of 90 and linkdex target score of 68–78.
   - Calculates reading time (220 words/minute).
   - Re-indexes incoming backlink counts (`incoming_link_count` in `wp_yoast_indexable`) across the entire published corpus.

### 3.4 Nevatal Cloud VPS Manager (`nevatal-cloud-manager`)
The remote WordPress plugin running on homelab bridges digital commerce with bare-metal virtualization:
* **WooCommerce Automatic Fulfillment:** Intercepts WooCommerce order status transitions (`wc-completed` or `wc-processing`). When a digital VPS item is purchased, dispatches a secure REST call to Nevatal Cloud API (`POST /api/v1/instances`).
* **Cloud-Init & Proxmox Orchestration:** Clones Debian/Ubuntu templates, assigns static or DHCP IP leases, injects the customer's public SSH key, sets resource quotas (vCPU, RAM, NVMe storage), and boots the instance.
* **Customer Dashboard Shortcode:** Embeds `[nevatal_instances]` into account pages, allowing clients to reboot, shut down, view live CPU/RAM metrics, and inspect SSH credentials.
* **Admin Health Panel:** Surfaces Dell PowerEdge R640 cluster health, storage pool allocations, and memory pressure directly in `wp-admin`.

---

## 4. Technical Specifications & REST Interfaces

### 4.1 WordPress Container Environment
* **Container Name:** `wordpress` (Image: `wordpress:latest`)
* **Nginx Cache Reverse Proxy:** `wordpress-cache` (Port `8085 -> 80`)
* **Database Container:** `wordpress-db` (`mysql:8.0`)
* **WordPress Path:** `/var/www/html`
* **MU-Plugins Directory:** `/var/www/html/wp-content/mu-plugins/`
* **Local REST Endpoint:** `http://localhost:8085/wp-json/wp/v2/`
* **Public Domain:** `https://wordpress.nevatal.id`

### 4.2 Authentication & Security
* **Authentication Method:** HTTP Basic Authentication using WordPress Application Passwords (`WP_USER:WP_APP_PASSWORD`).
* **Zero Plaintext Credentials in VCS:** Credentials managed strictly via `.env` and `openclaw.json`.
* **Safe Sandbox Restrictions:** File modifications inside WordPress container are scoped to `mu-plugins/` and cache scripts.

---

## 5. Automation & Scheduling

| Job Name | Schedule | Script / Command | Target Outcome |
|---|---|---|---|
| **Article Publishing Cron** | Every 3 Days (09:00 UTC) | `scripts/cron-auto-publish.sh` | Publishes 1 new SEO technical guide, executes per-post and batch Yoast resave |
| **PM2 Process Monitor** | Continuous Daemon | `pm2 start ecosystem.config.js` | Keeps scheduled tasks active with automatic crash restart |
| **Yoast SEO Audit** | Post-Publish & Weekly | `npm run resave-yoast` | Re-indexes all published articles and synchronizes internal link graph |
