# Final Weekend — Completed Work

## Summary
All P0 and P1 items from supervisor feedback addressed. System is end-to-end functional across three layers: Capture Layer → Mapping Layer → Composition Layer.

**Layer naming** (mosaic metaphor):
- **Capture Layer** — ingestion via Discord bot
- **Mapping Layer** (was "extraction layer") — embedding, UMAP, clustering, knowledge map visualization
- **Composition Layer** (was "generation layer") — faceted ideation engine, seed selection, progressive domain sculpting

---

## 1. Knowledge Map Redesign (P0)
- **Card nodes**: submissions render as titled cards (background tint = researcher color) that collapse to dots when zoomed out
- Gaussian-blurred soft cluster blobs with crisp subtle outline (replaced dashed convex polygons)
- Nearest-neighbor edges within clusters showing internal semantic structure
- Cluster labels: 13px bold, positioned at hull top
- Per-cluster pastel fill colors (Okabe-Ito derived, 8 distinct colors)
- Progressive semantic zoom: zoomed out shows cluster labels only → zoom in reveals node titles → further zoom shows submitter names
- Hover glow effect with node scale-up animation
- Drop shadows on nodes for depth
- Search with match count ("5 of 30 matching"), X to clear, glow highlights on matching nodes
- Papers distinguished by thin type ring around node
- Better tooltip with backdrop blur, structured layout, interaction hints
- Cluster labels repositioned to hull top, uppercase styling
- Instructions panel in sidebar
- Click background to deselect

## 2. Backfilling in Generation (P0)
- After locking a facet and filtering out non-matching ideas, the system auto-generates replacement ideas to maintain the target count
- New ideas satisfy all current constraints (seeds + all locked facets)
- New ideas are classified into existing facets before display
- Keeps the idea space populated as the user converges

## 3. LLM-level TF-IDF (P0)
- Concept frequency computed across the entire corpus
- Concepts appearing in <30% of submissions marked as "distinctive" for that article
- Detail panel shows "What Makes This Distinctive" section with orange-highlighted rare concepts
- Separate from general concepts list — helps researchers understand each submission's unique contribution

## 4. Reconnect — Save Ideas to Funnel (P0)
- "Save to Funnel" button in idea detail panel
- Creates a new submission of type `idea` in Supabase with:
  - Title and description from the generated idea
  - Grounding provenance (which seeds shaped it and how)
  - Facet path (the locked dimensions that led to this idea)
- Saved ideas appear on the knowledge map after next recompute
- Closes the generation → capture loop

## 5. Fuller Extraction (P1)
- Bumped text truncation from 4K to 8K characters across all extraction points:
  - `lib/concepts.ts` (concept tagging)
  - `lib/embeddings.ts` (tag generation)
  - `discord-bot/shared.ts` (bot-side concept extraction + embedding)
- More of each document's content is analyzed for semantic embedding and concept tagging

## 6. Person-Article Relationship (P1)
- Detail panel now shows "Other by [Name]" section
- Lists up to 5 other submissions by the same researcher
- Click-to-navigate between a person's submissions
- Shows how articles relate to a person's broader research trajectory

---

## Previously Completed (earlier sessions)

### Capture Layer
- Discord bot live on Railway (24/7)
- Slash commands: `/submit-link`, `/submit-note`, PDF auto-detection
- Works in channel + DMs
- Auto-creates profiles from Discord usernames
- Duplicate URL detection (same person rejected, different person allowed)
- Prompt injection defense in all LLM extraction prompts
- Knowledge Base Q&A via @mention / DM
- System prompt: no website links, clear usage walkthrough, cross-referencing submissions

### Extraction Layer
- Semantic embedding via Voyage AI (`voyage-3-lite`, 1024-dim)
- Concept tagging via DeepSeek (1 broad + 1-2 specific, reuses existing labels)
- UMAP dimensionality reduction (1024-dim → 2D, preserves semantic distances)
- K-means clustering (replaced DBSCAN — always assigns every point to a cluster)
- Cluster auto-labeling via DeepSeek (2-4 word thematic labels)
- All extraction runs automatically on each Discord submission (fire-and-forget)
- Projection results cached in `projection_cache` for instant map loading

### Generation Layer
- Idea Explorer (`/explore`) with faceted search engine
- Seeds loaded from knowledge map via Shift+click multi-select
- Each seed provides title + first 300 chars of body as LLM context
- Explicit diverge/converge separation in prompts:
  - Orange seeds (from map) = diverge (creative inspiration)
  - Green locked facets = converge (hard constraints)
- Facet discovery: LLM infers 4-5 categorical/ordinal dimensions
- Classification: each idea assigned to 1+ values per facet
- Progressive domain sculpting: lock → filter → new facet discovered → backfill
- Grounding/provenance: each idea explicitly references which seeds shaped it
- Duplicate title deduplication
- Save to Funnel closes the loop

### Infrastructure
- Web app: Next.js 16 on Vercel
- Discord bot: Node.js on Railway
- Database: Supabase (PostgreSQL + pgvector)
- Storage: Supabase Storage (PDFs)
- LLMs: DeepSeek (extraction, labeling, generation) + Voyage AI (embeddings)
- D3.js for map visualization

---

## Latest Session Additions

### Knowledge Map → Card Nodes with Semantic Zoom
- Nodes are titled cards with researcher color background tint
- Cards collapse to colored dots when zoomed out (threshold: zoom < 2x)
- Submitter names appear at higher zoom (> 2.5x)
- Smooth transition between card and dot modes

### Soft Cluster Regions
- Gaussian-blurred background blobs replace dashed convex hulls
- Soft organic feel with crisp subtle outline on top
- Per-cluster colors from colorblind-safe palette

### Nearest-Neighbor Edges
- Faint connecting lines between nearest neighbors within each cluster
- Shows internal semantic structure (which papers are closest to each other)
- Visible only when zoomed in (> 1.2x) to avoid clutter at overview level

### Composition Layer Layout Redesign
- Pitch detail panel rendered below facet columns (was: right sidebar)
- Seeds are collapsible (click to expand/collapse)
- Everything centered with max-width 1100px for focused tool area
- Facet columns shrink when detail panel is open (35vh) for screen efficiency
- Renamed: "Idea Explorer" → "Composition" in header
- Selection bar on map: "Explore Ideas" → "Compose"

### Pitch Tone
- Generation prompt updated to use suggestive language
- Ideas framed as "directions worth exploring" not finished projects
- Titles styled as concept names, not paper titles

### Merge Distinctive + Regular Concepts
- "What Makes This Distinctive" shows rare concepts (orange highlight)
- Regular "Concepts" section shows all concepts
- Both visible in submission detail panel on knowledge map
