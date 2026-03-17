# PRD: Knowledge Map — Twin Agent Incubator

## Context

This is a feature for the **Twin Agent Incubator**, a research system for structured research ideation through person-representing agent convergence. The system is part of a UIST 2026 short paper submission.

The Incubator has three modules:
1. **Knowledge Funnel** — researchers submit documents (papers, notes, links) throughout the week. These are decomposed into semantic fragments and stored.
2. **Pairing & Convergence** — twin agents (soft professional representations of individual researchers) are paired based on knowledge graph overlap and run through structured convergence rounds to produce research pitches.
3. **Output & Feedback** — pitches are surfaced to the real researchers for evaluation.

**The Knowledge Map is the visual, interactive layer that sits on top of the Knowledge Funnel.** It makes the group's collective intellectual landscape navigable, reveals latent connections between researchers, and provides transparency into how the system models each person's knowledge (which drives the pairing engine). The map is both a sensemaking tool and an active input mechanism for convergence.

---

## Existing Stack

- **Framework:** Next.js (App Router)
- **Hosting:** Vercel
- **Database:** Supabase (PostgreSQL + pgvector)
- **Auth:** Supabase Auth (researchers sign in, each has a profile)
- **LLM:** OpenAI API (used for document decomposition, tagging, agent dialogue)
- **Styling:** Tailwind CSS
- **Current state:** The Knowledge Funnel (Module 1) is built and deployed. Researchers can submit documents. Documents are decomposed into fragments and stored with embeddings.

---

## Data Model

### Existing tables (already in Supabase)

```sql
-- Researcher profiles
profiles (
  id uuid PRIMARY KEY,
  name text,
  role text,
  institution text,
  research_focus text,
  created_at timestamptz
)

-- Submitted documents
documents (
  id uuid PRIMARY KEY,
  submitter_id uuid REFERENCES profiles(id),
  title text,
  source_url text,
  raw_text text,
  submitted_at timestamptz
)

-- Decomposed knowledge fragments
fragments (
  id uuid PRIMARY KEY,
  document_id uuid REFERENCES documents(id),
  submitter_id uuid REFERENCES profiles(id),
  content text,                    -- the actual text chunk
  embedding vector(1536),         -- OpenAI ada-002 embedding
  created_at timestamptz
)
```

### New tables / columns needed

```sql
-- Add auto-generated tags to fragments
-- (alternative: store as JSONB array column on fragments)
fragment_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fragment_id uuid REFERENCES fragments(id) ON DELETE CASCADE,
  tag text,                        -- e.g. "evaluation methods", "authorship", "generative AI"
  confidence float                 -- LLM confidence score 0-1
)

-- Projection cache — stores the 2D coordinates after UMAP runs
-- Recomputed per cycle, not live
projection_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fragment_id uuid REFERENCES fragments(id) ON DELETE CASCADE,
  x float NOT NULL,
  y float NOT NULL,
  cluster_id integer,              -- HDBSCAN cluster assignment (-1 = noise)
  computed_at timestamptz DEFAULT now()
)

-- Cluster labels — auto-generated summaries for each theme region
cluster_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id integer NOT NULL,
  label text,                      -- e.g. "authorship + agency"
  representative_fragment_ids uuid[], -- the 3-5 fragments closest to cluster centroid
  computed_at timestamptz DEFAULT now()
)

-- User interactions with the map (feeds back into pairing engine)
map_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id),
  interaction_type text,           -- 'flag_connection' | 'dispute_placement' | 'seed_convergence'
  payload jsonb,                   -- flexible: { fragment_ids: [...], note: "..." }
  created_at timestamptz DEFAULT now()
)
```

### Index needed for spatial queries
```sql
CREATE INDEX idx_projection_cache_coords ON projection_cache (x, y);
CREATE INDEX idx_projection_cache_cluster ON projection_cache (cluster_id);
CREATE INDEX idx_fragment_tags_tag ON fragment_tags (tag);
```

---

## Backend: API Routes

All routes go in `app/api/`. They are Vercel serverless functions.

### 1. `POST /api/map/compute`

**Triggers a full recomputation of the projection.** Called manually or on a cron schedule (e.g. after each weekly funnel cycle).

Pipeline:
1. Fetch all fragments + embeddings from Supabase
2. Run UMAP projection (high-dimensional embeddings → 2D coordinates)
3. Run HDBSCAN clustering on the 2D points
4. For each cluster, select 3-5 representative fragments (closest to centroid) and call OpenAI to generate a 2-4 word label from their content
5. Generate tags for any untagged fragments (batch LLM call)
6. Write results to `projection_cache`, `cluster_labels`, and `fragment_tags`

