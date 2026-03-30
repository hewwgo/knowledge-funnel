"use client";

import { useEffect, useRef, useCallback } from "react";
import * as d3 from "d3";
import type { MapData, MapNode, ConceptHub } from "../page";

interface Props {
  data: MapData;
  hiddenResearchers: Set<string>;
  searchQuery: string;
  onSelectNode: (id: string) => void;
  selectedNodeId: string | null;
  onSelectCluster: (id: number) => void;
  selectedClusterId: number | null;
  multiSelectIds: Set<string>;
  onToggleMultiSelect: (id: string) => void;
}

const CLUSTER_COLORS = [
  "#E69F00", "#56B4E9", "#009E73", "#CC79A7",
  "#0072B2", "#D55E00", "#F0E442", "#66A61E",
];

function hexToRgba(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// Content type icons as unicode
function contentIcon(type: string): string {
  switch (type) {
    case "paper": return "📄";
    case "link": return "🔗";
    case "idea": return "💡";
    default: return "📝";
  }
}

// Clean up title — remove URLs, filenames
function cleanTitle(title: string): string {
  if (title.startsWith("http")) {
    // Extract last meaningful segment from URL
    const parts = title.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || title;
    return decodeURIComponent(last).replace(/[-_]/g, " ").slice(0, 30);
  }
  return title;
}

export default function KnowledgeGraph({
  data, hiddenResearchers, searchQuery,
  onSelectNode, selectedNodeId,
  onSelectCluster, selectedClusterId,
  multiSelectIds, onToggleMultiSelect,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const isNodeActive = useCallback(
    (node: MapNode) => {
      if (hiddenResearchers.has(node.submitterId)) return false;
      if (searchQuery &&
        !node.title.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !node.concepts.some((c) => c.toLowerCase().includes(searchQuery.toLowerCase()))
      ) return false;
      return true;
    },
    [hiddenResearchers, searchQuery]
  );

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const tooltip = d3.select(tooltipRef.current!);
    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    svg.selectAll("*").remove();

    const nodes = data.nodes;
    const clusters = data.clusters;
    const hubs = data.conceptHubs || [];
    const hubEdges = data.conceptEdges || [];

    const xScale = d3.scaleLinear().domain([0, 1000]).range([80, width - 80]);
    const yScale = d3.scaleLinear().domain([0, 1000]).range([80, height - 80]);

    // Defs
    const defs = svg.append("defs");
    const blur = defs.append("filter").attr("id", "blob-blur")
      .attr("x", "-40%").attr("y", "-40%").attr("width", "180%").attr("height", "180%");
    blur.append("feGaussianBlur").attr("in", "SourceGraphic").attr("stdDeviation", "20");

    const g = svg.append("g");

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 10])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
        applySemanticZoom(event.transform.k);
      });
    svg.call(zoom);
    svg.on("click", () => { onSelectNode(""); onSelectCluster(-1); });

    // ── Precompute ──
    const clusterData = clusters.map((cluster) => {
      const color = CLUSTER_COLORS[cluster.id % CLUSTER_COLORS.length];
      const cx = xScale(cluster.centroidX);
      const cy = yScale(cluster.centroidY);
      const sp: [number, number][] = cluster.points.map(([x, y]) => [xScale(x), yScale(y)]);
      return { ...cluster, color, cx, cy, sp };
    });

    // Build node position lookup
    const nodePos = new Map<string, { x: number; y: number }>();
    for (const n of nodes) nodePos.set(n.id, { x: xScale(n.x), y: yScale(n.y) });
    for (const h of hubs) nodePos.set(h.id, { x: xScale(h.x), y: yScale(h.y) });

    // ── Layer 1: Cluster blobs ──
    const hullGroup = g.append("g").attr("class", "hulls");
    for (const c of clusterData) {
      if (c.sp.length < 3) continue;
      const hull = d3.polygonHull(c.sp);
      if (!hull) continue;
      const expanded = hull.map(([x, y]) => {
        const dx = x - c.cx, dy = y - c.cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        return [x + (dx / (dist || 1)) * 45, y + (dy / (dist || 1)) * 45] as [number, number];
      });
      const line = d3.line().curve(d3.curveCatmullRomClosed.alpha(0.5));
      const sel = c.id === selectedClusterId;
      hullGroup.append("path").attr("d", line(expanded))
        .attr("fill", hexToRgba(c.color, sel ? 0.1 : 0.04))
        .attr("stroke", "none").attr("filter", "url(#blob-blur)")
        .attr("class", "cluster-blob");
      hullGroup.append("path").attr("d", line(expanded))
        .attr("fill", "none")
        .attr("stroke", hexToRgba(c.color, sel ? 0.3 : 0.12))
        .attr("stroke-width", sel ? 1.5 : 0.5)
        .attr("class", "cluster-outline").attr("cursor", "pointer")
        .on("click", (event) => { event.stopPropagation(); onSelectCluster(c.id); });
    }

    // ── Layer 2: Mega-dots (overview) ──
    const megaGroup = g.append("g").attr("class", "mega-dots");
    for (const c of clusterData) {
      const r = Math.max(18, Math.min(36, c.memberCount * 3.5));
      megaGroup.append("circle").attr("cx", c.cx).attr("cy", c.cy).attr("r", r)
        .attr("fill", hexToRgba(c.color, 0.2))
        .attr("stroke", hexToRgba(c.color, 0.45))
        .attr("stroke-width", 1.5).attr("class", "mega-dot")
        .attr("cursor", "pointer")
        .on("click", (e) => { e.stopPropagation(); onSelectCluster(c.id); });
      megaGroup.append("text").attr("x", c.cx).attr("y", c.cy + r + 15)
        .attr("text-anchor", "middle").attr("fill", "#262624")
        .attr("font-size", "13px").attr("font-weight", "700")
        .attr("class", "mega-dot-label").text(c.label);
      megaGroup.append("text").attr("x", c.cx).attr("y", c.cy + 4)
        .attr("text-anchor", "middle").attr("fill", hexToRgba(c.color, 0.7))
        .attr("font-size", "12px").attr("font-weight", "700")
        .attr("class", "mega-dot-count").text(c.memberCount);
    }

    // ── Layer 3: Cluster labels ──
    const labelGroup = g.append("g").attr("class", "cluster-labels");
    for (const c of clusterData) {
      if (c.sp.length < 2) continue;
      const topY = Math.min(...c.sp.map(p => p[1]));
      labelGroup.append("text").attr("x", c.cx).attr("y", topY - 16)
        .attr("text-anchor", "middle")
        .attr("fill", hexToRgba(c.color, 0.85))
        .attr("font-size", "13px").attr("font-weight", "700")
        .attr("letter-spacing", "0.04em")
        .attr("class", "cluster-label").attr("opacity", 0)
        .attr("cursor", "pointer")
        .on("click", (e) => { e.stopPropagation(); onSelectCluster(c.id); })
        .text(c.label);
    }

    // ── Layer 4: Concept hub edges (spokes) ──
    const edgeGroup = g.append("g").attr("class", "hub-edges");
    for (const edge of hubEdges) {
      const from = nodePos.get(edge.from);
      const to = nodePos.get(edge.to);
      if (!from || !to) continue;
      edgeGroup.append("line")
        .attr("x1", from.x).attr("y1", from.y)
        .attr("x2", to.x).attr("y2", to.y)
        .attr("stroke", "rgba(38,38,36,0.12)")
        .attr("stroke-width", 0.8)
        .attr("class", "hub-edge")
        .attr("opacity", 0);
    }

    // ── Layer 5: Concept hub nodes ──
    const hubGroup = g.append("g").attr("class", "hub-nodes");
    const hubNode = hubGroup.selectAll<SVGGElement, ConceptHub>("g")
      .data(hubs).join("g")
      .attr("class", "hub-node-group")
      .attr("transform", (d) => `translate(${xScale(d.x)},${yScale(d.y)})`)
      .attr("opacity", 0);

    // Hub circle — larger, semi-transparent
    hubNode.append("circle")
      .attr("r", (d) => Math.max(10, Math.min(20, d.submissionCount * 3)))
      .attr("fill", "rgba(38,38,36,0.04)")
      .attr("stroke", "rgba(38,38,36,0.2)")
      .attr("stroke-width", 1)
      .attr("class", "hub-circle");

    // Hub label
    hubNode.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", (d) => -(Math.max(10, Math.min(20, d.submissionCount * 3)) + 6))
      .attr("fill", "rgba(38,38,36,0.5)")
      .attr("font-size", "9px")
      .attr("font-weight", "600")
      .attr("font-style", "italic")
      .attr("class", "hub-label")
      .text((d) => d.label);

    // ── Layer 6: Submission nodes ──
    const nodeGroup = g.append("g").attr("class", "nodes");
    const NODE_R = 5;
    const CARD_W = 130;
    const CARD_H = 28;

    const node = nodeGroup.selectAll<SVGGElement, MapNode>("g")
      .data(nodes).join("g")
      .attr("class", "graph-node-group")
      .attr("transform", (d) => `translate(${xScale(d.x)},${yScale(d.y)})`)
      .attr("cursor", "pointer")
      .attr("opacity", 0);

    // Card rect
    node.append("rect").attr("class", "graph-card")
      .attr("x", -CARD_W / 2).attr("y", -CARD_H / 2)
      .attr("width", CARD_W).attr("height", CARD_H)
      .attr("rx", 2)
      .attr("fill", (d) => hexToRgba(d.submitterColor, 0.06))
      .attr("stroke", "rgba(38,38,36,0.08)")
      .attr("stroke-width", 0.5)
      .attr("opacity", 0);

    // Card content: icon + title (compact)
    node.append("text").attr("class", "graph-card-title")
      .attr("x", -CARD_W / 2 + 6).attr("y", 1)
      .attr("fill", "#262624")
      .attr("font-size", "8px").attr("font-weight", "500")
      .attr("opacity", 0)
      .text((d) => {
        const icon = contentIcon(d.contentType);
        const t = cleanTitle(d.title);
        return `${icon} ${t.length > 22 ? t.slice(0, 20) + "…" : t}`;
      });

    // Dot
    node.append("circle").attr("r", NODE_R)
      .attr("fill", (d) => d.submitterColor)
      .attr("class", "graph-node")
      .attr("stroke", "white").attr("stroke-width", 1);

    // Glow
    node.append("circle").attr("r", NODE_R + 5)
      .attr("fill", "none").attr("stroke", (d) => d.submitterColor)
      .attr("stroke-width", 0).attr("opacity", 0)
      .attr("class", "graph-node-glow");

    // ── Semantic zoom — 3 levels ──
    function applySemanticZoom(k: number) {
      const OVERVIEW = k < 0.65;
      const MID = k >= 0.65 && k < 1.5;
      const DETAIL = k >= 1.5;

      // Mega-dots
      megaGroup.selectAll(".mega-dot, .mega-dot-label, .mega-dot-count")
        .attr("opacity", OVERVIEW ? 1 : 0);

      // Cluster blobs
      hullGroup.selectAll(".cluster-blob, .cluster-outline")
        .attr("opacity", OVERVIEW ? 0 : 1);

      // Cluster labels — scale with zoom
      labelGroup.selectAll<SVGTextElement, unknown>(".cluster-label")
        .attr("opacity", MID ? 0.8 : DETAIL ? 0.3 : 0)
        .attr("font-size", `${Math.max(10, Math.min(16, 13 / k))}px`);

      // Hub edges — visible at mid+
      edgeGroup.selectAll(".hub-edge")
        .attr("opacity", OVERVIEW ? 0 : MID ? 0.7 : 0.4);

      // Hub nodes — visible at mid
      hubNode.attr("opacity", OVERVIEW ? 0 : MID ? 1 : 0.4);

      // Submission nodes
      node.each(function (d) {
        const el = d3.select(this);
        if (OVERVIEW) { el.attr("opacity", 0); return; }
        if (!isNodeActive(d)) { el.attr("opacity", 0.06); return; }
        el.attr("opacity", 1);
        if (DETAIL) {
          el.select(".graph-card").attr("opacity", 1);
          el.select(".graph-card-title").attr("opacity", 1);
          el.select(".graph-node").attr("opacity", 0);
        } else {
          el.select(".graph-card").attr("opacity", 0);
          el.select(".graph-card-title").attr("opacity", 0);
          el.select(".graph-node").attr("opacity", 1);
        }
      });
    }

    // ── Interactions ──
    node
      .on("mouseenter", (event, d) => {
        if (!isNodeActive(d)) return;
        d3.select(event.currentTarget).select(".graph-node-glow")
          .attr("stroke-width", 2).attr("opacity", 0.3);
        d3.select(event.currentTarget).select(".graph-node")
          .transition().duration(80).attr("r", NODE_R + 2);

        tooltip.style("display", "block")
          .style("left", `${event.pageX + 14}px`)
          .style("top", `${event.pageY - 14}px`)
          .html(
            `<div style="margin-bottom:4px"><strong>${contentIcon(d.contentType)} ${cleanTitle(d.title)}</strong></div>` +
            `<div style="color:rgba(255,255,255,0.6);font-size:11px;margin-bottom:3px">by ${d.submitterName}</div>` +
            (d.concepts.length > 0 ? `<div style="color:rgba(255,255,255,0.4);font-size:10px">${d.concepts.join(" · ")}</div>` : "") +
            `<div style="color:rgba(255,255,255,0.3);font-size:9px;margin-top:4px">Click · Shift+click to select</div>`
          );
      })
      .on("mousemove", (event) => {
        tooltip.style("left", `${event.pageX + 14}px`).style("top", `${event.pageY - 14}px`);
      })
      .on("mouseleave", (event) => {
        d3.select(event.currentTarget).select(".graph-node-glow")
          .attr("stroke-width", 0).attr("opacity", 0);
        d3.select(event.currentTarget).select(".graph-node")
          .transition().duration(80).attr("r", NODE_R);
        tooltip.style("display", "none");
      })
      .on("click", (event, d) => {
        event.stopPropagation();
        if (!isNodeActive(d)) return;
        if (event.shiftKey) onToggleMultiSelect(d.id);
        else onSelectNode(d.id);
      });

    applySemanticZoom(1);
    return () => { svg.selectAll("*").remove(); };
  }, [data, hiddenResearchers, searchQuery, isNodeActive, onSelectNode, onSelectCluster, selectedClusterId]);

  // Selection highlight
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);

    svg.selectAll<SVGCircleElement, MapNode>(".graph-node")
      .attr("stroke", (d) =>
        d.id === selectedNodeId ? "#262624" : multiSelectIds.has(d.id) ? "#D55E00" : "white")
      .attr("stroke-width", (d) =>
        d.id === selectedNodeId ? 2 : multiSelectIds.has(d.id) ? 2 : 1);

    svg.selectAll<SVGRectElement, MapNode>(".graph-card")
      .attr("stroke-width", (d) =>
        d.id === selectedNodeId ? 1.5 : multiSelectIds.has(d.id) ? 1.5 : 0.5)
      .attr("stroke", (d) =>
        d.id === selectedNodeId ? "#262624" : multiSelectIds.has(d.id) ? "#D55E00" : "rgba(38,38,36,0.08)");

    // Multi-select lines
    const g = svg.select("g");
    g.selectAll(".multi-select-line").remove();
    const sel = data.nodes.filter((n) => multiSelectIds.has(n.id));
    if (sel.length >= 2) {
      const xs = d3.scaleLinear().domain([0, 1000]).range([80, svgRef.current.clientWidth - 80]);
      const ys = d3.scaleLinear().domain([0, 1000]).range([80, svgRef.current.clientHeight - 80]);
      for (let i = 0; i < sel.length - 1; i++) {
        g.append("line").attr("class", "multi-select-line")
          .attr("x1", xs(sel[i].x)).attr("y1", ys(sel[i].y))
          .attr("x2", xs(sel[i + 1].x)).attr("y2", ys(sel[i + 1].y))
          .attr("stroke", "#D55E00").attr("stroke-width", 1.5)
          .attr("stroke-dasharray", "6,4").attr("opacity", 0.5)
          .attr("pointer-events", "none");
      }
    }

    // Search glow
    if (searchQuery) {
      svg.selectAll<SVGGElement, MapNode>(".graph-node-group").each(function (d) {
        const matches = d.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          d.concepts.some((c) => c.toLowerCase().includes(searchQuery.toLowerCase()));
        d3.select(this).select(".graph-node-glow")
          .attr("stroke-width", matches ? 2 : 0).attr("opacity", matches ? 0.4 : 0);
      });
    } else {
      svg.selectAll(".graph-node-glow").attr("stroke-width", 0).attr("opacity", 0);
    }
  }, [selectedNodeId, multiSelectIds, data.nodes, searchQuery]);

  return (
    <div className="map-canvas">
      <svg ref={svgRef} className="map-svg" />
      <div ref={tooltipRef} className="map-tooltip" />
    </div>
  );
}
