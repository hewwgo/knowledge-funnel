"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";

// ── Types ──────────────────────────────────────────────────────────
interface Seed {
  type: string;
  label: string;
  body?: string;
}

interface Grounding {
  seed: string;
  contribution: string;
}

interface Idea {
  id: string;
  title: string;
  description: string;
  grounding: Grounding[];
  facetValues: Record<string, string[]>;
}

interface Facet {
  name: string;
  type: "categorical" | "ordinal";
  values: string[];
}

interface LockedFacet {
  name: string;
  selectedValues: string[];
}

// ── Constants ──────────────────────────────────────────────────────
const DEFAULT_TARGET = 15;
const BATCH_SIZE = 3;

const COLORS = [
  "#E69F00", "#56B4E9", "#009E73", "#F0E442",
  "#0072B2", "#D55E00", "#CC79A7", "#999999",
  "#E6AB02", "#66A61E",
];

function hashColor(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

// ── LLM helper (routes through our API) ────────────────────────────
async function callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetch("/api/explore/llm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemPrompt, userPrompt }),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`LLM API returned invalid response: ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(data.error || `LLM call failed (${res.status})`);
  return data.text;
}

function buildConstraintString(seeds: Seed[], lockedFacets: LockedFacet[]): string {
  const parts = seeds.map((s) => {
    const bodySnippet = s.body ? ` — ${s.body.slice(0, 2000)}` : "";
    return `${s.type}: ${s.label}${bodySnippet}`;
  });
  lockedFacets.forEach((f) => {
    parts.push(`${f.name}: ${f.selectedValues.join(", ")}`);
  });
  return parts.join("\n\n");
}

async function generateIdeas(
  seeds: Seed[], lockedFacets: LockedFacet[], existingTitles: string[], count: number
): Promise<{ title: string; description: string; grounding: Grounding[] }[]> {
  const seedDescriptions = seeds.map((s) => {
    const bodySnippet = s.body ? ` — ${s.body.slice(0, 2000)}` : "";
    return `"${s.label}"${bodySnippet}`;
  }).join("\n");

  // Build tile context
  const divergeSection = `=== TILES (research contributions from the group) ===
${seedDescriptions}

These tiles come from different researchers in a collaborative group. They represent different perspectives, methods, and interests. Use them as creative raw material.`;

  const convergeSection = lockedFacets.length > 0
    ? `\n=== LOCKED DIMENSIONS (constraints) ===
${lockedFacets.map((f) => `${f.name}: must be one of [${f.selectedValues.join(", ")}]`).join("\n")}`
    : "";

  const sys = `You are a thoughtful research advisor helping a group of HCI researchers find interesting connections in their collective work. You read their submissions and suggest research directions that naturally emerge from combining their perspectives.

RULES:
- Write clearly and directly. No em-dashes. No jargon for jargon's sake.
- Each idea should feel PLAUSIBLE, like something a researcher would actually want to pursue.
- Not every idea needs to bridge all tiles. Some ideas might primarily build on one tile with a twist from another. Some might genuinely connect two or three. Let the connection be natural, not forced.
- Be specific: name concrete methods, study designs, or system features. Vague ideas are useless.
- Mix types: some ideas should be systems to build, some should be studies to run, some should be conceptual frameworks, some should be design explorations.
- Vary your tone: some descriptions can be a question, some a proposal, some an observation about a gap.

Respond ONLY with a JSON array. No markdown, no backticks. Start with [ and end with ].`;

  const prompt = `${divergeSection}
${convergeSection}

Generate exactly ${count} research directions inspired by these tiles. Each should feel like something a smart colleague might suggest after reading the group's work.

Each direction must be distinct from: ${JSON.stringify(existingTitles)}.

Return a JSON array:
{"title": "Concise concept name (2-6 words)", "description": "2-4 sentences. What is the idea? Why is it interesting? What would you actually do? Be concrete and specific.", "grounding": [{"seed": "exact tile title", "contribution": "One sentence: what specific concept or finding from this tile inspired this direction, and how it was extended or reframed."}]}

Each idea needs 1-${Math.min(seeds.length, 3)} grounding entries. Use 1 if the idea primarily comes from one tile. Use 2-3 only if the connection is genuine. Do not force bridges that don't exist. Reference tiles by exact title.`;
  const raw = await callLLM(sys, prompt);
  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON array found");
    return JSON.parse(jsonMatch[0]);
  } catch {
    console.error("Parse error for ideas:", raw.slice(0, 500));
    return [];
  }
}