**Technical notes:**
- Use the `umap-js` npm package for UMAP (pure JS, runs in serverless). If performance is an issue at scale, consider a Python runtime via Vercel's Python support, but for <500 fragments JS is fine.
- For HDBSCAN: use `hdbscanjs` or implement a simpler DBSCAN in JS. HDBSCAN is preferred because it handles variable density and doesn't require a preset cluster count. If no good JS HDBSCAN lib exists, DBSCAN with a reasonable epsilon (calibrated from the UMAP output spread) is acceptable.
- UMAP parameters to start with: `{ nNeighbors: 15, minDist: 0.1, nComponents: 2, metric: 'cosine' }`. These may need tuning — `nNeighbors` controls local vs global structure (higher = more global), `minDist` controls how tightly points pack.
- The Vercel function may need a longer timeout for this route (up to 60s). Configure in `vercel.json`:
  ```json
  { "functions": { "app/api/map/compute/route.ts": { "maxDuration": 60 } } }
  ```

**Request:** `POST /api/map/compute` (no body, authenticated admin only)
**Response:** `{ success: true, fragmentCount: number, clusterCount: number }`

### 2. `GET /api/map/data`

**Returns the full map state for the frontend.**

Joins `fragments`, `projection_cache`, `cluster_labels`, `fragment_tags`, and `profiles` to return a single payload.

**Response shape:**
```typescript
{
  fragments: Array<{
    id: string
    content: string           // the text chunk (truncated to ~200 chars for overview)
    fullContent: string       // full text for detail view
    submitterId: string
    submitterName: string
    submitterColor: string    // assigned per-researcher for visual coding
    documentTitle: string
    x: number                 // UMAP projection coordinate
    y: number
    clusterId: number | null  // -1 or null = unclustered
    tags: string[]
    createdAt: string
  }>
  clusters: Array<{
    id: number
    label: string
    centroidX: number         // average x of members
    centroidY: number         // average y of members
    memberCount: number
    submitterIds: string[]    // which researchers have fragments in this cluster
  }>
  researchers: Array<{
    id: string
    name: string
    color: string             // consistent color assignment
    fragmentCount: number
  }>
  computedAt: string          // when projection was last run
}
```

**Color assignment:** Assign each researcher a color from a perceptually distinct palette. Store this mapping either in the `profiles` table (add a `map_color` column) or compute deterministically from researcher index. Use a colorblind-safe palette (e.g. Okabe-Ito or a curated set of 8-10 colors).

### 3. `POST /api/map/interact`

**Records a researcher interaction with the map.**

Used for: flagging connections, disputing placements, seeding convergences.

**Request body:**
```typescript
{
  type: 'flag_connection' | 'dispute_placement' | 'seed_convergence'
  fragmentIds: string[]        // relevant fragment IDs
  note?: string                // optional researcher annotation
  targetClusterId?: number     // for dispute: "this should be in cluster X"
}
```

**Response:** `{ success: true, interactionId: string }`

These interactions are stored in `map_interactions` and surfaced to the pairing engine. For the paper scope, it's sufficient that these are logged and available — we don't need to close the feedback loop in the pairing algorithm yet, but we need to demonstrate that the architecture supports it.

### 4. `GET /api/map/fragment/:id`

**Returns full detail for a single fragment.** Used when a researcher clicks a node.

**Response:**
```typescript
{
  id: string
  content: string             // full text
  submitterName: string
  documentTitle: string
  documentUrl: string | null
  tags: string[]
  clusterId: number | null
  clusterLabel: string | null
  nearestNeighbors: Array<{   // 3-5 closest fragments by embedding distance
    id: string
    content: string           // truncated
    submitterName: string
    distance: number
  }>
}
```

The `nearestNeighbors` field is important — it lets a researcher see what's semantically adjacent to a given fragment, even across submitters. This is where latent connections become visible at the individual level.

---

## Frontend: The Map Component

### File structure
```
app/
  map/
    page.tsx                  -- the map page (fetches data, manages state)
    components/
      KnowledgeMap.tsx        -- main canvas component (D3-based)
      MapControls.tsx         -- filter panel (researcher toggles, tag filters, search)
      FragmentDetail.tsx      -- slide-out panel when a node is clicked
      ClusterLabel.tsx        -- floating label component for theme regions
      InteractionModal.tsx    -- modal for flag/dispute/seed actions
      PairingTrace.tsx        -- overlay showing why two researchers were paired
```

### Main canvas: `KnowledgeMap.tsx`

Uses D3 for rendering and interaction. Specifically:
- `d3-zoom` for pan and semantic zoom
- `d3-force` is NOT needed (positions come from UMAP, not a force layout)
- SVG-based rendering (for the group size of 5-15 researchers and <500 fragments, SVG performs fine — no need for Canvas/WebGL)

