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
const DEFAULT_TARGET = 20;
const BATCH_SIZE = 6;

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
    const bodySnippet = s.body ? ` — ${s.body.slice(0, 300)}` : "";
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
    const bodySnippet = s.body ? ` — ${s.body.slice(0, 300)}` : "";
    return `"${s.label}"${bodySnippet}`;
  }).join("\n");

  // Build explicit diverge/converge sections
  const divergeSection = `=== SEEDS (DIVERGE — draw creative inspiration from these) ===
${seedDescriptions}

Use these submissions as creative raw material. Combine ideas from different seeds in unexpected ways. Each idea should draw from at least 2 seeds.`;

  const convergeSection = lockedFacets.length > 0
    ? `\n=== CONSTRAINTS (CONVERGE — every idea MUST satisfy ALL of these) ===
${lockedFacets.map((f) => `${f.name}: MUST be one of [${f.selectedValues.join(", ")}]. Do NOT generate ideas outside these values.`).join("\n")}

These are hard constraints. Every single generated idea must satisfy every constraint above. Ideas that violate any constraint are invalid.`
    : "";

  const sys = `You are a research idea generator for HCI, data visualization, and ubiquitous computing. You generate novel, specific, and concrete research ideas grounded in specific seed contributions. Respond ONLY with a JSON array. No markdown, no backticks, no preamble. Start with [ and end with ].`;
  const prompt = `${divergeSection}
${convergeSection}

Generate exactly ${count} novel research ideas. For each idea, explicitly state which seeds it draws from and how each seed contributes.

Each idea must be distinct from these existing ideas: ${JSON.stringify(existingTitles)}.

Return a JSON array where each element is:
{"title": "Evocative short title", "description": "One paragraph describing the idea concretely.", "grounding": [{"seed": "exact seed title", "contribution": "one sentence explaining how this seed shaped the idea"}]}

Every idea must have a "grounding" array with 2-${Math.min(seeds.length, 4)} entries. Only reference seeds by their exact title from the list above.`;
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
  const prompt = `Given these research ideas:\n${summaries}\n\nPropose 4 to 5 facets (dimensions) that meaningfully characterize and contrast them. ${avoidClause}
Each facet should have 3 to 8 values. Facets can be ordinal or categorical.
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
The facet should have 3 to 8 values and can be ordinal or categorical.
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
      <span className="explore-chip-type">{type}</span>
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
        {facet.values.map((v) => (
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

// ── Idea Detail Panel ─────────────────────────────────────────────
function IdeaDetail({ idea, facets, onClose }: {
  idea: Idea; facets: Facet[]; onClose: () => void;
}) {
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
        allNew = [...allNew, ...tagged];
        setIdeas((prev) => [...prev, ...tagged]);
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
      setStatus(`Locked "${facetName}" → new dimension: ${newFacet.name}`);
    } else {
      setStatus(`Locked "${facetName}" — could not discover new dimension`);
    }
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
        <div className="map-empty">Loading seeds...</div>
      </div>
    );
  }

  return (
    <div className="map-page" style={{ overflow: "hidden" }}>
      {/* Header */}
      <header className="map-header">
        <div className="map-header-left">
          <a href="/map" className="map-back">&larr;</a>
          <h1 className="map-title">Idea Explorer</h1>
          {ideas.length > 0 && (
            <span className="map-computed-at">
              {ideas.length} ideas &middot; {facets.length} facets
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 11, color: "rgba(38,38,36,0.5)" }}>
            {generating && <span style={{ display: "inline-block", animation: "explore-pulse 1s infinite", marginRight: 6, color: "#D55E00" }}>●</span>}
            {status}
          </span>
        </div>
      </header>

      {/* Query bar */}
      <div className="explore-query-bar">
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="explore-section-label">Seeds</span>
          {seeds.map((s, i) => (
            <Chip key={`s-${i}`} type={s.type} label={s.label} onRemove={() => handleRemoveSeed(i)} />
          ))}
          {lockedFacets.map((f, i) => (
            <Chip key={`l-${i}`} type={f.name} label={f.selectedValues.join(", ")} locked onRemove={() => handleRemoveLocked(i)} />
          ))}
          <input
            value={newSeed}
            onChange={(e) => setNewSeed(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddSeed()}
            placeholder="Add seed..."
            className="explore-seed-input"
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <span className="explore-section-label">Generator</span>
          <button
            onClick={generating ? handlePause : runGeneration}
            className="map-btn"
            style={{ padding: "5px 16px", fontSize: 11 }}
            disabled={seeds.length === 0}
          >
            {generating ? "Pause" : "Generate"}
          </button>
          <button
            onClick={handleClear}
            className="map-btn"
            style={{ padding: "5px 16px", fontSize: 11, background: "transparent", color: "#262624" }}
          >
            Clear
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 12 }}>
            <span style={{ fontSize: 11, color: "rgba(38,38,36,0.5)" }}>Target:</span>
            <input
              type="range" min={5} max={50} value={targetCount}
              onChange={(e) => setTargetCount(Number(e.target.value))}
              style={{ width: 80 }}
            />
            <span style={{ fontSize: 12, color: "rgba(38,38,36,0.6)", fontFamily: "monospace", width: 24 }}>
              {targetCount}
            </span>
          </div>
        </div>
      </div>

      {/* Main area: faceted browser */}
      <div style={{ flex: 1, padding: 12, overflow: "auto" }}>
        {facets.length === 0 && ideas.length === 0 && !generating && (
          <div className="explore-empty">
            {seeds.length === 0
              ? <>Add seeds above or <a href="/map" style={{ color: "#262624", fontWeight: 600 }}>select submissions from the map</a>.</>
              : <>Press <strong>Generate</strong> to begin exploring the idea space.</>
            }
          </div>
        )}
        {facets.length === 0 && generating && (
          <div className="explore-empty">
            Generating initial ideas and discovering facets...
          </div>
        )}
        {facets.length > 0 && (
          <div style={{ display: "flex", gap: 10, height: "calc(100vh - 200px)" }}>
            {facets.map((f) => (
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
      </div>

      {/* Idea detail slide-out */}
      {selectedIdea && <IdeaDetail idea={selectedIdea} facets={facets} onClose={() => setSelectedIdea(null)} />}

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