async function discoverFacets(
  ideas: Idea[], existingFacetNames: string[]
): Promise<Facet[]> {
  const sys = `You are an expert at taxonomic analysis of research ideas in HCI, visualization, and computing. Respond ONLY with a JSON array. No markdown, no backticks, no preamble.`;
  const summaries = ideas.map((i) => `${i.title}: ${i.description.slice(0, 120)}`).join("\n");
  const avoidClause = existingFacetNames.length
    ? `Avoid these existing facet names: ${existingFacetNames.join(", ")}.`
    : "";
  const maxValues = Math.min(6, Math.max(3, Math.ceil(ideas.length / 2)));
  const prompt = `Given these research ideas:\n${summaries}\n\nPropose 4 to 5 facets (dimensions) that meaningfully characterize and contrast them. ${avoidClause}
Each facet should have 3 to ${maxValues} values. Keep values broad enough that multiple ideas can share a value — avoid creating a unique value for every idea. Facets can be ordinal or categorical.
Return a JSON array: [{"name": "Facet Name", "type": "categorical"|"ordinal", "values": ["Value1","Value2",...]}]
Only JSON.`;
  const raw = await callLLM(sys, prompt);
  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON array found");
    return JSON.parse(jsonMatch[0]);
  } catch {
    console.error("Parse error for facets:", raw.slice(0, 500));
    return [];
  }
}

async function discoverSingleFacet(
  ideas: Idea[], existingFacetNames: string[], lockedFacetNames: string[]
): Promise<Facet | null> {
  const allAvoid = [...existingFacetNames, ...lockedFacetNames];
  const sys = `You are an expert at taxonomic analysis of research ideas in HCI, visualization, and computing. Respond ONLY with a JSON array containing exactly 1 facet. No markdown, no backticks, no preamble.`;
  const summaries = ideas.map((i) => `${i.title}: ${i.description.slice(0, 120)}`).join("\n");
  const avoidClause = `You MUST avoid these existing and previously used facet names: ${allAvoid.join(", ")}. Generate a completely different dimension that reveals a new aspect of these ideas.`;
  const prompt = `Given these research ideas:\n${summaries}\n\n${avoidClause}
Propose exactly 1 NEW facet (dimension) that meaningfully characterizes and contrasts these ideas along an axis not yet covered.
The facet should have 3 to ${Math.min(5, Math.max(3, Math.ceil(ideas.length / 2)))} values. Keep values broad so multiple ideas share values. Can be ordinal or categorical.
Return a JSON array with exactly 1 element: [{"name": "Facet Name", "type": "categorical"|"ordinal", "values": ["Value1","Value2",...]}]`;
  const raw = await callLLM(sys, prompt);
  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON array found");
    const arr = JSON.parse(jsonMatch[0]);
    return arr.length > 0 ? arr[0] : null;
  } catch {
    console.error("Parse error for single facet:", raw.slice(0, 500));
    return null;
  }
}

async function classifySingleFacet(
  ideas: { title: string; description: string }[], facet: Facet
): Promise<{ index: number; values: string[] }[]> {
  const sys = `You classify research ideas into facet values. Respond ONLY with a valid JSON array. Start with [ and end with ].`;
  const facetDesc = `${facet.name}: [${facet.values.join(", ")}]`;
  const titles = ideas.map((i, idx) => `${idx}: ${i.title}`).join("\n");
  const prompt = `Facet:\n${facetDesc}\n\nIdeas:\n${titles}\n\nFor each idea (by index), assign one or more values from this facet.
Return JSON array: [{"index": 0, "values": ["Value1"]}, ...]`;
  const raw = await callLLM(sys, prompt);
  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON array found");
    return JSON.parse(jsonMatch[0]);
  } catch {
    console.error("Parse error for single facet classification:", raw.slice(0, 500));
    return [];
  }
}

async function classifyIdeas(
  ideas: { title: string; description: string }[], facets: Facet[]
): Promise<{ index: number; facets: Record<string, string[]> }[]> {
  const sys = `You classify research ideas into facet values. Respond ONLY with a valid JSON array. No markdown fences, no backticks, no explanation, no preamble. Start your response with [ and end with ].`;
  const facetDesc = facets.map((f) => `${f.name}: [${f.values.join(", ")}]`).join("\n");
  const titles = ideas.map((i, idx) => `${idx}: ${i.title}`).join("\n");
  const prompt = `Facets:\n${facetDesc}\n\nIdeas:\n${titles}\n\nFor each idea (by index), assign one or more values per facet.
Return JSON array: [{"index": 0, "facets": {"Facet Name": ["Value1"], ...}}, ...]`;
  const raw = await callLLM(sys, prompt);
  try {
    // Extract JSON array from response even if there's surrounding text
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON array found");
    return JSON.parse(jsonMatch[0]);
  } catch {
    console.error("Parse error for classification:", raw.slice(0, 500));
    return [];
  }
}

