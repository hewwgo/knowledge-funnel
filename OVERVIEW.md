# Knowledge Funnel — Project Overview

## What Is This?

The Knowledge Funnel (working title: **Twin Agent Incubator**) is a research collaboration platform. Researchers in a workgroup submit papers, links, notes, and ideas into a shared knowledge pool. The funnel operates in **cycles** — timed collection phases where material is gathered, then converged into research pitches by AI twin agents.

This is the **data collection layer**. The value comes downstream — how LLMs process, cross-pollinate, and synthesize the collected material into novel research directions.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐
│   Web UI         │     │   Discord Bot     │
│   (Next.js)      │     │   (discord.js)    │
│                  │     │                   │
│  PDF / URL /     │     │  /submit-link     │
│  Text upload     │     │  /submit-note     │
│                  │     │  PDF attachments   │
└───────┬──────────┘     └───────┬───────────┘
        │                        │
        │   ┌────────────────┐   │
        └──►│   Supabase     │◄──┘
            │                │
            │  submissions   │
            │  profiles      │
            │  cycles        │
            │  pitches       │
            │  storage       │
            └───────┬────────┘
                    │
            ┌───────▼────────┐
            │  LLM Pipeline  │
            │  (DeepSeek)    │
            │                │
            │  Metadata      │
            │  extraction    │
            └────────────────┘
```

Multiple ingestion routes ("tentacles") feed the same Supabase backend. The web UI and Discord bot are independent frontends for the same data.

## Database Schema

| Table | Purpose |
|-------|---------|
| `cycles` | Collection periods (7-day phases: collecting → converging → complete) |
| `profiles` | Researcher metadata (name, institution, focus, style, discord_id) |
| `submissions` | Core data — papers, links, notes, ideas with LLM-extracted metadata |
| `pitches` | Module 2 — AI-generated research pitches from converged submissions |

Storage: `funnel-uploads` bucket in Supabase Storage for PDFs.

### Key Columns

- `profiles.discord_id` — Links a Discord account to a profile (unique). Enables cross-platform identity between web UI and Discord bot.
- `submissions.content_type` — One of: `paper`, `link`, `note`, `idea`
- `submissions.file_path` — Storage path for uploaded PDFs

### Content Types

- **paper** — PDF upload with extracted title/abstract/keywords
- **link** — URL with fetched + LLM-extracted metadata
- **note** — Free-text research note
- **idea** — Thought/comment (often in response to a paper)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, Tailwind v4 |
| Backend | Next.js API routes (server-side) |
| Database | Supabase (PostgreSQL) |
| File Storage | Supabase Storage |
| LLM | DeepSeek via OpenAI-compatible API |
| Notifications | Discord webhooks |
| Discord Bot | discord.js v14 (Node.js, separate service) |
| Visual | OGL (WebGL wormhole animation) |

## Data Flow

### Web UI Path
1. User selects input mode (PDF / URL / Text)
2. PDF → uploaded to Supabase Storage → `/api/upload` extracts text + LLM metadata
3. URL → `/api/upload-url` fetches page → strips HTML → LLM extraction
4. Text → direct entry
5. User reviews/edits extracted metadata
6. Submit → `/api/submissions` POST → inserts into Supabase → Discord webhook notification

### Discord Bot Path
1. User runs slash command or uploads PDF in the designated channel
2. Bot auto-creates or links their profile (by matching Discord display name to web profile name, or by `discord_id`)
3. Same LLM extraction pipeline (DeepSeek) for URLs and PDFs
4. Inserts directly into Supabase `submissions` table
5. Confirms back to user with an embed in the channel

### Profile Identity

Discord and web submissions are unified under one profile:
1. First submission: bot checks `discord_id` → then tries name match → creates new profile if no match
2. If name-matched, the `discord_id` is auto-linked for future lookups
3. No manual profile linking needed — zero friction for users

## Discord Bot Details

### Slash Commands

| Command | Description |
|---------|-------------|
| `/submit-link` | Submit a URL (with optional comment) — fetches page, extracts metadata via LLM |
| `/submit-note` | Submit a text note or idea |
| `/funnel-status` | Show current cycle stats (items, contributors, cycle number) |
| `/my-submissions` | List your submissions in the current cycle |

### PDF Auto-Detection

Drop a PDF in the channel → bot downloads it, uploads to Supabase Storage, extracts text with `unpdf`, runs LLM metadata extraction, creates a `paper` submission. No slash command needed.

### Channel Confinement

The bot is locked to a single channel via `DISCORD_CHANNEL_ID`:
- Slash commands in other channels get an ephemeral redirect message
- PDF detection silently ignores other channels
- This keeps the bot from interfering with other server activity

### Single-Instance Guard

A PID file (`bot.pid`) prevents multiple bot instances from running simultaneously. On startup, the bot checks if another instance is alive and refuses to start if so. Graceful shutdown handlers clean up the PID file and disconnect from Discord.

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/profiles` | GET | Fetch all researchers |
| `/api/submissions` | GET | Get submissions for a profile in current cycle |
| `/api/submissions` | POST | Create submission + Discord notification |
| `/api/upload` | POST | Extract metadata from uploaded PDF |
| `/api/upload-url` | POST | Fetch URL + extract metadata |
| `/api/discord-notify` | POST | Send Discord webhook |
| `/api/funnel-status` | GET | Cycle metrics (items, contributors, days remaining) |

## Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# LLM (DeepSeek)
DEEPSEEK_API_KEY=your-deepseek-key

# Discord (webhook for notifications from web UI)
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...

# Discord Bot (separate service)
DISCORD_BOT_TOKEN=your-bot-token
DISCORD_CHANNEL_ID=your-channel-id
```

## Project Structure

```
knowledge-funnel/
├── app/
│   ├── api/                # Server endpoints
│   │   ├── submissions/    # CRUD for submissions
│   │   ├── profiles/       # Researcher profiles
│   │   ├── upload/         # PDF metadata extraction
│   │   ├── upload-url/     # URL metadata extraction
│   │   ├── discord-notify/ # Webhook sender
│   │   └── funnel-status/  # Cycle metrics
│   ├── page.tsx            # Main UI
│   ├── layout.tsx          # Root layout
│   └── globals.css         # Styles
├── components/
│   ├── SubmissionForm.tsx   # Main input form (PDF/URL/Text)
│   ├── SubmissionList.tsx   # User's submissions display
│   ├── FunnelStatus.tsx     # Cycle status bar
│   └── VoidFunnel.tsx       # WebGL wormhole background
├── lib/
│   ├── supabase.ts          # Supabase client (anon + admin)
│   ├── discord.ts           # Discord webhook helper
│   └── llm.ts               # DeepSeek LLM extraction
├── discord-bot/             # Discord bot (separate service)
│   ├── bot.ts               # Entry point + PID lock + event handlers
│   ├── commands.ts          # Slash command definitions (4 commands)
│   ├── handlers.ts          # Command + PDF attachment handlers
│   ├── shared.ts            # Supabase + LLM clients (shared logic)
│   ├── register-commands.ts # One-time slash command registration script
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
├── supabase-schema.sql      # Database schema
├── OVERVIEW.md              # This file
└── package.json             # Web UI dependencies
```

## Roadmap

- [x] Module 1: Data collection (Web UI)
- [x] Discord webhook notifications
- [x] Discord bot ingestion (slash commands + PDF auto-detect)
- [x] Cross-platform profile identity (discord_id auto-linking)
- [x] Channel confinement + single-instance guard
- [ ] Module 2: Twin agent convergence (LLM pipeline → pitches)
- [ ] Module 3: Feedback loop (researchers review pitches)

## Setup

### Web UI
1. `npm install`
2. Copy `.env.local.example` to `.env.local` and fill in Supabase + DeepSeek keys
3. Run the SQL in `supabase-schema.sql` in Supabase SQL editor
4. `npm run dev`

### Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** → name it (e.g., "Vacuum Bot")
3. Go to **Bot** tab → click **Reset Token** → copy the token
4. Enable **Message Content Intent** under Privileged Gateway Intents
5. Go to **OAuth2** → **URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Embed Links`, `Attach Files`, `Read Message History`, `Use Slash Commands`
6. Copy the generated URL → send to server admin → they authorize the bot
7. Right-click the target channel → Copy Channel ID (enable Developer Mode in Discord settings if needed)
8. Copy `discord-bot/.env.example` to `discord-bot/.env` and fill in:
   - `DISCORD_BOT_TOKEN` — from step 3
   - `DISCORD_CHANNEL_ID` — from step 7
   - Supabase + DeepSeek keys (same as web UI)
9. Register slash commands: `cd discord-bot && npm install && npm run register`
10. Start the bot: `npm run start`

### Switching Servers / Channels

1. Update `DISCORD_CHANNEL_ID` in `discord-bot/.env`
2. Have the new server admin authorize via the OAuth2 invite URL
3. Re-register commands: `npm run register`
4. Restart: kill existing bot, then `npm run start`
