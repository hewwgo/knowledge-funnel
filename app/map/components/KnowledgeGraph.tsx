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

// Soft cluster palette
const CLUSTER_FILLS = [
  "rgba(230, 159, 0, 0.06)",
  "rgba(86, 180, 233, 0.06)",
  "rgba(0, 158, 115, 0.06)",
  "rgba(204, 121, 167, 0.06)",
  "rgba(0, 114, 178, 0.06)",
  "rgba(213, 94, 0, 0.06)",
  "rgba(240, 228, 66, 0.06)",
  "rgba(102, 166, 30, 0.06)",
];

const CLUSTER_STROKES = [
  "rgba(230, 159, 0, 0.18)",
  "rgba(86, 180, 233, 0.18)",
  "rgba(0, 158, 115, 0.18)",
  "rgba(204, 121, 167, 0.18)",
  "rgba(0, 114, 178, 0.18)",
  "rgba(213, 94, 0, 0.18)",
  "rgba(240, 228, 66, 0.18)",
  "rgba(102, 166, 30, 0.18)",
];

// Hex color to rgba helper
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export default function KnowledgeGraph({
  data,
  hiddenResearchers,
  searchQuery,
  onSelectNode,
  selectedNodeId,
  onSelectCluster,
  selectedClusterId,
  multiSelectIds,
  onToggleMultiSelect,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const isNodeActive = useCallback(
    (node: MapNode) => {
      if (hiddenResearchers.has(node.submitterId)) return false;
      if (
        searchQuery &&
        !node.title.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !node.concepts.some((c) => c.toLowerCase().includes(searchQuery.toLowerCase()))
      )
        return false;
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

    // Defs for filters
    const defs = svg.append("defs");

    // Gaussian blur for cluster regions
    const blurFilter = defs.append("filter").attr("id", "cluster-blur")
      .attr("x", "-30%").attr("y", "-30%").attr("width", "160%").attr("height", "160%");
    blurFilter.append("feGaussianBlur").attr("in", "SourceGraphic").attr("stdDeviation", "18");

    const g = svg.append("g");

    // Zoom
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 8])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
        applySemanticZoom(event.transform.k);
      });
    svg.call(zoom);

    svg.on("click", () => {
      onSelectNode("");
      onSelectCluster(-1);
    });

    // ── Layer 1: Cluster regions (soft blobs) ──
    const hullGroup = g.append("g").attr("class", "hulls");

    for (const cluster of clusters) {
      if (cluster.points.length < 3) continue;

      const scaledPoints: [number, number][] = cluster.points.map(
        ([x, y]) => [xScale(x), yScale(y)]
      );

      const hull = d3.polygonHull(scaledPoints);
      if (!hull) continue;

      const cx = xScale(cluster.centroidX);
      const cy = yScale(cluster.centroidY);

      // Expand hull generously
      const expandedHull = hull.map(([x, y]) => {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const expand = 45;
        return [
          x + (dx / (dist || 1)) * expand,
          y + (dy / (dist || 1)) * expand,
        ] as [number, number];
      });

      const line = d3.line().curve(d3.curveCatmullRomClosed.alpha(0.5));
      const isSelected = cluster.id === selectedClusterId;
      const colorIdx = cluster.id % CLUSTER_FILLS.length;

      // Blurred background blob
      hullGroup
        .append("path")
        .attr("d", line(expandedHull))
        .attr("fill", isSelected
          ? CLUSTER_FILLS[colorIdx].replace("0.06", "0.12")
          : CLUSTER_FILLS[colorIdx])
        .attr("stroke", "none")
        .attr("filter", "url(#cluster-blur)")
        .attr("class", "cluster-blob");

      // Crisp outline on top
      hullGroup
        .append("path")
        .attr("d", line(expandedHull))
        .attr("fill", "none")
        .attr("stroke", isSelected
          ? CLUSTER_STROKES[colorIdx].replace("0.18", "0.4")
          : CLUSTER_STROKES[colorIdx])
        .attr("stroke-width", isSelected ? 1.5 : 0.75)
        .attr("class", "cluster-hull")
        .attr("cursor", "pointer")
        .on("click", (event) => {
          event.stopPropagation();
          onSelectCluster(cluster.id);
        });

      // Cluster label — large, at top of hull
      const topY = Math.min(...scaledPoints.map(p => p[1]));
      hullGroup
        .append("text")
        .attr("x", cx)
        .attr("y", topY - 20)
        .attr("text-anchor", "middle")
        .attr("fill", isSelected ? "rgba(38, 38, 36, 0.65)" : "rgba(38, 38, 36, 0.3)")
        .attr("font-size", "13px")
        .attr("font-weight", "700")
        .attr("letter-spacing", "0.06em")
        .attr("class", "cluster-label")
        .attr("cursor", "pointer")
        .on("click", (event) => {
          event.stopPropagation();
          onSelectCluster(cluster.id);
        })
        .text(cluster.label);
    }

    // ── Layer 2: Nearest-neighbor edges within clusters ──
    const edgeGroup = g.append("g").attr("class", "nn-edges");

    // For each cluster, connect each node to its nearest neighbor in same cluster
    const clusterNodes = new Map<number, MapNode[]>();
    for (const n of nodes) {
      if (n.clusterId === null || n.clusterId === undefined) continue;
      if (!clusterNodes.has(n.clusterId)) clusterNodes.set(n.clusterId, []);
      clusterNodes.get(n.clusterId)!.push(n);
    }

    const drawnEdges = new Set<string>();
    for (const [, members] of clusterNodes) {
      if (members.length < 2) continue;
      for (const node of members) {
        let nearest: MapNode | null = null;
        let nearestDist = Infinity;
        for (const other of members) {
          if (other.id === node.id) continue;
          const dx = node.x - other.x;
          const dy = node.y - other.y;
          const d = dx * dx + dy * dy;
          if (d < nearestDist) { nearestDist = d; nearest = other; }
        }
        if (!nearest) continue;
        const edgeKey = [node.id, nearest.id].sort().join("-");
        if (drawnEdges.has(edgeKey)) continue;
        drawnEdges.add(edgeKey);

        edgeGroup
          .append("line")
          .attr("x1", xScale(node.x))
          .attr("y1", yScale(node.y))
          .attr("x2", xScale(nearest.x))
          .attr("y2", yScale(nearest.y))
          .attr("stroke", "rgba(38, 38, 36, 0.06)")
          .attr("stroke-width", 0.75)
          .attr("class", "nn-edge");
      }
    }

    // ── Layer 3: Nodes (cards that collapse to dots) ──
    const nodeGroup = g.append("g").attr("class", "nodes");
    const NODE_R = 6;
    const CARD_W = 160;
    const CARD_H = 42;

    const node = nodeGroup
      .selectAll<SVGGElement, MapNode>("g")
      .data(nodes)
      .join("g")
      .attr("class", "graph-node-group")
      .attr("transform", (d) => `translate(${xScale(d.x)},${yScale(d.y)})`)
      .attr("cursor", "pointer");

    // Card background rect (visible when zoomed in)
    node
      .append("rect")
      .attr("class", "graph-card")
      .attr("x", -CARD_W / 2)
      .attr("y", -CARD_H / 2)
      .attr("width", CARD_W)
      .attr("height", CARD_H)
      .attr("rx", 2)
      .attr("fill", (d) => hexToRgba(d.submitterColor, 0.06))
      .attr("stroke", (d) => hexToRgba(d.submitterColor, 0.2))
      .attr("stroke-width", 1)
      .attr("opacity", 0)
      .attr("filter", "drop-shadow(0 1px 3px rgba(0,0,0,0.06))");

    // Card title text (visible when zoomed in)
    node
      .append("text")
      .attr("class", "graph-card-title")
      .attr("x", -CARD_W / 2 + 10)
      .attr("y", -4)
      .attr("fill", "#262624")
      .attr("font-size", "9px")
      .attr("font-weight", "600")
      .attr("opacity", 0)
      .text((d) => {
        const t = d.title || "";
        return t.length > 28 ? t.slice(0, 26) + "…" : t;
      });

    // Card submitter text
    node
      .append("text")
      .attr("class", "graph-card-submitter")
      .attr("x", -CARD_W / 2 + 10)
      .attr("y", 10)
      .attr("fill", "rgba(38,38,36,0.4)")
      .attr("font-size", "8px")
      .attr("font-weight", "400")
      .attr("opacity", 0)
      .text((d) => d.submitterName);

    // Dot circle (visible when zoomed out — the default)
    node
      .append("circle")
      .attr("r", NODE_R)
      .attr("fill", (d) => d.submitterColor)
      .attr("class", "graph-node")
      .attr("stroke", "white")
      .attr("stroke-width", 1.5)
      .attr("filter", "drop-shadow(0 1px 2px rgba(0,0,0,0.08))");

    // Hover glow
    node
      .append("circle")
      .attr("r", NODE_R + 6)
      .attr("fill", "none")
      .attr("stroke", (d) => d.submitterColor)
      .attr("stroke-width", 0)
      .attr("opacity", 0)
      .attr("class", "graph-node-glow");

    // ── Semantic zoom ──
    function applySemanticZoom(k: number) {
      const showCards = k > 2.0;
      const showEdges = k > 1.2;

      node.each(function (d) {
        const el = d3.select(this);
        const active = isNodeActive(d);

        if (!active) {
          el.attr("opacity", 0.06);
          return;
        }
        el.attr("opacity", 1);

        // Toggle card vs dot
        el.select(".graph-card").attr("opacity", showCards ? 1 : 0);
        el.select(".graph-card-title").attr("opacity", showCards ? 1 : 0);
        el.select(".graph-card-submitter").attr("opacity", showCards && k > 2.5 ? 1 : 0);
        el.select(".graph-node").attr("opacity", showCards ? 0 : 1);
      });

      // NN edges fade in
      edgeGroup.selectAll(".nn-edge")
        .attr("opacity", showEdges ? 0.08 : 0);

      // Cluster labels
      hullGroup.selectAll<SVGTextElement, unknown>(".cluster-label")
        .attr("opacity", k > 3 ? 0.15 : k < 0.7 ? 0.4 : 0.3);
    }

    // ── Interactions ──
    node
      .on("mouseenter", (event, d) => {
        if (!isNodeActive(d)) return;

        d3.select(event.currentTarget).select(".graph-node-glow")
          .attr("stroke-width", 2).attr("opacity", 0.3);
        d3.select(event.currentTarget).select(".graph-node")
          .transition().duration(80).attr("r", NODE_R + 2);

        const contentIcon =
          d.contentType === "paper" ? "📄" :
          d.contentType === "link" ? "🔗" :
          d.contentType === "idea" ? "💡" : "📝";

        tooltip
          .style("display", "block")
          .style("left", `${event.pageX + 14}px`)
          .style("top", `${event.pageY - 14}px`)
          .html(
            `<div style="margin-bottom:4px"><strong>${contentIcon} ${d.title}</strong></div>` +
            `<div style="color:rgba(255,255,255,0.6);font-size:11px;margin-bottom:3px">by ${d.submitterName}</div>` +
            (d.concepts.length > 0
              ? `<div style="color:rgba(255,255,255,0.4);font-size:10px">${d.concepts.join(" · ")}</div>`
              : "") +
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
        if (event.shiftKey) {
          onToggleMultiSelect(d.id);
        } else {
          onSelectNode(d.id);
        }
      });

    applySemanticZoom(1);

    return () => { svg.selectAll("*").remove(); };
  }, [data, hiddenResearchers, searchQuery, isNodeActive, onSelectNode, onSelectCluster, selectedClusterId]);

  // Selection highlight effect
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);

    svg.selectAll<SVGCircleElement, MapNode>(".graph-node")
      .attr("stroke", (d) =>
        d.id === selectedNodeId ? "#262624"
        : multiSelectIds.has(d.id) ? "#D55E00"
        : "white"
      )
      .attr("stroke-width", (d) =>
        d.id === selectedNodeId ? 2.5
        : multiSelectIds.has(d.id) ? 2
        : 1.5
      );

    // Card highlight
    svg.selectAll<SVGRectElement, MapNode>(".graph-card")
      .attr("stroke-width", (d) =>
        d.id === selectedNodeId ? 2
        : multiSelectIds.has(d.id) ? 2
        : 1
      )
      .attr("stroke", (d) =>
        d.id === selectedNodeId ? "#262624"
        : multiSelectIds.has(d.id) ? "#D55E00"
        : hexToRgba(d.submitterColor, 0.2)
      );

    // Multi-select connecting lines
    const g = svg.select("g");
    g.selectAll(".multi-select-line").remove();

    const selectedNodes = data.nodes.filter((n) => multiSelectIds.has(n.id));
    if (selectedNodes.length >= 2) {
      const xScale = d3.scaleLinear().domain([0, 1000]).range([100, svgRef.current.clientWidth - 100]);
      const yScale = d3.scaleLinear().domain([0, 1000]).range([100, svgRef.current.clientHeight - 100]);

      for (let i = 0; i < selectedNodes.length - 1; i++) {
        const a = selectedNodes[i];
        const b = selectedNodes[i + 1];
        g.append("line")
          .attr("class", "multi-select-line")
          .attr("x1", xScale(a.x)).attr("y1", yScale(a.y))
          .attr("x2", xScale(b.x)).attr("y2", yScale(b.y))
          .attr("stroke", "#D55E00")
          .attr("stroke-width", 1.5)
          .attr("stroke-dasharray", "6,4")
          .attr("opacity", 0.5)
          .attr("pointer-events", "none");
      }
    }

    // Search highlight glow
    if (searchQuery) {
      svg.selectAll<SVGGElement, MapNode>(".graph-node-group").each(function (d) {
        const matches =
          d.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          d.concepts.some((c) => c.toLowerCase().includes(searchQuery.toLowerCase()));
        d3.select(this).select(".graph-node-glow")
          .attr("stroke-width", matches ? 2 : 0)
          .attr("opacity", matches ? 0.4 : 0);
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
