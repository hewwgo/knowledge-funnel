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
| `profiles` | Researcher metadata (name, institution, focus, style) |
| `submissions` | Core data — papers, links, notes, ideas with LLM-extracted metadata |
| `pitches` | Module 2 — AI-generated research pitches from converged submissions |

Storage: `funnel-uploads` bucket in Supabase Storage for PDFs.

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
| Discord Bot | discord.js (Node.js, separate service) |
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
1. User runs slash command or uploads PDF in designated channel
2. Bot processes input (URL fetch, PDF download, or direct text)
3. Same LLM extraction pipeline (DeepSeek)
4. Inserts directly into Supabase `submissions` table
5. Confirms back to user in Discord

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
│   ├── bot.ts               # Main bot entry point
│   ├── commands.ts          # Slash command definitions
│   ├── handlers.ts          # Command + message handlers
│   ├── shared.ts            # Supabase + LLM clients (shared logic)
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
- [ ] Discord bot ingestion (another tentacle)
- [ ] Module 2: Twin agent convergence (LLM pipeline → pitches)
- [ ] Module 3: Feedback loop (researchers review pitches)

## Setup

### Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** → name it (e.g., "Knowledge Funnel Bot")
3. Go to **Bot** tab → click **Reset Token** → copy the token
4. Enable **Message Content Intent** under Privileged Gateway Intents
5. Go to **OAuth2** → **URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Embed Links`, `Attach Files`, `Read Message History`, `Use Slash Commands`
6. Copy the generated URL → open it → invite the bot to your server
7. Right-click the target channel → Copy Channel ID (enable Developer Mode in Discord settings if needed)
8. Set `DISCORD_BOT_TOKEN` and `DISCORD_CHANNEL_ID` in `discord-bot/.env`
9. `cd discord-bot && npm install && npm run dev`