// ── Chip ───────────────────────────────────────────────────────────
function Chip({ type, label, onRemove, locked }: {
  type: string; label: string; onRemove?: () => void; locked?: boolean;
}) {
  return (
    <span className="explore-chip" data-locked={locked ? "true" : undefined} data-type={type === "Seed" ? "seed" : "facet"}>
      <span className="explore-chip-type">{type === "Seed" ? "TILE" : type}</span>
      <span style={{ color: "rgba(38,38,36,0.3)" }}>:</span> {label}
      {onRemove && (
        <button onClick={onRemove} className="explore-chip-remove">&times;</button>
      )}
    </span>
  );
}

// ── Idea Dot ──────────────────────────────────────────────────────
function IdeaDot({ idea, highlighted, dimmed, onHover, onClick }: {
  idea: Idea; highlighted: boolean; dimmed: boolean;
  onHover: (idea: Idea | null) => void; onClick: (idea: Idea) => void;
}) {
  const color = hashColor(idea.title);
  const opacity = dimmed ? 0.15 : highlighted ? 1 : 0.7;
  const size = highlighted ? 11 : 9;
  return (
    <div
      onMouseEnter={() => onHover(idea)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onClick(idea)}
      title={idea.title}
      style={{
        width: size, height: size, borderRadius: "50%",
        background: color, opacity, cursor: "pointer",
        transition: "all 0.15s ease", flexShrink: 0,
        border: highlighted ? `1.5px solid ${color}` : "1px solid rgba(38,38,36,0.1)",
        boxShadow: highlighted ? `0 0 6px ${color}40` : "none",
      }}
    />
  );
}

// ── Value Bucket ──────────────────────────────────────────────────
function ValueBucket({ facetName, value, ideas, selected, onToggle, hoveredIdea, onHoverIdea, onClickIdea, brushedIds }: {
  facetName: string; value: string; ideas: Idea[]; selected: boolean;
  onToggle: (val: string) => void; hoveredIdea: Idea | null;
  onHoverIdea: (idea: Idea | null) => void; onClickIdea: (idea: Idea) => void;
  brushedIds: Set<string> | null;
}) {
  const matching = ideas.filter((i) => {
    const vals = i.facetValues?.[facetName];
    return vals && vals.includes(value);
  });
  const count = matching.length;

  return (
    <div onClick={() => onToggle(value)} className="explore-bucket" data-selected={selected ? "true" : undefined}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: selected ? "#262624" : "rgba(38,38,36,0.6)", fontWeight: selected ? 600 : 400 }}>{value}</span>
        <span style={{ fontSize: 10, color: "rgba(38,38,36,0.3)", fontFamily: "monospace" }}>{count}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
        {matching.map((idea) => (
          <IdeaDot
            key={idea.id}
            idea={idea}
            highlighted={hoveredIdea?.id === idea.id || (brushedIds !== null && brushedIds.has(idea.id))}
            dimmed={brushedIds !== null && !brushedIds.has(idea.id)}
            onHover={onHoverIdea}
            onClick={onClickIdea}
          />
        ))}
      </div>
    </div>
  );
}

// ── Facet Column ──────────────────────────────────────────────────
function FacetColumn({ facet, ideas, selectedValues, onToggleValue, onLock, onDiscard, hoveredIdea, onHoverIdea, onClickIdea, brushedIds }: {
  facet: Facet; ideas: Idea[]; selectedValues: string[];
  onToggleValue: (facetName: string, val: string) => void;
  onLock: (facetName: string) => void; onDiscard: (facetName: string) => void;
  hoveredIdea: Idea | null; onHoverIdea: (idea: Idea | null) => void;
  onClickIdea: (idea: Idea) => void; brushedIds: Set<string> | null;
}) {
  return (
    <div className="explore-facet-col">
      <div className="explore-facet-header">
        <span className="explore-facet-name">{facet.name}</span>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={() => onLock(facet.name)}
            title="Lock selection into query"
            disabled={selectedValues.length === 0}
            className="explore-facet-btn explore-facet-btn-lock"
          >Lock</button>
          <button
            onClick={() => onDiscard(facet.name)}
            title="Discard facet"
            className="explore-facet-btn explore-facet-btn-discard"
          >&times;</button>
        </div>
      </div>
      <div style={{ padding: 6, display: "flex", flexDirection: "column", gap: 4, overflowY: "auto", flex: 1 }}>
        {facet.values.filter((v) => {
          // Only show values that have at least 1 idea
          return ideas.some((i) => i.facetValues?.[facet.name]?.includes(v));
        }).map((v) => (
          <ValueBucket
            key={v}
            facetName={facet.name}
            value={v}
            ideas={ideas}
            selected={selectedValues.includes(v)}
            onToggle={(val) => onToggleValue(facet.name, val)}
            hoveredIdea={hoveredIdea}
            onHoverIdea={onHoverIdea}
            onClickIdea={onClickIdea}
            brushedIds={brushedIds}
          />
        ))}
      </div>
    </div>
  );
}

