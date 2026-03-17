"use client";

import { useEffect, useRef, useCallback } from "react";
import * as d3 from "d3";
import type { MapData } from "../page";

interface Props {
  data: MapData;
  hiddenResearchers: Set<string>;
  selectedTags: Set<string>;
  searchQuery: string;
  onSelectFragment: (id: string) => void;
  selectedFragmentId: string | null;
}

export default function KnowledgeMap({
  data,
  hiddenResearchers,
  selectedTags,
  searchQuery,
  onSelectFragment,
  selectedFragmentId,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown>>(null);

  // Compute convex hull points for a cluster
  const computeHull = useCallback(
    (clusterId: number) => {
      const points = data.fragments
        .filter((f) => f.clusterId === clusterId)
        .map((f) => [f.x, f.y] as [number, number]);
      if (points.length < 3) return null;
      return d3.polygonHull(points);
    },
    [data.fragments]
  );

  // Is a fragment "active" given current filters?
  const isActive = useCallback(
    (f: (typeof data.fragments)[0]) => {
      if (hiddenResearchers.has(f.submitterId)) return false;
      if (selectedTags.size > 0 && !f.tags.some((t) => selectedTags.has(t)))
        return false;
      if (
        searchQuery &&
        !f.content.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !f.documentTitle.toLowerCase().includes(searchQuery.toLowerCase())
      )
        return false;
      return true;
    },
    [hiddenResearchers, selectedTags, searchQuery]
  );

  useEffect(() => {
    const svg = d3.select(svgRef.current!);
    const tooltip = d3.select(tooltipRef.current!);
    const width = svgRef.current!.clientWidth;
    const height = svgRef.current!.clientHeight;

    svg.selectAll("*").remove();

    // Padding for the projection
    const pad = 60;
    const xScale = d3
      .scaleLinear()
      .domain([0, 1000])
      .range([pad, width - pad]);
    const yScale = d3
      .scaleLinear()
      .domain([0, 1000])
      .range([pad, height - pad]);

    // Main group for zoom
    const g = svg.append("g");

    // Zoom behavior
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 8])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);

        const k = event.transform.k;

        // Semantic zoom: adjust node sizes and label visibility
        g.selectAll<SVGCircleElement, (typeof data.fragments)[0]>(".fragment-node").attr(
          "r",
          (d) => (d.id === selectedFragmentId ? 7 : 5) / Math.sqrt(k)
        );

        g.selectAll(".cluster-label").attr(
          "opacity",
          k > 0.5 && k < 4 ? 0.7 : 0
        );
      });

    svg.call(zoom);
    zoomRef.current = zoom;

    // Layer 1: Cluster hulls
    const clusterIds = [...new Set(data.fragments.map((f) => f.clusterId).filter((c) => c !== null && c !== -1))];

    for (const cid of clusterIds) {
      const hull = computeHull(cid as number);
      if (!hull) continue;

      const scaledHull = hull.map(
        (p) => [xScale(p[0]), yScale(p[1])] as [number, number]
      );

      g.append("path")
        .attr("class", "cluster-hull")
        .attr("d", `M${scaledHull.map((p) => p.join(",")).join("L")}Z`)
        .attr("fill", "rgba(38, 38, 36, 0.06)")
        .attr("stroke", "rgba(38, 38, 36, 0.12)")
        .attr("stroke-width", 1);
    }

    // Layer 2: Cluster labels
    for (const cluster of data.clusters) {
      g.append("text")
        .attr("class", "cluster-label")
        .attr("x", xScale(cluster.centroidX))
        .attr("y", yScale(cluster.centroidY) - 16)
        .attr("text-anchor", "middle")
        .attr("fill", "#262624")
        .attr("opacity", 0.7)
        .attr("font-size", "11px")
        .attr("font-weight", "600")
        .attr("letter-spacing", "0.08em")
        .text(cluster.label.toUpperCase());
    }

    // Layer 3: Fragment nodes
    g.selectAll(".fragment-node")
      .data(data.fragments)
      .join("circle")
      .attr("class", "fragment-node")
      .attr("cx", (d) => xScale(d.x))
      .attr("cy", (d) => yScale(d.y))
      .attr("r", 5)
      .attr("fill", (d) => d.submitterColor)
      .attr("opacity", (d) => (isActive(d) ? 0.85 : 0.1))
      .attr("stroke", (d) =>
        d.id === selectedFragmentId ? "#262624" : "none"
      )
      .attr("stroke-width", (d) => (d.id === selectedFragmentId ? 2 : 0))
      .attr("cursor", "pointer")
      .on("mouseenter", (event, d) => {
        if (!isActive(d)) return;
        tooltip
          .style("display", "block")
          .style("left", `${event.pageX + 12}px`)
          .style("top", `${event.pageY - 12}px`)
          .html(
            `<strong>${d.documentTitle || "Untitled"}</strong><br/>` +
              `<span style="color:rgba(255,255,255,0.7)">${d.submitterName}</span><br/>` +
              `<span style="color:rgba(255,255,255,0.6);font-size:11px">${d.content.slice(0, 120)}${d.content.length > 120 ? "..." : ""}</span>` +
              (d.tags.length
                ? `<br/><span style="color:rgba(255,255,255,0.5);font-size:10px">${d.tags.join(" · ")}</span>`
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
        if (isActive(d)) onSelectFragment(d.id);
      });

    return () => {
      svg.selectAll("*").remove();
    };
  }, [
    data,
    hiddenResearchers,
    selectedTags,
    searchQuery,
    selectedFragmentId,
    computeHull,
    isActive,
    onSelectFragment,
  ]);

  return (
    <div className="map-canvas">
      <svg ref={svgRef} className="map-svg" />
      <div ref={tooltipRef} className="map-tooltip" />
    </div>
  );
}