**Rendering layers (bottom to top):**
1. **Cluster hulls** — convex hulls (or alpha shapes) drawn around fragments sharing a `clusterId`. Filled with a very light tint. These define the "theme regions."
2. **Fragment nodes** — small circles (r=4-6px default). Colored by submitter. Opacity varies: full opacity for active/filtered, reduced for context.
3. **Cluster labels** — positioned at cluster centroids. Text labels (the auto-generated 2-4 word summaries). These should scale with zoom: visible at medium zoom, hidden when zoomed all the way out (where only hulls matter) or all the way in (where individual fragments matter).
4. **Interaction overlays** — pairing traces, flagged connections, etc. Drawn on top.

**Zoom behavior (semantic zoom):**
- **Zoomed out (overview):** See colored cluster regions with labels. Individual nodes are small dots. Good for "what does our group's landscape look like?"
- **Mid zoom:** Nodes become distinguishable. Hovering shows a tooltip with truncated content and submitter name. Cluster labels still visible.
- **Zoomed in:** Nodes are large enough to click. Content preview appears next to each node without hovering. This is the reading/inspection level.

Scale the node radius and label visibility with zoom level using D3's zoom transform.

**Interaction handlers:**
- **Hover node:** Show tooltip (content preview, submitter, tags)
- **Click node:** Open `FragmentDetail` panel. Fetch `/api/map/fragment/:id` for full info including nearest neighbors.
- **Click cluster hull/label:** Highlight all fragments in that cluster. Show a summary panel with the cluster label, member count, and which researchers contributed.
- **Right-click or long-press node:** Open context menu with "Flag connection", "Dispute placement", "Seed convergence" options → opens `InteractionModal`.

### Filter panel: `MapControls.tsx`

Positioned as a sidebar or floating panel (left side preferred).

**Controls:**
- **Researcher toggles:** A list of all researchers with their assigned color swatch. Click to toggle visibility on/off. When a researcher is toggled off, their fragments become very faint (opacity 0.1) rather than disappearing — this preserves spatial context.
- **Tag filter:** Dropdown or chip-select of all unique tags. Selecting a tag highlights only fragments with that tag. Multiple tags = union (show fragments matching any selected tag).
- **Search:** Text input. Filters fragments by content match (client-side fuzzy search on the truncated content field). Matching nodes pulse or enlarge.
- **Time range:** Optional slider to filter by submission date. Useful for seeing how the knowledge landscape evolved over the study period.
- **"Show pairings" toggle:** When active, draws lines between fragments that contributed to agent pairings (if pairing data is available). This is the transparency layer.

### Fragment detail panel: `FragmentDetail.tsx`

Slides in from the right when a node is clicked.

**Contents:**
- Full text of the fragment
- Source document title (linked if URL available)
- Submitter name + color badge
- Tags (as chips)
- Cluster membership + label
- **Nearest neighbors list:** 3-5 most semantically similar fragments, each showing: truncated content, submitter name, and a "show on map" button that highlights that fragment's position. This is the key discovery mechanism — "your fragment about evaluation methods is closest to Maria's fragment about user study design."
- **Action buttons:** "Flag connection", "Dispute placement", "Seed convergence"

### Interaction modal: `InteractionModal.tsx`

Simple form that collects:
- Interaction type (pre-selected based on how it was triggered)
- Selected fragment IDs (pre-populated)
- Free text note from the researcher
- Submit → calls `POST /api/map/interact`

---

## Design System

Follow the project's established aesthetic:
- **Base:** `#ffffff`
- **Primary/system color:** `#262624`
- **Human input elements:** `#fff4eb` background, `#d4a574` accent/border
- **Font:** Inter
- **Borders:** 1.5px solid, zero border-radius
- **Overall feel:** Academic, minimal, sharp

**Map-specific design:**
- Fragment nodes use the researcher's assigned color (from a colorblind-safe palette)
- Cluster hulls use a very light wash (10% opacity) of a neutral gray — they should feel like paper regions, not colored zones
- Cluster labels are small, uppercase, letter-spaced, in `#262624` at ~70% opacity
- The detail panel uses the human-input warm background (`#fff4eb`) to distinguish it from the map canvas
- Tooltips: solid `#262624` background, white text, sharp corners, no shadow

---

## Implementation Priorities

For the UIST paper scope, we need a functional system that the research group can use during a ~1 week study. Not everything needs to be polished, but the core loop must work.

### P0 — Must have (paper contribution depends on these)
- [ ] `/api/map/compute` endpoint (UMAP + clustering + labeling pipeline)
- [ ] `/api/map/data` endpoint
- [ ] `KnowledgeMap.tsx` with zoom, pan, colored nodes, cluster hulls and labels
- [ ] `MapControls.tsx` with researcher toggles and tag filter
- [ ] `FragmentDetail.tsx` with nearest neighbors
- [ ] Fragment tagging during funnel ingestion (add to existing decomposition pipeline)

