# Final Weekend — Completed Work

## This Session Summary

Major visual and interaction overhaul of the Mapping Layer, plus Composition Layer refinements. The knowledge map went from a basic scatter plot to a proper interactive knowledge graph with concept hub nodes, document-shaped icons, semantic zoom across three levels, and a floating toolbar. The Composition Layer got divergent pitch tone, backfilling, and the reconnect loop. Layer naming finalized around the mosaic metaphor.

**Key achievements this session:**
- Knowledge map completely redesigned — concept hubs as primary structure, document icons, 3-level semantic zoom
- Floating centered toolbar with search, researcher filter, k-means toggle
- Composition Layer pitches rewritten for true divergence (not formulaic)
- Backfilling after lock-in, save-to-funnel loop
- Concept distinctiveness (TF-IDF intuition) merged into single inline view
- Layer naming: Capture → Mapping → Composition

---

## Layer Naming (mosaic metaphor)
- **Capture Layer** — ingestion via Discord bot
- **Mapping Layer** (was "extraction layer") — embedding, UMAP, clustering, knowledge map visualization
- **Composition Layer** (was "generation layer") — faceted ideation engine, seed selection, progressive domain sculpting

---

## Mapping Layer — Complete Redesign

### Concept Hub Network
- Shared concepts (3+ submissions) become grey circle hub nodes positioned at centroid of member submissions
- Hub-to-submission spoke edges show why papers cluster together
- Hubs are clickable: click to highlight connected nodes + edges, click again to deselect
- Hub labels scale with zoom (more text revealed as you zoom in, 16→40 chars)
- Hub circles: 2px stroke at 35% opacity, solid black text — prominent landmarks

### Document-Shaped Nodes
- Papers/links: small portrait page icon (22x28px) with folded corner + faux text lines inside
- Notes/ideas: rounded sticky note shape with color tint + dashed border
- Title text positioned ABOVE the icon, submitter name BELOW
- Title length scales with zoom: ~30 chars at 1.5x, up to 80 chars at high zoom
- Font size scales inversely (bigger text when zoomed in)
- Submitter names appear at zoom 1.8x

### 3-Level Semantic Zoom
- **Overview (k < 0.65)**: Concept hubs bold as landmarks, no submission nodes visible
- **Mid zoom (0.65–1.5)**: Colored dots for submissions, hub spoke edges visible, hubs at normal weight
- **Detail zoom (1.5+)**: Document icons replace dots, titles + submitter names visible

### K-Means Clusters
- Removed k-means colored blobs and labels from default view
- K-means available as optional toggle ("Toggle k-means clusters" in toolbar)
- When toggled on: dashed colored hull outlines + cluster labels appear as overlay
- Toggling does NOT reset concept hub highlights or zoom position
- K-means still powers the pipeline (spatial grouping), concept hubs provide the visible structure

### Floating Toolbar
- Centered at top of canvas with glass-morphism background
- Single row: Tessera brand → stats (submissions, authors, clusters) → search → Researchers dropdown → Toggle k-means → Recompute
- Search expands on focus
- Researcher filter as persistent dropdown (stays open while toggling)
- Detached from page chrome — floats over the map

### Concept Distinctiveness (TF-IDF Intuition)
- Merged distinctive and regular concepts into one inline view
- Rare concepts highlighted orange, common ones in grey
- Small annotation: "Orange = rare in corpus (distinctive to this submission)"
- Follows TF-IDF intuition at concept level rather than term level

### Other Map Improvements
- Full-screen canvas — no sidebar borders cutting into the map
- Detail panel floats top-right with glass background (340px wide, no horizontal scroll)
- Hub spoke edges subtle (0.08 opacity) to avoid visual clutter
- Click background to deselect all
- Landing page redirects to /map

---

## Composition Layer Improvements

### Pitch Tone — True Divergence
- System prompt completely rewritten as "creative research provocateur"
- Seeds framed as springboards, not boundaries ("go BEYOND these")
- Every description starts differently (questions, provocations, scenarios, proposals)
- No more formulaic "A promising direction..." openings
- Grounding must state the specific leap taken from each seed

### Double Diamond Workflow
- Orange seeds (from map) = DIVERGE (creative inspiration)
- Green locked facets = CONVERGE (hard constraints)
- System diverges with idea generation + facet discovery
- User converges by locking dimensions
- System diverges again with backfilling + new facet
- Repeat: progressively refining the idea space

### Backfilling
- After locking a facet filters out ideas, system auto-generates replacements
- New ideas satisfy all current constraints (seeds + locked facets)
- New ideas classified into existing facets before display
- Maintains target idea count through the converge/diverge cycle

### Reconnect — Save to Funnel
- "Save to Funnel" button in idea detail panel
- Creates submission of type 'idea' with title, description, grounding, facet path
- Saved ideas appear on knowledge map after next recompute
- Closes the composition → capture loop

### Layout
- Detail panel below facet columns (not right sidebar)
- Seeds collapsible, everything centered (max-width 1100px)
- Facet columns shrink when detail panel open

### Other
- Empty facet values hidden (no empty buckets)
- Duplicate title deduplication
- Title stored with full text, displayed progressively

---

## Previously Completed (earlier sessions)

### Capture Layer
- Discord bot on Railway (24/7): /submit-link, /submit-note, PDF auto-detection
- Works in channel + DMs, auto-creates profiles
- Duplicate URL detection (same person rejected, different person allowed)
- Knowledge Base Q&A via @mention / DM
- Prompt injection defense

### Extraction Pipeline
- Semantic embedding via Voyage AI (voyage-3-lite, 1024-dim, 8K char input)
- Concept tagging via DeepSeek (1 broad + 1-2 specific, reuses existing labels)
- UMAP projection (1024-dim → 2D)
- K-means clustering (k scales with dataset size)
- Cluster auto-labeling via DeepSeek
- All extraction runs automatically on each Discord submission

### Infrastructure
- Web app: Next.js 16 on Vercel
- Discord bot: Node.js on Railway
- Database: Supabase (PostgreSQL + pgvector)
- Storage: Supabase Storage (PDFs)
- LLMs: DeepSeek (extraction, labeling, generation) + Voyage AI (embeddings)
- D3.js for map visualization
