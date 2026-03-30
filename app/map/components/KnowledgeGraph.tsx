"use client";

import { useEffect, useRef, useCallback } from "react";
import * as d3 from "d3";
import type { MapData, MapNode } from "../page";

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

// Cluster palette
const CLUSTER_COLORS = [
  "#E69F00", "#56B4E9", "#009E73", "#CC79A7",
  "#0072B2", "#D55E00", "#F0E442", "#66A61E",
];

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
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

    const xScale = d3.scaleLinear().domain([0, 1000]).range([100, width - 100]);
    const yScale = d3.scaleLinear().domain([0, 1000]).range([100, height - 100]);

    // Defs
    const defs = svg.append("defs");
    const blur = defs.append("filter").attr("id", "blob-blur")
      .attr("x", "-40%").attr("y", "-40%").attr("width", "180%").attr("height", "180%");
    blur.append("feGaussianBlur").attr("in", "SourceGraphic").attr("stdDeviation", "20");

    const g = svg.append("g");

    // Zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 10])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
        applySemanticZoom(event.transform.k);
      });
    svg.call(zoom);
    svg.on("click", () => { onSelectNode(""); onSelectCluster(-1); });

    // ── Precompute cluster data ──
    const clusterData = clusters.map((cluster) => {
      const colorIdx = cluster.id % CLUSTER_COLORS.length;
      const color = CLUSTER_COLORS[colorIdx];
      const cx = xScale(cluster.centroidX);
      const cy = yScale(cluster.centroidY);
      const scaledPoints: [number, number][] = cluster.points.map(
        ([x, y]) => [xScale(x), yScale(y)]
      );
      // Cluster radius = max distance from centroid to any point
      const radius = Math.max(40, ...scaledPoints.map(([x, y]) =>
        Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
      ));
      return { ...cluster, color, cx, cy, scaledPoints, radius };
    });

    // ── Layer 1: Cluster blobs (soft background) ──
    const hullGroup = g.append("g").attr("class", "hulls");

    for (const c of clusterData) {
      if (c.scaledPoints.length < 3) continue;

      const hull = d3.polygonHull(c.scaledPoints);
      if (!hull) continue;

      const expandedHull = hull.map(([x, y]) => {
        const dx = x - c.cx;
        const dy = y - c.cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        return [x + (dx / (dist || 1)) * 45, y + (dy / (dist || 1)) * 45] as [number, number];
      });

      const line = d3.line().curve(d3.curveCatmullRomClosed.alpha(0.5));
      const isSelected = c.id === selectedClusterId;

      // Blurred blob
      hullGroup.append("path")
        .attr("d", line(expandedHull))
        .attr("fill", hexToRgba(c.color, isSelected ? 0.12 : 0.06))
        .attr("stroke", "none")
        .attr("filter", "url(#blob-blur)")
        .attr("class", "cluster-blob");

      // Outline
      hullGroup.append("path")
        .attr("d", line(expandedHull))
        .attr("fill", "none")
        .attr("stroke", hexToRgba(c.color, isSelected ? 0.35 : 0.15))
        .attr("stroke-width", isSelected ? 1.5 : 0.75)
        .attr("class", "cluster-outline")
        .attr("cursor", "pointer")
        .on("click", (event) => { event.stopPropagation(); onSelectCluster(c.id); });
    }

    // ── Layer 2: Cluster mega-dots (visible when very zoomed out) ──
    const megaDotGroup = g.append("g").attr("class", "mega-dots");

    for (const c of clusterData) {
      const megaR = Math.max(20, Math.min(40, c.memberCount * 4));

      // Big dot
      megaDotGroup.append("circle")
        .attr("cx", c.cx)
        .attr("cy", c.cy)
        .attr("r", megaR)
        .attr("fill", hexToRgba(c.color, 0.25))
        .attr("stroke", hexToRgba(c.color, 0.5))
        .attr("stroke-width", 2)
        .attr("class", "mega-dot")
        .attr("cursor", "pointer")
        .on("click", (event) => { event.stopPropagation(); onSelectCluster(c.id); });

      // Mega-dot label
      megaDotGroup.append("text")
        .attr("x", c.cx)
        .attr("y", c.cy + megaR + 18)
        .attr("text-anchor", "middle")
        .attr("fill", "#262624")
        .attr("font-size", "14px")
        .attr("font-weight", "700")
        .attr("letter-spacing", "0.03em")
        .attr("class", "mega-dot-label")
        .text(c.label);

      // Count inside dot
      megaDotGroup.append("text")
        .attr("x", c.cx)
        .attr("y", c.cy + 4)
        .attr("text-anchor", "middle")
        .attr("fill", hexToRgba(c.color, 0.8))
        .attr("font-size", "13px")
        .attr("font-weight", "700")
        .attr("class", "mega-dot-count")
        .text(c.memberCount);
    }

    // ── Layer 3: Cluster labels (mid-zoom) ──
    const labelGroup = g.append("g").attr("class", "cluster-labels");

    for (const c of clusterData) {
      if (c.scaledPoints.length < 2) continue;
      const topY = Math.min(...c.scaledPoints.map(p => p[1]));

      labelGroup.append("text")
        .attr("x", c.cx)
        .attr("y", topY - 18)
        .attr("text-anchor", "middle")
        .attr("fill", hexToRgba(c.color, 0.85))
        .attr("font-size", "13px")
        .attr("font-weight", "700")
        .attr("letter-spacing", "0.04em")
        .attr("class", "cluster-label")
        .attr("cursor", "pointer")
        .attr("opacity", 0)
        .on("click", (event) => { event.stopPropagation(); onSelectCluster(c.id); })
        .text(c.label);
    }

    // ── Layer 4: Connection edges (top-K nearest neighbors) ──
    const edgeGroup = g.append("g").attr("class", "nn-edges");
    const K_NEIGHBORS = 2; // connect each node to its 2 closest neighbors

    // Precompute distances between all pairs
    interface EdgeData { a: MapNode; b: MapNode; dist: number }
    const allEdges: EdgeData[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const dists: { node: MapNode; dist: number }[] = [];
      for (let j = 0; j < nodes.length; j++) {
        if (i === j) continue;
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        dists.push({ node: nodes[j], dist: Math.sqrt(dx * dx + dy * dy) });
      }
      dists.sort((a, b) => a.dist - b.dist);
      for (let k = 0; k < Math.min(K_NEIGHBORS, dists.length); k++) {
        allEdges.push({ a: nodes[i], b: dists[k].node, dist: dists[k].dist });
      }
    }

    // Deduplicate and draw
    const maxDist = Math.max(...allEdges.map(e => e.dist), 1);
    const drawnEdges = new Set<string>();
    for (const edge of allEdges) {
      const key = [edge.a.id, edge.b.id].sort().join("-");
      if (drawnEdges.has(key)) continue;
      drawnEdges.add(key);

      // Thickness and opacity based on distance (closer = thicker)
      const proximity = 1 - (edge.dist / maxDist);
      const sameCluster = edge.a.clusterId != null && edge.a.clusterId === edge.b.clusterId;
      const strokeW = sameCluster ? 0.5 + proximity * 2 : 0.3 + proximity * 1;
      const strokeOpacity = sameCluster ? 0.08 + proximity * 0.15 : 0.03 + proximity * 0.08;

      edgeGroup.append("line")
        .attr("x1", xScale(edge.a.x)).attr("y1", yScale(edge.a.y))
        .attr("x2", xScale(edge.b.x)).attr("y2", yScale(edge.b.y))
        .attr("stroke", sameCluster ? "rgba(38,38,36,1)" : "rgba(38,38,36,1)")
        .attr("stroke-width", strokeW)
        .attr("stroke-opacity", strokeOpacity)
        .attr("class", "nn-edge")
        .attr("opacity", 0); // controlled by semantic zoom
    }

    // ── Layer 5: Nodes ──
    const nodeGroup = g.append("g").attr("class", "nodes");
    const NODE_R = 6;
    const CARD_W = 165;
    const CARD_H = 40;

    const node = nodeGroup
      .selectAll<SVGGElement, MapNode>("g")
      .data(nodes)
      .join("g")
      .attr("class", "graph-node-group")
      .attr("transform", (d) => `translate(${xScale(d.x)},${yScale(d.y)})`)
      .attr("cursor", "pointer")
      .attr("opacity", 0); // start hidden, semantic zoom reveals

    // Card rect
    node.append("rect")
      .attr("class", "graph-card")
      .attr("x", -CARD_W / 2).attr("y", -CARD_H / 2)
      .attr("width", CARD_W).attr("height", CARD_H)
      .attr("rx", 2)
      .attr("fill", (d) => hexToRgba(d.submitterColor, 0.06))
      .attr("stroke", "rgba(38,38,36,0.1)")
      .attr("stroke-width", 0.5)
      .attr("opacity", 0);

    // Card title
    node.append("text")
      .attr("class", "graph-card-title")
      .attr("x", -CARD_W / 2 + 10).attr("y", -2)
      .attr("fill", "#262624")
      .attr("font-size", "9px").attr("font-weight", "600")
      .attr("opacity", 0)
      .text((d) => d.title.length > 28 ? d.title.slice(0, 26) + "…" : d.title);

    // Card submitter
    node.append("text")
      .attr("class", "graph-card-submitter")
      .attr("x", -CARD_W / 2 + 10).attr("y", 11)
      .attr("fill", "rgba(38,38,36,0.4)")
      .attr("font-size", "8px")
      .attr("opacity", 0)
      .text((d) => d.submitterName);

    // Dot
    node.append("circle")
      .attr("r", NODE_R)
      .attr("fill", (d) => d.submitterColor)
      .attr("class", "graph-node")
      .attr("stroke", "white")
      .attr("stroke-width", 1.5);

    // Glow
    node.append("circle")
      .attr("r", NODE_R + 6)
      .attr("fill", "none")
      .attr("stroke", (d) => d.submitterColor)
      .attr("stroke-width", 0)
      .attr("opacity", 0)
      .attr("class", "graph-node-glow");

    // ── Semantic zoom — 3 levels ──
    function applySemanticZoom(k: number) {
      const LEVEL_OVERVIEW = k < 0.65;  // Mega-dots only
      const LEVEL_MID = k >= 0.65 && k < 1.5; // Dots + cluster labels + edges
      const LEVEL_DETAIL = k >= 1.5;   // Cards

      // Mega-dots: visible only at overview
      megaDotGroup.selectAll(".mega-dot, .mega-dot-label, .mega-dot-count")
        .attr("opacity", LEVEL_OVERVIEW ? 1 : 0);

      // Cluster blobs: visible at mid and detail
      hullGroup.selectAll(".cluster-blob, .cluster-outline")
        .attr("opacity", LEVEL_OVERVIEW ? 0 : 1);

      // Cluster labels: visible at mid, scale inversely with zoom for readability
      labelGroup.selectAll<SVGTextElement, unknown>(".cluster-label")
        .attr("opacity", LEVEL_MID ? 0.8 : LEVEL_DETAIL ? 0.35 : 0)
        .attr("font-size", `${Math.max(10, Math.min(16, 13 / k))}px`);

      // Connection edges: visible at mid and detail, key visual element
      edgeGroup.selectAll(".nn-edge")
        .attr("opacity", LEVEL_OVERVIEW ? 0 : 1);

      // Nodes
      node.each(function (d) {
        const el = d3.select(this);
        const active = isNodeActive(d);

        if (LEVEL_OVERVIEW) {
          el.attr("opacity", 0);
          return;
        }

        if (!active) {
          el.attr("opacity", 0.06);
          return;
        }

        el.attr("opacity", 1);

        if (LEVEL_DETAIL) {
          el.select(".graph-card").attr("opacity", 1);
          el.select(".graph-card-title").attr("opacity", 1);
          el.select(".graph-card-submitter").attr("opacity", k > 2 ? 1 : 0);
          el.select(".graph-node").attr("opacity", 0);
        } else {
          el.select(".graph-card").attr("opacity", 0);
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

        const icon = d.contentType === "paper" ? "📄" : d.contentType === "link" ? "🔗" : d.contentType === "idea" ? "💡" : "📝";
        tooltip.style("display", "block")
          .style("left", `${event.pageX + 14}px`)
          .style("top", `${event.pageY - 14}px`)
          .html(
            `<div style="margin-bottom:4px"><strong>${icon} ${d.title}</strong></div>` +
            `<div style="color:rgba(255,255,255,0.6);font-size:11px;margin-bottom:3px">by ${d.submitterName}</div>` +
            (d.concepts.length > 0 ? `<div style="color:rgba(255,255,255,0.4);font-size:10px">${d.concepts.join(" · ")}</div>` : "") +
            `<div style="color:rgba(255,255,255,0.3);font-size:9px;margin-top:4px">Click to inspect · Shift+click to select</div>`
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
        d.id === selectedNodeId ? 2.5 : multiSelectIds.has(d.id) ? 2 : 1.5);

    svg.selectAll<SVGRectElement, MapNode>(".graph-card")
      .attr("stroke-width", (d) =>
        d.id === selectedNodeId ? 2 : multiSelectIds.has(d.id) ? 2 : 0.5)
      .attr("stroke", (d) =>
        d.id === selectedNodeId ? "#262624" : multiSelectIds.has(d.id) ? "#D55E00" : "rgba(38,38,36,0.1)");

    // Multi-select lines
    const g = svg.select("g");
    g.selectAll(".multi-select-line").remove();
    const sel = data.nodes.filter((n) => multiSelectIds.has(n.id));
    if (sel.length >= 2) {
      const xs = d3.scaleLinear().domain([0, 1000]).range([100, svgRef.current.clientWidth - 100]);
      const ys = d3.scaleLinear().domain([0, 1000]).range([100, svgRef.current.clientHeight - 100]);
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
