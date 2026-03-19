"use client";

import { useEffect, useRef, useCallback } from "react";
import * as d3 from "d3";
import type { MapData, MapNode, Cluster } from "../page";

interface Props {
  data: MapData;
  hiddenResearchers: Set<string>;
  searchQuery: string;
  onSelectNode: (id: string) => void;
  selectedNodeId: string | null;
  onSelectCluster: (id: number) => void;
  selectedClusterId: number | null;
}

export default function KnowledgeGraph({
  data,
  hiddenResearchers,
  searchQuery,
  onSelectNode,
  selectedNodeId,
  onSelectCluster,
  selectedClusterId,
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

    // Scale UMAP coords [0,1000] to fit the viewport
    const xScale = d3.scaleLinear().domain([0, 1000]).range([80, width - 80]);
    const yScale = d3.scaleLinear().domain([0, 1000]).range([80, height - 80]);

    const g = svg.append("g");

    // Zoom/pan
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 6])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
        const k = event.transform.k;
        applySemanticZoom(k);
      });
    svg.call(zoom);

    // --- Layer 1: Cluster hulls ---
    const hullGroup = g.append("g").attr("class", "hulls");

    for (const cluster of clusters) {
      if (cluster.points.length < 3) continue;

      const scaledPoints: [number, number][] = cluster.points.map(
        ([x, y]) => [xScale(x), yScale(y)]
      );

      const hull = d3.polygonHull(scaledPoints);
      if (!hull) continue;

      // Expand hull slightly for padding
      const cx = cluster.centroidX;
      const cy = cluster.centroidY;
      const expandedHull = hull.map(([x, y]) => {
        const dx = x - xScale(cx);
        const dy = y - yScale(cy);
        const dist = Math.sqrt(dx * dx + dy * dy);
        const expand = 25;
        return [
          x + (dx / (dist || 1)) * expand,
          y + (dy / (dist || 1)) * expand,
        ] as [number, number];
      });

      hullGroup
        .append("path")
        .attr("d", `M${expandedHull.map((p) => p.join(",")).join("L")}Z`)
        .attr("fill", cluster.id === selectedClusterId ? "rgba(38, 38, 36, 0.1)" : "rgba(38, 38, 36, 0.04)")
        .attr("stroke", cluster.id === selectedClusterId ? "rgba(38, 38, 36, 0.4)" : "rgba(38, 38, 36, 0.15)")
        .attr("stroke-width", cluster.id === selectedClusterId ? 2 : 1)
        .attr("stroke-dasharray", "6,3")
        .attr("class", "cluster-hull")
        .attr("cursor", "pointer")
        .on("click", (event) => {
          event.stopPropagation();
          onSelectCluster(cluster.id);
        });

      // Cluster label
      hullGroup
        .append("text")
        .attr("x", xScale(cluster.centroidX))
        .attr("y", yScale(cluster.centroidY) - Math.max(...scaledPoints.map(p => Math.abs(p[1] - yScale(cy)))) - 15)
        .attr("text-anchor", "middle")
        .attr("fill", cluster.id === selectedClusterId ? "rgba(38, 38, 36, 0.8)" : "rgba(38, 38, 36, 0.4)")
        .attr("font-size", "11px")
        .attr("font-weight", "600")
        .attr("font-style", "italic")
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
    const NODE_RADIUS = 8;

    const node = nodeGroup
      .selectAll<SVGGElement, MapNode>("g")
      .data(nodes)
      .join("g")
      .attr("class", "graph-node-group")
      .attr("transform", (d) => `translate(${xScale(d.x)},${yScale(d.y)})`)
      .attr("cursor", "pointer");

    // Node circles
    node
      .append("circle")
      .attr("r", NODE_RADIUS)
      .attr("fill", (d) => d.submitterColor)
      .attr("class", "graph-node")
      .attr("stroke", "white")
      .attr("stroke-width", 1.5)
      .style("transition", "opacity 0.2s");

    // Node labels (title, truncated)
    node
      .append("text")
      .attr("class", "graph-node-label")
      .attr("text-anchor", "middle")
      .attr("dy", NODE_RADIUS + 13)
      .attr("fill", "#262624")
      .attr("font-size", "9px")
      .attr("font-weight", "500")
      .attr("opacity", 0)
      .text((d) => {
        const t = d.title || "";
        return t.length > 30 ? t.slice(0, 28) + "…" : t;
      });

    // Semantic zoom
    function applySemanticZoom(k: number) {
      node.each(function (d) {
        const el = d3.select(this);
        const active = isNodeActive(d);

        if (!active) {
          el.attr("opacity", 0.08);
          return;
        }

        el.attr("opacity", 1);

        // Show labels only when zoomed in
        el.select(".graph-node-label")
          .attr("opacity", k > 1.5 ? 1 : 0);
      });

      // Cluster labels visible when zoomed out, hidden when zoomed in
      hullGroup.selectAll(".cluster-label")
        .attr("opacity", k < 2 ? 1 : 0.3);
    }

    // Tooltip
    node
      .on("mouseenter", (event, d) => {
        if (!isNodeActive(d)) return;

        const contentIcon =
          d.contentType === "paper" ? "📄" :
          d.contentType === "link" ? "🔗" :
          d.contentType === "idea" ? "💡" : "📝";

        tooltip
          .style("display", "block")
          .style("left", `${event.pageX + 12}px`)
          .style("top", `${event.pageY - 12}px`)
          .html(
            `<strong>${contentIcon} ${d.title}</strong><br/>` +
              `<span style="color:rgba(255,255,255,0.6);font-size:11px">by ${d.submitterName}</span><br/>` +
              (d.concepts.length > 0
                ? `<span style="color:rgba(255,255,255,0.5);font-size:10px">${d.concepts.join(", ")}</span>`
                : "")
          );
      })
      .on("mousemove", (event) => {
        tooltip
          .style("left", `${event.pageX + 12}px`)
          .style("top", `${event.pageY - 12}px`);
      })
      .on("mouseleave", () => {
        tooltip.style("display", "none");
      })
      .on("click", (_event, d) => {
        if (isNodeActive(d)) onSelectNode(d.id);
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
    svg.selectAll<SVGCircleElement, MapNode>(".graph-node")
      .attr("stroke", (d) => d.id === selectedNodeId ? "#262624" : "white")
      .attr("stroke-width", (d) => d.id === selectedNodeId ? 3 : 1.5);
  }, [selectedNodeId]);

  return (
    <div className="map-canvas">
      <svg ref={svgRef} className="map-svg" />
      <div ref={tooltipRef} className="map-tooltip" />
    </div>
  );
}
