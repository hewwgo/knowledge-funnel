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
  showClusters: boolean;
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

function cleanTitle(title: string): string {
  if (title.startsWith("http")) {
    const parts = title.split("/").filter(Boolean);
    return decodeURIComponent(parts[parts.length - 1] || title).replace(/[-_]/g, " ").slice(0, 30);
  }
  return title;
}

export default function KnowledgeGraph({
  data, hiddenResearchers, searchQuery,
  onSelectNode, selectedNodeId,
  onSelectCluster, selectedClusterId,
  multiSelectIds, onToggleMultiSelect, showClusters,
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

    const g = svg.append("g");

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 10])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
        applySemanticZoom(event.transform.k);
      });
    svg.call(zoom);
    svg.on("click", () => { onSelectNode(""); onSelectCluster(-1); });

    const clusterData = clusters.map((cluster) => {
      const color = CLUSTER_COLORS[cluster.id % CLUSTER_COLORS.length];
      const cx = xScale(cluster.centroidX);
      const cy = yScale(cluster.centroidY);
      const sp: [number, number][] = cluster.points.map(([x, y]) => [xScale(x), yScale(y)]);
      return { ...cluster, color, cx, cy, sp };
    });

    const nodePos = new Map<string, { x: number; y: number }>();
    for (const n of nodes) nodePos.set(n.id, { x: xScale(n.x), y: yScale(n.y) });
    for (const h of hubs) nodePos.set(h.id, { x: xScale(h.x), y: yScale(h.y) });

    // ── Optional: K-means cluster regions (toggled via toolbar) ──
    const clusterOverlay = g.append("g").attr("class", "cluster-overlay");
    if (showClusters) {
      for (const c of clusterData) {
        if (c.sp.length < 3) continue;
        const hull = d3.polygonHull(c.sp);
        if (!hull) continue;
        const expanded = hull.map(([x, y]) => {
          const dx = x - c.cx, dy = y - c.cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          return [x + (dx / (dist || 1)) * 40, y + (dy / (dist || 1)) * 40] as [number, number];
        });
        const line = d3.line().curve(d3.curveCatmullRomClosed.alpha(0.5));
        clusterOverlay.append("path").attr("d", line(expanded))
          .attr("fill", hexToRgba(c.color, 0.05))
          .attr("stroke", hexToRgba(c.color, 0.2))
          .attr("stroke-width", 1)
          .attr("stroke-dasharray", "8,4");
        // Cluster label
        const topY = Math.min(...c.sp.map(p => p[1]));
        clusterOverlay.append("text")
          .attr("x", c.cx).attr("y", topY - 14)
          .attr("text-anchor", "middle")
          .attr("fill", hexToRgba(c.color, 0.7))
          .attr("font-size", "12px").attr("font-weight", "700")
          .text(c.label);
      }
    }

    // ── Layer 2: Hub spoke edges ──
    const edgeGroup = g.append("g").attr("class", "hub-edges");
    for (const edge of hubEdges) {
      const from = nodePos.get(edge.from);
      const to = nodePos.get(edge.to);
      if (!from || !to) continue;
      edgeGroup.append("line")
        .attr("x1", from.x).attr("y1", from.y)
        .attr("x2", to.x).attr("y2", to.y)
        .attr("stroke", "rgba(38,38,36,0.08)")
        .attr("stroke-width", 0.6)
        .attr("class", "hub-edge");
    }

    // ── Layer 3: Concept hub nodes ──
    const hubGroup = g.append("g").attr("class", "hub-nodes");
    const hubNode = hubGroup.selectAll<SVGGElement, ConceptHub>("g")
      .data(hubs).join("g")
      .attr("class", "hub-node-group")
      .attr("transform", (d) => `translate(${xScale(d.x)},${yScale(d.y)})`);

    const hubScale = d3.scaleSqrt()
      .domain([2, Math.max(...hubs.map(h => h.submissionCount), 3)])
      .range([12, 28]);

    hubNode.append("circle")
      .attr("r", (d) => hubScale(d.submissionCount))
      .attr("fill", "rgba(38,38,36,0.03)")
      .attr("stroke", "rgba(38,38,36,0.15)")
      .attr("stroke-width", 1)
      .attr("class", "hub-circle")
      .attr("cursor", "pointer");

    hubNode.append("text")
      .attr("text-anchor", "middle").attr("dy", 4)
      .attr("fill", "rgba(38,38,36,0.6)")
      .attr("font-size", "10px").attr("font-weight", "700")
      .attr("class", "hub-inner-label")
      .attr("pointer-events", "none")
      .text((d) => d.label.length > 20 ? d.label.slice(0, 18) + "…" : d.label);

    // Hub hover + click
    hubNode
      .on("mouseenter", (event, d) => {
        d3.select(event.currentTarget).select(".hub-circle")
          .attr("fill", "rgba(38,38,36,0.06)")
          .attr("stroke", "rgba(38,38,36,0.3)");
        tooltip.style("display", "block")
          .style("left", `${event.pageX + 14}px`)
          .style("top", `${event.pageY - 14}px`)
          .html(
            `<div style="margin-bottom:4px"><strong>${d.label}</strong></div>` +
            `<div style="color:rgba(255,255,255,0.6);font-size:11px">${d.submissionCount} submissions share this concept</div>`
          );
      })
      .on("mousemove", (event) => {
        tooltip.style("left", `${event.pageX + 14}px`).style("top", `${event.pageY - 14}px`);
      })
      .on("mouseleave", (event) => {
        d3.select(event.currentTarget).select(".hub-circle")
          .attr("fill", "rgba(38,38,36,0.03)")
          .attr("stroke", "rgba(38,38,36,0.15)");
        tooltip.style("display", "none");
      })
      .on("click", (event, d) => {
        event.stopPropagation();
        const hubMemberIds = new Set(
          hubEdges.filter(e => e.from === d.id).map(e => e.to)
        );

        // Highlight connected edges
        edgeGroup.selectAll<SVGLineElement, unknown>(".hub-edge").each(function () {
          const line = d3.select(this);
          const x1 = +line.attr("x1"), y1 = +line.attr("y1");
          const hubX = xScale(d.x), hubY = yScale(d.y);
          const isConnected = Math.abs(x1 - hubX) < 1 && Math.abs(y1 - hubY) < 1;
          line
            .attr("stroke", isConnected ? hexToRgba(CLUSTER_COLORS[0], 0.5) : "rgba(38,38,36,0.08)")
            .attr("stroke-width", isConnected ? 1.5 : 0.6);
        });

        // Highlight connected nodes
        node.each(function (n) {
          const el = d3.select(this);
          if (hubMemberIds.has(n.id)) {
            el.select(".graph-node")
              .transition().duration(150)
              .attr("r", NODE_R + 3)
              .attr("stroke", "#262624").attr("stroke-width", 2);
          }
        });
      });

    // ── Layer 4: Mega-dots (overview only) ──
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

    // ── Layer 5: Submission nodes ──
    const nodeGroup = g.append("g").attr("class", "nodes");
    const NODE_R = 5;
    const CARD_W = 145;
    const CARD_H = 24;
    const FOLD = 6;

    const node = nodeGroup.selectAll<SVGGElement, MapNode>("g")
      .data(nodes).join("g")
      .attr("class", "graph-node-group")
      .attr("transform", (d) => `translate(${xScale(d.x)},${yScale(d.y)})`)
      .attr("cursor", "pointer")
      .attr("opacity", 0);

    // Document-shaped card
    node.each(function (d) {
      const el = d3.select(this);
      const isPaper = d.contentType === "paper" || d.contentType === "link";
      const x = -CARD_W / 2, y = -CARD_H / 2;

      if (isPaper) {
        // Paper: clean white card with subtle fold
        el.append("path")
          .attr("class", "graph-card")
          .attr("d", `M${x},${y} L${x + CARD_W - FOLD},${y} L${x + CARD_W},${y + FOLD} L${x + CARD_W},${y + CARD_H} L${x},${y + CARD_H} Z`)
          .attr("fill", "#ffffff")
          .attr("stroke", hexToRgba(d.submitterColor, 0.25))
          .attr("stroke-width", 0.7)
          .attr("filter", "drop-shadow(0 0.5px 2px rgba(0,0,0,0.06))")
          .attr("opacity", 0);
        el.append("path")
          .attr("class", "graph-card-fold")
          .attr("d", `M${x + CARD_W - FOLD},${y} L${x + CARD_W - FOLD},${y + FOLD} L${x + CARD_W},${y + FOLD}`)
          .attr("fill", hexToRgba(d.submitterColor, 0.1))
          .attr("stroke", hexToRgba(d.submitterColor, 0.15))
          .attr("stroke-width", 0.4)
          .attr("opacity", 0);
      } else {
        // Note/idea: subtle tinted card with dashed border
        el.append("rect")
          .attr("class", "graph-card")
          .attr("x", x).attr("y", y)
          .attr("width", CARD_W).attr("height", CARD_H)
          .attr("rx", 4)
          .attr("fill", hexToRgba(d.submitterColor, 0.05))
          .attr("stroke", hexToRgba(d.submitterColor, 0.2))
          .attr("stroke-width", 0.7)
          .attr("stroke-dasharray", "3,2")
          .attr("opacity", 0);
      }
    });

    // Card title
    node.append("text").attr("class", "graph-card-title")
      .attr("x", -CARD_W / 2 + 6).attr("y", 1)
      .attr("fill", "#262624")
      .attr("font-size", "8px").attr("font-weight", "500")
      .attr("opacity", 0)
      .text((d) => {
        const t = cleanTitle(d.title);
        return t.length > 26 ? t.slice(0, 24) + "…" : t;
      });

    // Card submitter (shown at deeper zoom)
    node.append("text").attr("class", "graph-card-submitter")
      .attr("x", -CARD_W / 2 + 6).attr("y", 11)
      .attr("fill", "rgba(38,38,36,0.35)")
      .attr("font-size", "6.5px")
      .attr("opacity", 0)
      .text((d) => d.submitterName);

    // Dot (visible when not at card zoom)
    node.append("circle").attr("r", NODE_R)
      .attr("fill", (d) => d.submitterColor)
      .attr("class", "graph-node")
      .attr("stroke", "white").attr("stroke-width", 1);

    // Glow
    node.append("circle").attr("r", NODE_R + 5)
      .attr("fill", "none").attr("stroke", (d) => d.submitterColor)
      .attr("stroke-width", 0).attr("opacity", 0)
      .attr("class", "graph-node-glow");

    // ── Semantic zoom ──
    function applySemanticZoom(k: number) {
      const OVERVIEW = k < 0.65;
      const MID = k >= 0.65 && k < 1.5;
      const DETAIL = k >= 1.5;

      // Mega-dots: overview only
      megaGroup.selectAll(".mega-dot, .mega-dot-label, .mega-dot-count")
        .attr("opacity", OVERVIEW ? 1 : 0);

      // Hub edges + nodes
      edgeGroup.selectAll(".hub-edge").attr("opacity", OVERVIEW ? 0 : 1);
      hubNode.attr("opacity", OVERVIEW ? 0 : MID ? 1 : 0.5);
      // Scale hub labels with zoom
      hubNode.selectAll<SVGTextElement, unknown>(".hub-inner-label")
        .attr("font-size", `${Math.max(6, Math.min(10, 8 / k))}px`);

      // Submission nodes
      node.each(function (d) {
        const el = d3.select(this);
        if (OVERVIEW) { el.attr("opacity", 0); return; }
        if (!isNodeActive(d)) { el.attr("opacity", 0.06); return; }
        el.attr("opacity", 1);
        if (DETAIL) {
          el.selectAll(".graph-card, .graph-card-fold").attr("opacity", 1);
          el.select(".graph-card-title").attr("opacity", 1);
          el.select(".graph-card-submitter").attr("opacity", k > 2 ? 1 : 0);
          el.select(".graph-node").attr("opacity", 0);
        } else {
          el.selectAll(".graph-card, .graph-card-fold").attr("opacity", 0);
          el.select(".graph-card-title").attr("opacity", 0);
          el.select(".graph-card-submitter").attr("opacity", 0);
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
            `<div style="margin-bottom:4px"><strong>${cleanTitle(d.title)}</strong></div>` +
            `<div style="color:rgba(255,255,255,0.6);font-size:11px;margin-bottom:3px">${d.contentType} · ${d.submitterName}</div>` +
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
  }, [data, hiddenResearchers, searchQuery, isNodeActive, onSelectNode, onSelectCluster, selectedClusterId, showClusters]);

  // Selection highlight
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);

    svg.selectAll<SVGCircleElement, MapNode>(".graph-node")
      .attr("stroke", (d) =>
        d.id === selectedNodeId ? "#262624" : multiSelectIds.has(d.id) ? "#D55E00" : "white")
      .attr("stroke-width", (d) =>
        d.id === selectedNodeId ? 2 : multiSelectIds.has(d.id) ? 2 : 1);

    svg.selectAll<SVGElement, MapNode>(".graph-card")
      .attr("stroke-width", (d) =>
        d.id === selectedNodeId ? 1.5 : multiSelectIds.has(d.id) ? 1.5 : 0.8)
      .attr("stroke", (d) =>
        d.id === selectedNodeId ? "#262624" : multiSelectIds.has(d.id) ? "#D55E00" : hexToRgba(d.submitterColor, 0.3));

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
        const m = d.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          d.concepts.some((c) => c.toLowerCase().includes(searchQuery.toLowerCase()));
        d3.select(this).select(".graph-node-glow")
          .attr("stroke-width", m ? 2 : 0).attr("opacity", m ? 0.4 : 0);
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
