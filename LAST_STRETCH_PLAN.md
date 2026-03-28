# Last Stretch Plan — Supervisor Feedback Implementation

## Supervisor Feedback (translated from Swedish)

> There's a limit to what you can do before Wednesday lunch, but here's my wishlist:
> - More capture mechanisms not necessary. Discord is enough as proof of concept.
> - Focus on extraction and generation.
> - Knowledge map still looks amateurish; it needs seamless clustering, search function, more scalability.
>
> More details needed for an end-to-end system:
> - Knowledge map needs to be scalable so you could have thousands of articles and ideas
> - Ideas should be taggable with a type
> - The important thing must be how articles relate to people and their work, not just that they uploaded them
> - Extraction can't just take the first 4,000 characters — there needs to be a full analysis of the article via LLM
> - The idea could also be TF-IDF at LLM level: what concepts/ideas are rare in the corpus but common in a specific article? Use this to find what's special about a specific article.
>
> Regarding generation:
> - You absolutely need backfilling so new ideas can be generated according to developed constraints
> - Ideation with divergence and convergence will be central for workflow in video and scenario
> - Must be able to reconnect (generated ideas back to the map)

---

## Priority Assessment

**Deadline: Wednesday lunch (~36 hours)**

### P0 — Must have (critical for demo/video)
1. **Backfilling in generation** — when ideas are removed by locking, generate replacements to maintain target count
2. **Reconnect** — save generated ideas back to the knowledge map as submissions
3. **Knowledge map polish** — less amateurish, better clustering visuals, working search

### P1 — Should have (strengthens the paper)
4. **Fuller extraction** — don't just use first 4,000 chars; chunk and summarize full documents
5. **Person-article relationship** — show how articles relate to a person's research focus, not just attribution
6. **LLM-level TF-IDF** — identify what's uniquely distinctive about each article relative to the corpus

### P2 — Nice to have (if time allows)
7. **Idea type tagging** — let users tag generated ideas with a type
8. **Scalability improvements** — virtual rendering, pagination for thousands of nodes

---

## Implementation Plan

### 1. Backfilling in Generation (P0, ~1 hour)

**Problem:** When user locks a facet, non-matching ideas are removed. The idea count drops but no replacements are generated. The user has to manually click Generate again.

**Fix:** After locking a facet and filtering ideas, automatically check if `ideas.length < targetCount` and trigger generation of replacement ideas that satisfy all current constraints (seeds + locked facets).

**File:** `app/explore/page.tsx` — in `handleLockFacet`, after filtering and discovering the new facet, add:
```
const deficit = targetCount - filteredIdeas.length;
if (deficit > 0) {
  // Generate replacement ideas with all locked constraints
  // Classify them into existing + new facets
}
```

**Risk:** Low. Just extending the existing lock flow.

---

### 2. Reconnect — Save Ideas to Knowledge Map (P0, ~2 hours)

**Problem:** Generated ideas exist only in the browser. No way to persist them or share with the group.

**Fix:** Add a "Save to Funnel" button in the idea detail panel. Clicking it creates a new submission of type `idea` in Supabase, with:
- `title`: the idea title
- `body`: the description + grounding section as text
- `content_type`: "idea"
- `profile_id`: the current user's profile (need to figure out auth — simplest: prompt for name or use a fixed demo profile)

**Files:**
- `app/explore/page.tsx` — add "Save to Funnel" button in IdeaDetail
- `app/api/explore/save/route.ts` — new API route that creates a submission
- The saved idea will appear on the knowledge map after next recompute

**Auth simplification for demo:** Since there's no login on the web UI, use a simple name prompt or a hardcoded "Explorer" profile. For the paper this is fine — the point is the loop, not the auth.

**Risk:** Low. Simple DB insert.

---

### 3. Knowledge Map Polish (P0, ~3 hours)

**Problem:** Map looks amateurish — bare dots, no visual refinement, search doesn't feel integrated.

**Fixes:**

**a. Clustering visuals:**
- Softer hull fills with subtle gradient or opacity variation by cluster
- Cluster labels with better typography (not just italic text floating above)
- Smooth hull shapes (use d3.curveBasisClosed instead of straight polygon edges)

**b. Search function:**
- The search input in MapControls already exists but only filters by title/concept dimming
- Make it more visible — larger, centered, with clear "X" to clear
- Highlight matching nodes (glow/pulse) rather than just dimming non-matches
- Show match count: "3 of 28 matching"

**c. Node refinements:**
- Slightly larger nodes (10px instead of 8px)
- On hover: subtle scale-up animation
- Show truncated title next to node at medium zoom (not just on full zoom)
- Better tooltip styling

**d. Overall:**
- Add a subtle grid or very faint radial gradient background so the white space doesn't feel empty
- Header should show cluster count and researcher count more prominently

**Files:** `app/map/components/KnowledgeGraph.tsx`, `app/globals.css`

**Risk:** Medium. Visual changes are fiddly but non-breaking.

---

### 4. Fuller Extraction (P1, ~2 hours)

**Problem:** Currently takes first 4,000 chars of body text for embedding. For PDFs this might be just the abstract + intro. Misses key contributions from methods/results sections.