// ── Save Button ───────────────────────────────────────────────────
function SaveButton({ idea, lockedFacets }: { idea: Idea; lockedFacets: LockedFacet[] }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const facetPath = lockedFacets.map((f) => `${f.name}: ${f.selectedValues.join(", ")}`).join(" → ");
      const res = await fetch("/api/explore/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: idea.title,
          description: idea.description,
          grounding: idea.grounding || [],
          facetPath,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      setSaved(true);
    } catch (err) {
      console.error("Save error:", err);
    }
    setSaving(false);
  };

  return (
    <div style={{ marginTop: 10 }}>
      <button
        onClick={handleSave}
        disabled={saving || saved}
        className="map-btn"
        style={{
          width: "100%", padding: "8px", fontSize: 11,
          background: saved ? "#009E73" : "#262624",
          borderColor: saved ? "#009E73" : "#262624",
          color: "#fff",
        }}
      >
        {saved ? "Saved to Map" : saving ? "Saving..." : "Save to Knowledge Map"}
      </button>
    </div>
  );
}

// ── Idea Detail Panel (kept for reference but no longer used as slide-out) ──
function IdeaDetail({ idea, facets, onClose, lockedFacets }: {
  idea: Idea; facets: Facet[]; onClose: () => void; lockedFacets: LockedFacet[];
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const facetPath = lockedFacets.map((f) => `${f.name}: ${f.selectedValues.join(", ")}`).join(" → ");
      const res = await fetch("/api/explore/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: idea.title,
          description: idea.description,
          grounding: idea.grounding || [],
          facetPath,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      setSaved(true);
    } catch (err) {
      console.error("Save error:", err);
    }
    setSaving(false);
  };

  const color = hashColor(idea.title);
  return (
    <div className="explore-detail">
      <button onClick={onClose} className="explore-detail-close">&times;</button>
      <div style={{ width: 14, height: 14, borderRadius: "50%", background: color, marginBottom: 12 }} />
      <h3 style={{ fontSize: 15, fontWeight: 700, color: "#262624", margin: "0 0 12px 0", lineHeight: 1.3 }}>{idea.title}</h3>
      <p style={{ fontSize: 13, color: "rgba(38,38,36,0.7)", lineHeight: 1.6, margin: "0 0 20px 0" }}>{idea.description}</p>
      {/* Grounding / Provenance */}
      {idea.grounding && idea.grounding.length > 0 && (
        <>
          <div style={{ fontSize: 10, color: "rgba(38,38,36,0.4)", textTransform: "uppercase", marginBottom: 10, letterSpacing: "0.06em", fontWeight: 600 }}>
            Grounded In
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
            {idea.grounding.map((g, i) => (
              <div key={i} style={{
                padding: "8px 10px",
                border: "1.5px solid rgba(213, 94, 0, 0.2)",
                background: "rgba(213, 94, 0, 0.03)",
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#D55E00", marginBottom: 3, lineHeight: 1.3 }}>
                  {g.seed}
                </div>
                <div style={{ fontSize: 11, color: "rgba(38,38,36,0.6)", lineHeight: 1.5 }}>
                  {g.contribution}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ fontSize: 10, color: "rgba(38,38,36,0.4)", textTransform: "uppercase", marginBottom: 8, letterSpacing: "0.06em", fontWeight: 600 }}>Classification</div>
      {facets.map((f) => {
        const vals = idea.facetValues?.[f.name] || [];
        return (
          <div key={f.name} style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: "rgba(38,38,36,0.5)" }}>{f.name}: </span>
            {vals.length > 0
              ? vals.map((v) => (
                  <span key={v} className="explore-detail-tag">{v}</span>
                ))
              : <span style={{ fontSize: 10, color: "rgba(38,38,36,0.3)" }}>&mdash;</span>}
          </div>
        );
      })}

      {/* Save to Knowledge Map */}
      <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid rgba(212, 165, 116, 0.3)" }}>
        <button
          onClick={handleSave}
          disabled={saving || saved}
          className="map-btn"
          style={{
            width: "100%",
            padding: "10px",
            fontSize: 12,
            background: saved ? "#009E73" : "#262624",
            borderColor: saved ? "#009E73" : "#262624",
            color: "#fff",
          }}
        >
          {saved ? "✓ Saved to Knowledge Map" : saving ? "Saving..." : "Save to Knowledge Map"}
        </button>
        {saved && (
          <p style={{ fontSize: 10, color: "rgba(38,38,36,0.4)", marginTop: 6, textAlign: "center" }}>
            This idea will appear on the map after recompute.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Inner component (uses useSearchParams) ────────────────────────
function ExploreInner() {
  const searchParams = useSearchParams();

  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [lockedFacets, setLockedFacets] = useState<LockedFacet[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [facets, setFacets] = useState<Facet[]>([]);
  const [selectedValues, setSelectedValues] = useState<Record<string, string[]>>({});
  const [targetCount, setTargetCount] = useState(DEFAULT_TARGET);
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [hoveredIdea, setHoveredIdea] = useState<Idea | null>(null);
  const [selectedIdea, setSelectedIdea] = useState<Idea | null>(null);
  const [brushedIds, setBrushedIds] = useState<Set<string> | null>(null);
  const [newSeed, setNewSeed] = useState("");
  const [seedsLoaded, setSeedsLoaded] = useState(false);
  const [seedsExpanded, setSeedsExpanded] = useState(true);

  const idCounter = useRef(0);
  const abortRef = useRef(false);

  // Load seeds from URL params
  useEffect(() => {
    const seedIds = searchParams.get("seeds");
    if (!seedIds) {
      setSeedsLoaded(true);
      return;
    }

    const ids = seedIds.split(",").filter(Boolean);
    if (ids.length === 0) {
      setSeedsLoaded(true);
      return;
    }

    // Fetch submission titles from API
    fetch(`/api/explore/seeds?ids=${ids.join(",")}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.seeds && data.seeds.length > 0) {
          setSeeds(data.seeds.map((s: { title: string; body?: string }) => ({
            type: "Seed",
            label: s.title,
            body: s.body || "",
          })));
        }
        setSeedsLoaded(true);
      })
      .catch(() => setSeedsLoaded(true));
  }, [searchParams]);

  // Brushing
  useEffect(() => {
    if (hoveredIdea) {
      setBrushedIds(new Set([hoveredIdea.id]));
    } else {
      setBrushedIds(null);
    }
  }, [hoveredIdea]);

  const runGeneration = useCallback(async () => {
    setGenerating(true);
    abortRef.current = false;

    try {
      const needed = targetCount - ideas.length;
      if (needed <= 0) {
        setStatus(`${ideas.length} ideas loaded`);
        setGenerating(false);
        return;
      }

      const batches = Math.ceil(needed / BATCH_SIZE);
      let allNew: Idea[] = [];

      for (let b = 0; b < batches; b++) {
        if (abortRef.current) break;
        const batchCount = Math.min(BATCH_SIZE, needed - allNew.length);
        setStatus(`Generating ideas (batch ${b + 1}/${batches})...`);
        const existingTitles = [...ideas.map((i) => i.title), ...allNew.map((i) => i.title)];
        const batch = await generateIdeas(seeds, lockedFacets, existingTitles, batchCount);
        const tagged: Idea[] = batch.map((item) => ({
          ...item,
          id: `idea-${++idCounter.current}`,
          facetValues: {},
        }));
        // Deduplicate by title — avoid LLM generating same title twice
        const seenTitles = new Set([...ideas.map((i) => i.title), ...allNew.map((i) => i.title)]);
        const unique = tagged.filter((i) => {
          if (seenTitles.has(i.title)) return false;
          seenTitles.add(i.title);
          return true;
        });
        allNew = [...allNew, ...unique];
        setIdeas((prev) => [...prev, ...unique]);
      }

      if (abortRef.current) { setGenerating(false); return; }

      const allIdeas = [...ideas, ...allNew];
      if (facets.length === 0) {
        setStatus("Discovering facets...");
        const discovered = await discoverFacets(allIdeas, lockedFacets.map((f) => f.name));
        if (!abortRef.current && discovered.length > 0) {
          setFacets(discovered);
          setStatus("Classifying ideas...");
          const classified = await classifyIdeas(allIdeas, discovered);
          if (!abortRef.current) {
            setIdeas((prev) => {
              const updated = [...prev];
              classified.forEach((c) => {
                if (c.index < updated.length) {
                  updated[c.index] = { ...updated[c.index], facetValues: c.facets || {} };
                }
              });
              return updated;
            });
          }
        }
      } else {
        setStatus("Classifying new ideas...");
        const classified = await classifyIdeas(
          allNew.map(({ title, description }) => ({ title, description })),
          facets
        );
        if (!abortRef.current) {
          setIdeas((prev) => {
            const updated = [...prev];
            classified.forEach((c) => {
              const realIdx = ideas.length + c.index;
              if (realIdx < updated.length) {
                updated[realIdx] = { ...updated[realIdx], facetValues: c.facets || {} };
              }
            });
            return updated;
          });
        }
      }
      setStatus(`${ideas.length + allNew.length} ideas loaded`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(err);
      setStatus(`Error: ${msg}`);
    }
    setGenerating(false);
  }, [seeds, lockedFacets, ideas, facets, targetCount]);

  const handlePause = () => { abortRef.current = true; };

  const handleClear = () => {
    abortRef.current = true;
    setIdeas([]);
    setFacets([]);
    setSelectedValues({});
    setGenerating(false);
    setStatus("Cleared");
  };

  const handleToggleValue = (facetName: string, value: string) => {
    setSelectedValues((prev) => {
      const current = prev[facetName] || [];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      return { ...prev, [facetName]: next };
    });
  };

  const handleLockFacet = async (facetName: string) => {
    const vals = selectedValues[facetName] || [];
    if (vals.length === 0) return;
    const facet = facets.find((f) => f.name === facetName);
    if (!facet) return;

    // 1. Lock the facet
    const newLockedFacets = [...lockedFacets, { name: facetName, selectedValues: vals }];
    setLockedFacets(newLockedFacets);
    const remainingFacets = facets.filter((f) => f.name !== facetName);
    setFacets(remainingFacets);
    setSelectedValues((prev) => {
      const next = { ...prev };
      delete next[facetName];
      return next;
    });

    // 2. Filter ideas to match locked value
    const filteredIdeas = ideas.filter((i) => {
      const iVals = i.facetValues?.[facetName] || [];
      return vals.some((v) => iVals.includes(v));
    });
    setIdeas(filteredIdeas);

    // 3. Discover a replacement facet
    setStatus("Discovering new dimension...");
    const allLockedNames = newLockedFacets.map((f) => f.name);
    const existingNames = remainingFacets.map((f) => f.name);
    const newFacet = await discoverSingleFacet(filteredIdeas, existingNames, allLockedNames);
    let allFacetsAfterLock: Facet[] = remainingFacets;

    if (newFacet) {
      // 4. Classify existing ideas into the new facet
      setStatus("Classifying ideas into new dimension...");
      const classifications = await classifySingleFacet(
        filteredIdeas.map(({ title, description }) => ({ title, description })),
        newFacet
      );

      // Update ideas with new facet values
      setIdeas((prev) => {
        const updated = [...prev];
        classifications.forEach((c) => {
          if (c.index < updated.length) {
            updated[c.index] = {
              ...updated[c.index],
              facetValues: {
                ...updated[c.index].facetValues,
                [newFacet.name]: c.values || [],
              },
            };
          }
        });
        return updated;
      });

      // Add the new facet to the columns
      setFacets((prev) => [...prev, newFacet]);
      allFacetsAfterLock = [...remainingFacets, newFacet];
    } else {
      allFacetsAfterLock = remainingFacets;
    }

    // 5. Backfill: generate replacement ideas to maintain target count
    const deficit = targetCount - filteredIdeas.length;
    if (deficit > 0) {
      setStatus(`Backfilling ${deficit} ideas...`);
      const existingTitles = filteredIdeas.map((i) => i.title);
      const batchCount = Math.min(deficit, BATCH_SIZE);
      const backfillBatch = await generateIdeas(seeds, newLockedFacets, existingTitles, batchCount);
      const backfillTagged: Idea[] = backfillBatch.map((item) => ({
        ...item,
        id: `idea-${++idCounter.current}`,
        facetValues: {},
      }));
      // Dedup
      const seen = new Set(existingTitles);
      const uniqueBackfill = backfillTagged.filter((i) => {
        if (seen.has(i.title)) return false;
        seen.add(i.title);
        return true;
      });

      if (uniqueBackfill.length > 0 && allFacetsAfterLock.length > 0) {
        setStatus("Classifying new ideas...");
        const classified = await classifyIdeas(
          uniqueBackfill.map(({ title, description }) => ({ title, description })),
          allFacetsAfterLock
        );
        classified.forEach((c) => {
          if (c.index < uniqueBackfill.length) {
            uniqueBackfill[c.index].facetValues = c.facets || {};
          }
        });
      }
      setIdeas((prev) => [...prev, ...uniqueBackfill]);
    }

    setStatus(newFacet
      ? `Locked "${facetName}" → new dimension: ${newFacet.name}`
      : `Locked "${facetName}"`);
  };

  const handleDiscardFacet = (facetName: string) => {
    setFacets((prev) => prev.filter((f) => f.name !== facetName));
    setSelectedValues((prev) => {
      const next = { ...prev };
      delete next[facetName];
      return next;
    });
  };

  const handleRemoveSeed = (idx: number) => {
    setSeeds((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleRemoveLocked = (idx: number) => {
    setLockedFacets((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleAddSeed = () => {
    if (!newSeed.trim()) return;
    setSeeds((prev) => [...prev, { type: "Seed", label: newSeed.trim() }]);
    setNewSeed("");
  };

  if (!seedsLoaded) {
    return (
      <div className="map-page">
        <div className="map-empty">Loading tiles...</div>
      </div>
    );
  }

  const activeFacets = facets.filter((f) =>
    f.values.some((v) => ideas.some((i) => i.facetValues?.[f.name]?.includes(v)))
  );

  return (
    <div className="map-page" style={{ overflow: "hidden", position: "relative" }}>
      {/* Floating toolbar — matches mapping layer style */}
      <div className="map-toolbar" style={{ top: 14 }} onClick={(e) => e.stopPropagation()}>
        <a href="/map" style={{ color: "#262624", textDecoration: "none", fontSize: 13, fontWeight: 500 }}>&larr;</a>
        <span className="map-toolbar-brand">Composition</span>
        {ideas.length > 0 && (
          <span className="map-toolbar-stats">
            {ideas.length} directions &middot; {activeFacets.length} dimensions
          </span>
        )}

        {/* Seeds toggle */}
        <button
          className="map-toolbar-dropdown-btn"
          onClick={() => setSeedsExpanded(!seedsExpanded)}
          style={{ fontSize: 10 }}
        >
          Tiles ({seeds.length})
          {lockedFacets.length > 0 && <span style={{ color: "#009E73", marginLeft: 4 }}>+{lockedFacets.length}</span>}
          <span style={{ marginLeft: 3, fontSize: 8 }}>{seedsExpanded ? "▴" : "▾"}</span>
        </button>

        {/* Target slider — bigger */}
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: 9, color: "rgba(38,38,36,0.4)" }}>Ideas:</span>
          <input
            type="range" min={5} max={50} value={targetCount}
            onChange={(e) => setTargetCount(Number(e.target.value))}
            style={{ width: 90, accentColor: "#262624" }}
          />
          <span style={{ fontSize: 11, color: "rgba(38,38,36,0.5)", fontFamily: "monospace", width: 20 }}>
            {targetCount}
          </span>
        </div>

        <button
          onClick={generating ? handlePause : runGeneration}
          className="map-toolbar-dropdown-btn"
          disabled={seeds.length === 0}
          style={{ fontSize: 10, background: seeds.length > 0 ? "rgba(38,38,36,0.06)" : "transparent" }}
        >
          {generating ? "Pause" : "Generate"}
        </button>
        <button
          onClick={handleClear}
          className="map-toolbar-dropdown-btn"
          style={{ fontSize: 10 }}
        >
          Clear
        </button>
        {generating && (
          <span style={{ fontSize: 9, color: "rgba(38,38,36,0.4)" }}>
            <span style={{ display: "inline-block", animation: "explore-pulse 1s infinite", marginRight: 3, color: "#D55E00" }}>●</span>
            {status}
          </span>
        )}
      </div>

      {/* Main content area */}
      <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 56 }}>
        <div style={{ width: "100%", maxWidth: 1100, padding: "12px 24px" }}>

          {/* Tiles expandable panel — pushes content down */}
          {seedsExpanded && (seeds.length > 0 || lockedFacets.length > 0) && (
            <div style={{
              position: "relative",
              background: "rgba(255,255,255,0.96)", backdropFilter: "blur(12px)",
              border: "1px solid rgba(38,38,36,0.1)", boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
              padding: "8px 14px", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
              width: "100%", marginBottom: 8,
            }}>
              {seeds.map((s, i) => (
                <Chip key={`s-${i}`} type={s.type} label={s.label.length > 35 ? s.label.slice(0, 33) + "…" : s.label} onRemove={() => handleRemoveSeed(i)} />
              ))}
              {lockedFacets.map((f, i) => (
                <Chip key={`l-${i}`} type={f.name} label={f.selectedValues.join(", ")} locked onRemove={() => handleRemoveLocked(i)} />
              ))}
            </div>
          )}

          {/* Facet columns */}
          {facets.length === 0 && ideas.length === 0 && !generating && (
            <div className="explore-empty">
              {seeds.length === 0
                ? <>Select submissions from the <a href="/map" style={{ color: "#262624", fontWeight: 600 }}>knowledge map</a> to begin.</>
                : <>Press <strong> Generate </strong> to explore the idea space.</>
              }
            </div>
          )}
          {facets.length === 0 && generating && (
            <div className="explore-empty">
              Generating directions and discovering dimensions...
            </div>
          )}
          {activeFacets.length > 0 && (
            <div style={{ display: "flex", gap: 8, height: selectedIdea ? "35vh" : "calc(100vh - 220px)", transition: "height 0.2s ease" }}>
              {activeFacets.map((f) => (
                <FacetColumn
                  key={f.name}
                  facet={f}
                  ideas={ideas}
                  selectedValues={selectedValues[f.name] || []}
                  onToggleValue={handleToggleValue}
                  onLock={handleLockFacet}
                  onDiscard={handleDiscardFacet}
                  hoveredIdea={hoveredIdea}
                  onHoverIdea={setHoveredIdea}
                  onClickIdea={setSelectedIdea}
                  brushedIds={brushedIds}
                />
              ))}
            </div>
          )}

          {/* Idea detail — below facets, inline */}
          {selectedIdea && (
            <div style={{
              marginTop: 10,
              border: "1.5px solid rgba(212, 165, 116, 0.3)",
              background: "#fff4eb",
              padding: "20px 24px",
              position: "relative",
            }}>
              <button
                onClick={() => setSelectedIdea(null)}
                style={{
                  position: "absolute", top: 10, right: 14,
                  background: "none", border: "none", color: "#262624",
                  fontSize: 18, cursor: "pointer", padding: 0, lineHeight: 1,
                }}
              >&times;</button>

              <div style={{ display: "flex", gap: 24 }}>
                {/* Left: title + description */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <div style={{ width: 12, height: 12, borderRadius: "50%", background: hashColor(selectedIdea.title), flexShrink: 0 }} />
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: "#262624", margin: 0, lineHeight: 1.3 }}>
                      {selectedIdea.title}
                    </h3>
                  </div>
                  <p style={{ fontSize: 13, color: "rgba(38,38,36,0.7)", lineHeight: 1.7, margin: 0 }}>
                    {selectedIdea.description}
                  </p>

                  {/* Classification */}
                  <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {activeFacets.map((f) => {
                      const vals = selectedIdea.facetValues?.[f.name] || [];
                      if (vals.length === 0) return null;
                      return vals.map((v) => (
                        <span key={`${f.name}-${v}`} className="explore-detail-tag">
                          {v}
                        </span>
                      ));
                    })}
                  </div>
                </div>

                {/* Right: grounding */}
                {selectedIdea.grounding && selectedIdea.grounding.length > 0 && (
                  <div style={{ width: 320, flexShrink: 0 }}>
                    <div style={{ fontSize: 10, color: "rgba(38,38,36,0.4)", textTransform: "uppercase", marginBottom: 8, letterSpacing: "0.06em", fontWeight: 600 }}>
                      Grounded In
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {selectedIdea.grounding.map((g, i) => (
                        <div key={i} style={{
                          padding: "6px 10px",
                          border: "1.5px solid rgba(213, 94, 0, 0.15)",
                          background: "rgba(213, 94, 0, 0.03)",
                        }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: "#D55E00", marginBottom: 2, lineHeight: 1.3 }}>
                            {g.seed}
                          </div>
                          <div style={{ fontSize: 10, color: "rgba(38,38,36,0.55)", lineHeight: 1.5 }}>
                            {g.contribution}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Save to Knowledge Map */}
                    <SaveButton idea={selectedIdea} lockedFacets={lockedFacets} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes explore-pulse { 0%,100% { opacity:1 } 50% { opacity:0.3 } }`}</style>
    </div>
  );
}

// ── Main page (Suspense boundary for useSearchParams) ─────────────
export default function ExplorePage() {
  return (
    <Suspense fallback={<div className="map-page"><div className="map-empty">Loading...</div></div>}>
      <ExploreInner />
    </Suspense>
  );
}
