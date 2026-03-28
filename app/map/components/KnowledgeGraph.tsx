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

// Cluster fill colors — soft, distinguishable pastels
const CLUSTER_FILLS = [
  "rgba(230, 159, 0, 0.07)",   // warm amber
  "rgba(86, 180, 233, 0.07)",  // sky blue
  "rgba(0, 158, 115, 0.07)",   // teal
  "rgba(204, 121, 167, 0.07)", // rose
  "rgba(0, 114, 178, 0.07)",   // deep blue
  "rgba(213, 94, 0, 0.07)",    // vermillion
  "rgba(240, 228, 66, 0.07)",  // yellow
  "rgba(102, 166, 30, 0.07)",  // olive
];

const CLUSTER_STROKES = [
  "rgba(230, 159, 0, 0.25)",
  "rgba(86, 180, 233, 0.25)",
  "rgba(0, 158, 115, 0.25)",
  "rgba(204, 121, 167, 0.25)",
  "rgba(0, 114, 178, 0.25)",
  "rgba(213, 94, 0, 0.25)",
  "rgba(240, 228, 66, 0.25)",
  "rgba(102, 166, 30, 0.25)",
];

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

    // Scale UMAP coords [0,1000] to fit the viewport with generous padding
    const xScale = d3.scaleLinear().domain([0, 1000]).range([100, width - 100]);
    const yScale = d3.scaleLinear().domain([0, 1000]).range([100, height - 100]);

    const g = svg.append("g");

    // Zoom/pan
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 8])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
        const k = event.transform.k;
        applySemanticZoom(k);
      });
    svg.call(zoom);

    // Click on background to deselect
    svg.on("click", () => {
      onSelectNode("");
      onSelectCluster(-1);
    });

    // --- Layer 1: Cluster hulls (smooth curved shapes) ---
    const hullGroup = g.append("g").attr("class", "hulls");

    for (const cluster of clusters) {
      if (cluster.points.length < 3) continue;

      const scaledPoints: [number, number][] = cluster.points.map(
        ([x, y]) => [xScale(x), yScale(y)]
      );

      const hull = d3.polygonHull(scaledPoints);
      if (!hull) continue;

      // Expand hull for padding
      const cx = xScale(cluster.centroidX);
      const cy = yScale(cluster.centroidY);
      const expandedHull = hull.map(([x, y]) => {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const expand = 35;
        return [
          x + (dx / (dist || 1)) * expand,
          y + (dy / (dist || 1)) * expand,
        ] as [number, number];
      });

      // Smooth curved hull using cardinal curve
      const line = d3.line().curve(d3.curveCatmullRomClosed.alpha(0.5));
      const isSelected = cluster.id === selectedClusterId;
      const colorIdx = cluster.id % CLUSTER_FILLS.length;

      hullGroup
        .append("path")
        .attr("d", line(expandedHull))
        .attr("fill", isSelected
          ? CLUSTER_FILLS[colorIdx].replace("0.07", "0.14")
          : CLUSTER_FILLS[colorIdx])
        .attr("stroke", isSelected
          ? CLUSTER_STROKES[colorIdx].replace("0.25", "0.5")
          : CLUSTER_STROKES[colorIdx])
        .attr("stroke-width", isSelected ? 1.5 : 1)
        .attr("class", "cluster-hull")
        .attr("cursor", "pointer")
        .on("click", (event) => {
          event.stopPropagation();
          onSelectCluster(cluster.id);
        });

      // Cluster label — positioned at top of hull
      const topY = Math.min(...scaledPoints.map(p => p[1]));
      hullGroup
        .append("text")
        .attr("x", cx)
        .attr("y", topY - 18)
        .attr("text-anchor", "middle")
        .attr("fill", isSelected ? "rgba(38, 38, 36, 0.7)" : "rgba(38, 38, 36, 0.35)")
        .attr("font-size", "10px")
        .attr("font-weight", "600")
        .attr("letter-spacing", "0.04em")
        .attr("text-transform", "uppercase")
        .attr("class", "cluster-label")
        .attr("cursor", "pointer")
        .on("click", (event) => {
          event.stopPropagation();
          onSelectCluster(cluster.id);
        })
        .text(cluster.label);
    }

    // --- Layer 2: Nodes (submissions) ---
    const nodeGroup = g.append("g").attr("class", "nodes");
    const NODE_RADIUS = 7;

    const node = nodeGroup
      .selectAll<SVGGElement, MapNode>("g")
      .data(nodes)
      .join("g")
      .attr("class", "graph-node-group")
      .attr("transform", (d) => `translate(${xScale(d.x)},${yScale(d.y)})`)
      .attr("cursor", "pointer");

    // Outer glow for hover effect (hidden by default)
    node
      .append("circle")
      .attr("r", NODE_RADIUS + 6)
      .attr("fill", "none")
      .attr("stroke", (d) => d.submitterColor)
      .attr("stroke-width", 0)
      .attr("opacity", 0)
      .attr("class", "graph-node-glow");

    // Main node circle
    node
      .append("circle")
      .attr("r", NODE_RADIUS)
      .attr("fill", (d) => d.submitterColor)
      .attr("class", "graph-node")
      .attr("stroke", "white")
      .attr("stroke-width", 1.5)
      .attr("filter", "drop-shadow(0 1px 2px rgba(0,0,0,0.1))");

    // Content type indicator (tiny icon ring for papers)
    node.each(function (d) {
      if (d.contentType === "paper") {
        d3.select(this)
          .append("circle")
          .attr("r", NODE_RADIUS + 3)
          .attr("fill", "none")
          .attr("stroke", d.submitterColor)
          .attr("stroke-width", 0.5)
          .attr("opacity", 0.4)
          .attr("class", "graph-node-type-ring");
      }
    });

    // Node labels (title, truncated) — revealed progressively with zoom
    node
      .append("text")
      .attr("class", "graph-node-label")
      .attr("text-anchor", "middle")
      .attr("dy", NODE_RADIUS + 14)
      .attr("fill", "#262624")
      .attr("font-size", "9px")
      .attr("font-weight", "500")
      .attr("opacity", 0)
      .attr("pointer-events", "none")
      .text((d) => {
        const t = d.title || "";
        return t.length > 35 ? t.slice(0, 33) + "…" : t;
      });

    // Submitter name label (shown at higher zoom)
    node
      .append("text")
      .attr("class", "graph-node-submitter")
      .attr("text-anchor", "middle")
      .attr("dy", NODE_RADIUS + 25)
      .attr("fill", "rgba(38, 38, 36, 0.4)")
      .attr("font-size", "8px")
      .attr("font-weight", "400")
      .attr("opacity", 0)
      .attr("pointer-events", "none")
      .text((d) => d.submitterName);

    // Semantic zoom
    function applySemanticZoom(k: number) {
      node.each(function (d) {
        const el = d3.select(this);
        const active = isNodeActive(d);

        if (!active) {
          el.attr("opacity", 0.06);
          return;
        }

        el.attr("opacity", 1);

        // Progressive label reveal
        if (k > 2.5) {
          // Full zoom: title + submitter
          el.select(".graph-node-label").attr("opacity", 1);
          el.select(".graph-node-submitter").attr("opacity", 1);
        } else if (k > 1.3) {
          // Medium zoom: title only
          el.select(".graph-node-label").attr("opacity", 0.8);
          el.select(".graph-node-submitter").attr("opacity", 0);
        } else {
          // Zoomed out: no labels
          el.select(".graph-node-label").attr("opacity", 0);
          el.select(".graph-node-submitter").attr("opacity", 0);
        }
      });

      // Cluster labels: always visible but adjust opacity
      hullGroup.selectAll<SVGTextElement, unknown>(".cluster-label")
        .attr("opacity", (function() {
          return k > 3 ? 0.2 : k < 0.8 ? 0.5 : 0.35;
        })());

      // Scale type rings with zoom
      node.selectAll(".graph-node-type-ring")
        .attr("opacity", k > 1.5 ? 0.4 : 0);
    }

    // Hover effects
    node
      .on("mouseenter", (event, d) => {
        if (!isNodeActive(d)) return;

        // Glow effect
        d3.select(event.currentTarget)
          .select(".graph-node-glow")
          .attr("stroke-width", 2)
          .attr("opacity", 0.3);

        // Scale up node slightly
        d3.select(event.currentTarget)
          .select(".graph-node")
          .transition()
          .duration(100)
          .attr("r", NODE_RADIUS + 2);

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
        tooltip
          .style("left", `${event.pageX + 14}px`)
          .style("top", `${event.pageY - 14}px`);
      })
      .on("mouseleave", (event) => {
        // Reset glow
        d3.select(event.currentTarget)
          .select(".graph-node-glow")
          .attr("stroke-width", 0)
          .attr("opacity", 0);

        // Reset node size
        d3.select(event.currentTarget)
          .select(".graph-node")
          .transition()
          .duration(100)
          .attr("r", NODE_RADIUS);

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

    // Initial state
    applySemanticZoom(1);

    return () => {
      svg.selectAll("*").remove();
    };
  }, [data, hiddenResearchers, searchQuery, isNodeActive, onSelectNode, onSelectCluster, selectedClusterId]);

  // Selection highlight (separate effect to avoid full re-render)
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);

    const NODE_RADIUS = 7;

    // Update node stroke highlights
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

    // Draw connecting lines between multi-selected nodes
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
          .attr("x1", xScale(a.x))
          .attr("y1", yScale(a.y))
          .attr("x2", xScale(b.x))
          .attr("y2", yScale(b.y))
          .attr("stroke", "#D55E00")
          .attr("stroke-width", 1.5)
          .attr("stroke-dasharray", "6,4")
          .attr("opacity", 0.5)
          .attr("pointer-events", "none");
      }
    }

    // Highlight search matches with a pulse ring
    if (searchQuery) {
      svg.selectAll<SVGGElement, MapNode>(".graph-node-group").each(function (d) {
        const el = d3.select(this);
        const matches =
          d.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          d.concepts.some((c) => c.toLowerCase().includes(searchQuery.toLowerCase()));
        el.select(".graph-node-glow")
          .attr("stroke-width", matches ? 2 : 0)
          .attr("opacity", matches ? 0.4 : 0);
      });
    } else {
      svg.selectAll(".graph-node-glow")
        .attr("stroke-width", 0)
        .attr("opacity", 0);
    }
  }, [selectedNodeId, multiSelectIds, data.nodes, searchQuery]);

  return (
    <div className="map-canvas">
      <svg ref={svgRef} className="map-svg" />
      <div ref={tooltipRef} className="map-tooltip" />
    </div>
  );
}