**Fix:** Two-pass approach:
1. **Summary pass:** When a PDF is submitted, send chunks of the full text to DeepSeek asking for a structured summary (key contributions, methods, findings, unique aspects). Store this as an enriched `body`.
2. **Embedding uses the summary**, not the raw text. The summary is denser and more representative than the first 4,000 chars of raw text.

**Implementation:**
- In `discord-bot/shared.ts`, after `extractPaperMetadata`, add a `generateArticleSummary(rawText)` call that:
  - Splits text into 4000-char chunks
  - Sends each chunk asking "what are the key ideas?"
  - Combines into a structured summary (500-800 words)
  - Stores in `body` field (replacing the current abstract-only approach)
- The embedding then operates on this richer summary

**Alternative (simpler):** Just increase the text sent to the embedding from 4,000 to 8,000 chars. Voyage supports up to 32K tokens. This gets more of the paper without the complexity of multi-pass summarization.

**Risk:** Medium. The multi-pass approach adds latency. The simple approach (more chars) is safer for the deadline.

---

### 5. Person-Article Relationship (P1, ~2 hours)

**Problem:** The map shows "Sebastian submitted X" but not "X relates to Sebastian's work on Y because Z." The relationship between a person and their submissions is just ownership, not intellectual connection.

**Fix:** Generate a "research profile" for each researcher based on all their submissions. When viewing any article, show how it relates to the viewer's or the submitter's broader research trajectory.

**Implementation:**
- New field or table: `researcher_profiles` with `profile_id` and `research_summary` (LLM-generated paragraph describing their research focus based on all their submissions)
- Generated during map recompute or on-demand
- In the submission detail panel, show: "How this relates to [Submitter]'s work: [1-sentence bridge]"
- In cluster view: show which researchers overlap and WHY (not just their names)

**Simpler version for deadline:** In the submission detail panel, show "Other submissions by [Name]" with the 2-3 nearest neighbors from the same person. This at least shows the person's research trajectory without needing a new table.

**Risk:** The full version is too much for the deadline. The simpler version is doable.

---

### 6. LLM-Level TF-IDF (P1, ~2 hours)

**Problem:** Concept tags are generic ("human-computer interaction", "machine learning"). They don't capture what's UNIQUE about a specific article relative to the corpus.

**Fix:** After all submissions are tagged, run a corpus-level analysis:
- For each submission, compare its concepts against the frequency of those concepts across the whole corpus
- Concepts that appear in many submissions are common (low TF-IDF) — e.g., "HCI"
- Concepts that appear in only 1-2 submissions are distinctive (high TF-IDF) — e.g., "mulching metaphor"
- Surface the distinctive concepts prominently in the detail panel: "What makes this unique: [rare concepts]"

**Implementation:**
- This is purely a data query, no LLM needed:
  ```sql
  SELECT c.label, COUNT(*) as freq FROM submission_concepts sc
  JOIN concepts c ON sc.concept_id = c.id
  GROUP BY c.label ORDER BY freq;
  ```
- In the data API, compute TF-IDF scores per submission's concepts
- In the detail panel, show "Distinctive: [rare concepts]" vs "Shared: [common concepts]"

**Alternative (LLM version):** During extraction, explicitly ask: "What is the single most unique contribution of this work that distinguishes it from typical HCI research?" Store as a `distinctive_contribution` field.

**Risk:** Low for the query version. The LLM version adds another API call per submission.

---

### 7. Idea Type Tagging (P2, ~30 min)

**Problem:** Generated ideas have no type classification beyond the facet values.

**Fix:** Add a dropdown in the idea detail panel: "Tag as: Research Question / System Design / Study Design / Conceptual Framework / Other". Stored in the idea's local state (or in the submission if saved to funnel).

**Risk:** Very low. Pure UI.

---

### 8. Scalability (P2, ~3 hours)

**Problem:** D3 renders all nodes as SVG elements. At 1000+ nodes this will lag.

**Fix:** Switch to Canvas rendering for nodes, keep SVG for hulls and labels. Or use WebGL (via deck.gl or regl). This is a significant rewrite.

**For the deadline:** Not feasible. Instead, add a note in the paper that the current implementation handles up to ~200 submissions and discuss scalability as future work. The demo won't have 1000 articles anyway.

**Risk:** Too high for deadline. Skip.

---

## Execution Order (Wednesday morning)

| Order | Task | Time | Priority |
|-------|------|------|----------|
| 1 | Knowledge map polish (hulls, search, nodes, zoom) | 3h | P0 |
| 2 | Backfilling in generation | 1h | P0 |
| 3 | LLM-level TF-IDF (distinctive concepts per article) | 1.5h | P0 |
| 4 | Reconnect (save ideas to funnel) | 1.5h | P0 |
| 5 | Fuller extraction (increase to 8K chars) | 30min | P1 |
| 6 | Person-article relationship (simpler version) | 1h | P1 |
| 7 | Idea type tagging | 30min | P2 |

**Total estimated: ~9 hours for P0+P1. P0 alone: ~7 hours.**

**Note:** LLM TF-IDF elevated to P0 — central to how submissions are characterized. Map polish is #1 priority — biggest visual impact for demo/video.

---

## What to Skip

- More capture mechanisms (supervisor confirmed Discord is enough)
- Full scalability rewrite (future work)
- Multi-pass document summarization (just increase char limit instead)
- Full researcher profiles (use simpler "other submissions by" approach)