### P1 — Should have (strengthens the paper but not blocking)
- [ ] Map interaction logging (`/api/map/interact` + `InteractionModal`)
- [ ] Pairing trace visualization (showing why agents were paired)
- [ ] Search within map
- [ ] Time range filter

### P2 — Nice to have (future work / if time permits)
- [ ] "Seed convergence" actually feeding into the pairing engine
- [ ] Animated transitions when toggling filters
- [ ] Fragment dispute actually triggering re-embedding
- [ ] Export map as SVG/image for the paper figures

---

## Compute Pipeline Detail

For the `/api/map/compute` route, here's the step-by-step:

```
1. FETCH all fragments from Supabase
   → SELECT id, content, embedding, submitter_id FROM fragments

2. TAG untagged fragments
   → For each fragment without tags:
     Call OpenAI: "Given this text fragment from an academic context,
     generate 2-4 short topic tags (2-3 words each). Return as JSON array."
   → Batch these calls (Promise.all in chunks of 10)
   → Insert into fragment_tags

3. EXTRACT embedding matrix
   → Convert fragment embeddings to a 2D array: float[n][1536]

4. RUN UMAP
   → umap-js: new UMAP({ nNeighbors: 15, minDist: 0.1, nComponents: 2 })
   → umap.fit(embeddingMatrix)
   → Returns float[n][2] — the 2D coordinates

5. NORMALIZE coordinates
   → Scale x,y to [0, 1000] range for consistent viewport mapping

6. RUN CLUSTERING
   → HDBSCAN or DBSCAN on the 2D coordinates (NOT the original embeddings —
     cluster in projection space so visual clusters match algorithmic clusters)
   → Returns cluster assignments: int[n] where -1 = noise/unclustered

7. COMPUTE cluster metadata
   → For each cluster: centroid (mean x,y), member count, set of submitter_ids
   → Select 3-5 representative fragments (closest to centroid by Euclidean distance in 2D)

8. GENERATE cluster labels
   → For each cluster, send representative fragment contents to OpenAI:
     "These text fragments form a thematic cluster in a research group's
     knowledge base. Generate a 2-4 word label that captures the shared theme.
     Return only the label, nothing else."

9. WRITE to database
   → Upsert projection_cache (delete old entries, insert new)
   → Upsert cluster_labels
   → Insert any new fragment_tags

10. RETURN summary stats
```

---

## Notes for Implementation

- **UMAP determinism:** UMAP is stochastic. For consistency between recomputations (so the map doesn't wildly rearrange), set a fixed `random` seed in the UMAP config. This means the layout evolves incrementally as new fragments are added rather than reshuffling entirely.
- **Embedding model:** Use the same embedding model already used in the funnel (presumably `text-embedding-ada-002` or `text-embedding-3-small`). Don't mix models.
- **Fragment size:** The decomposition step in Module 1 should produce fragments of roughly paragraph-length (100-300 words). Too small and the tags are meaningless; too large and the map becomes coarse.
- **Supabase pgvector:** The embeddings are already stored with pgvector. For the nearest neighbors query in `/api/map/fragment/:id`, use pgvector's `<=>` cosine distance operator:
  ```sql
  SELECT id, content, submitter_id,
         1 - (embedding <=> target_embedding) as similarity
  FROM fragments
  WHERE id != target_id
  ORDER BY embedding <=> target_embedding
  LIMIT 5
  ```
- **Error states:** The map should handle: no fragments yet (empty state with "Submit documents to populate the map"), projection not yet computed (prompt to run compute), and single-researcher (map works but clusters are less meaningful — note this in the UI).

---

## Research Justification

This feature is framed in the paper as **Collective Knowledge Cartography**: making the latent intellectual structure of a research group navigable and actionable.

**Key arguments:**
1. The same embedding space that drives agent pairing becomes a transparency layer — researchers can inspect the system's model of their knowledge.
2. The map reveals connections that social structures hide (different subgroups, different meeting schedules, different project affiliations).
3. Researcher interactions with the map (flagging, disputing, seeding) create a feedback loop that improves agent grounding over time.

**Evaluation hooks:**
- Did the map reveal connections researchers didn't know about? (post-study interview)
- Did researchers modify their submissions after seeing the map? (log analysis)
- Did flagged connections correlate with higher-rated pitches? (cross-reference with pitch ratings)
- How did researchers interpret their own "footprint" vs their expectations? (think-aloud)

**Key references to cite:**
- McDonald & Ackerman — expertise location
- Pirolli & Card — sensemaking
- Elmqvist & Fekete — semantic zoom / hierarchical aggregation
- Shneiderman — information seeking mantra (overview first, zoom and filter, details on demand)
- Park et al. 2024 — the 1000-person simulation (for the agent grounding pipeline comparison)
