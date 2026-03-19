"use client";

import { useEffect, useRef, useCallback } from "react";
import * as d3 from "d3";
import type { GraphData } from "../page";

interface Props {
  data: GraphData;
  hiddenResearchers: Set<string>;
  searchQuery: string;
  onSelectConcept: (id: string) => void;
  selectedConceptId: string | null;
}

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  level: "broad" | "specific";
  submissionCount: number;
  researcherIds: string[];
  researcherColors: string[];
  isShared: boolean;
}

interface SimEdge extends d3.SimulationLinkDatum<SimNode> {
  relation: string;
  weight: number;
}

export default function KnowledgeGraph({
  data,
  hiddenResearchers,
  searchQuery,
  onSelectConcept,
  selectedConceptId,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimEdge> | null>(null);
  const currentZoomK = useRef(1);

  const isNodeActive = useCallback(
    (node: SimNode) => {
      if (
        node.researcherIds.length > 0 &&
        node.researcherIds.every((rid) => hiddenResearchers.has(rid))
      )
        return false;
      if (
        searchQuery &&
        !node.label.toLowerCase().includes(searchQuery.toLowerCase())
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

    // Prepare data for D3 simulation
    const nodes: SimNode[] = data.nodes.map((n) => ({
      ...n,
      level: n.level || "specific",
    }));
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    const edges: SimEdge[] = data.edges
      .filter((e) => nodeMap.has(e.source) && nodeMap.has(e.target))
      .map((e) => ({
        source: e.source,
        target: e.target,
        relation: e.relation,
        weight: e.weight,
      }));

    // Size scale: hierarchy-aware
    const maxSubs = Math.max(...nodes.map((n) => n.submissionCount), 1);
    const radiusScale = d3
      .scaleSqrt()
      .domain([1, maxSubs])
      .range([8, 28]);

    const getRadius = (d: SimNode) => {
      const base = radiusScale(d.submissionCount);
      // Broad concepts get a minimum size boost
      return d.level === "broad" ? Math.max(base, 22) + 6 : base;
    };

    // Main group for zoom
    const g = svg.append("g");

    // Zoom behavior with semantic zoom
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 5])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
        const k = event.transform.k;
        currentZoomK.current = k;
        applySemanticZoom(k);
      });
    svg.call(zoom);

    // Force simulation — hierarchy-aware
    const simulation = d3
      .forceSimulation<SimNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimEdge>(edges)
          .id((d) => d.id)
          .distance((d) => {
            const s = d.source as SimNode;
            const t = d.target as SimNode;
            // "part of" edges are shorter to cluster specific around broad
            if (d.relation === "part of") return 60;
            // Edges between two broad concepts are longer
            if (s.level === "broad" && t.level === "broad") return 200;
            return 120 / Math.sqrt(d.weight);
          })
          .strength((d) => {
            if (d.relation === "part of") return 0.6;
            return Math.min(0.5, d.weight * 0.1);
          })
      )
      .force(
        "charge",
        d3.forceManyBody<SimNode>().strength((d) =>
          d.level === "broad" ? -500 : -200
        )
      )
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force(
        "collision",
        d3.forceCollide<SimNode>().radius((d) => getRadius(d) + 6)
      );

    // Let simulation settle then stop — prevents bouncing on re-render
    simulation.alphaDecay(0.05);
    simulationRef.current = simulation;

    // Draw edges
    const link = g
      .append("g")
      .attr("class", "edges")
      .selectAll("line")
      .data(edges)
      .join("line")
      .attr("class", "graph-edge")
      .attr("stroke", "rgba(38, 38, 36, 0.15)")
      .attr("stroke-width", (d) => Math.min(4, d.weight * 1.5));

    // Draw edge labels
    const edgeLabel = g
      .append("g")
      .attr("class", "edge-labels")
      .selectAll("text")
      .data(edges)
      .join("text")
      .attr("class", "graph-edge-label")
      .attr("text-anchor", "middle")
      .attr("fill", "rgba(38, 38, 36, 0.4)")
      .attr("font-size", "9px")
      .attr("opacity", 0)
      .text((d) => d.relation);

    // Draw nodes
    const node = g
      .append("g")
      .attr("class", "nodes")
      .selectAll<SVGGElement, SimNode>("g")
      .data(nodes)
      .join("g")
      .attr("class", "graph-node-group")
      .attr("cursor", "pointer");

    // Node circles
    node.each(function (d) {
      const el = d3.select(this);
      const r = getRadius(d);

      if (d.researcherColors.length <= 1) {
        el.append("circle")
          .attr("r", r)
          .attr("fill", d.researcherColors[0] || "#999999")
          .attr("class", "graph-node")
          .style("transition", "opacity 0.2s");
      } else {
        const colors = d.researcherColors;
        const anglePerSlice = (2 * Math.PI) / colors.length;
        const arc = d3.arc<unknown>().innerRadius(0).outerRadius(r);

        colors.forEach((color, i) => {
          el.append("path")
            .attr(
              "d",
              arc({
                startAngle: i * anglePerSlice,
                endAngle: (i + 1) * anglePerSlice,
              } as d3.DefaultArcObject)
            )
            .attr("fill", color)
            .attr("class", "graph-node")
            .style("transition", "opacity 0.2s");
        });
      }

      // Shared concept ring
      if (d.isShared) {
        el.append("circle")
          .attr("r", r + 3)
          .attr("fill", "none")
          .attr("stroke", "#262624")
          .attr("stroke-width", 2)
          .attr("stroke-dasharray", "4,2")
          .attr("class", "graph-shared-ring");
      }

      // Broad concept double ring indicator
      if (d.level === "broad") {
        el.append("circle")
          .attr("r", r + (d.isShared ? 7 : 4))
          .attr("fill", "none")
          .attr("stroke", "rgba(38, 38, 36, 0.3)")
          .attr("stroke-width", 1.5)
          .attr("class", "graph-broad-ring");
      }
    });

    // Node labels
    node
      .append("text")
      .attr("class", "graph-node-label")
      .attr("text-anchor", "middle")
      .attr("dy", (d) => getRadius(d) + 14)
      .attr("fill", "#262624")
      .attr("font-size", (d) => (d.level === "broad" ? "12px" : "10px"))
      .attr("font-weight", (d) => (d.level === "broad" ? "700" : "500"))
      .style("transition", "opacity 0.2s")
      .text((d) => d.label);

    // Semantic zoom function
    function applySemanticZoom(k: number) {
      node.each(function (d) {
        const el = d3.select(this);
        const active = isNodeActive(d);

        if (!active) {
          el.attr("opacity", 0.08);
          return;
        }

        if (k < 0.6) {
          // Very zoomed out: only broad concepts
          el.attr("opacity", d.level === "broad" ? 1 : 0.06);
          el.select(".graph-node-label")
            .attr("opacity", d.level === "broad" ? 1 : 0);
        } else if (k < 1.2) {
          // Medium zoom: all nodes, labels for broad + popular specific
          el.attr("opacity", 1);
          el.select(".graph-node-label").attr(
            "opacity",
            d.level === "broad" || d.submissionCount > 1 ? 1 : 0.3
          );
        } else {
          // Zoomed in: everything visible
          el.attr("opacity", 1);
          el.select(".graph-node-label").attr("opacity", 1);
        }
      });

      // Edge labels only when zoomed in
      edgeLabel.attr("opacity", k > 2 ? 0.6 : 0);

      // Edges: filter by zoom level
      link.each(function (d) {
        const s = d.source as SimNode;
        const t = d.target as SimNode;
        const sActive = isNodeActive(s);
        const tActive = isNodeActive(t);

        if (!sActive || !tActive) {
          d3.select(this).attr("opacity", 0.02);
          return;
        }

        if (k < 0.6) {
          // Only show edges involving broad concepts
          const hasBroad = s.level === "broad" || t.level === "broad";
          d3.select(this).attr("opacity", hasBroad ? 0.3 : 0.02);
        } else {
          d3.select(this).attr("opacity", 0.4);
        }
      });
    }

    // Interactions
    node
      .on("mouseenter", (event, d) => {
        if (!isNodeActive(d)) return;
        const researchers = d.researcherIds
          .map((rid) => data.researchers.find((r) => r.id === rid)?.name || "")
          .filter(Boolean);

        const levelBadge = d.level === "broad"
          ? `<span style="color:#0072B2;font-size:10px;font-weight:600">RESEARCH FIELD</span><br/>`
          : "";

        tooltip
          .style("display", "block")
          .style("left", `${event.pageX + 12}px`)
          .style("top", `${event.pageY - 12}px`)
          .html(
            `<strong>${d.label}</strong><br/>` +
              levelBadge +
              `<span style="color:rgba(255,255,255,0.7)">${d.submissionCount} submission${d.submissionCount !== 1 ? "s" : ""}</span><br/>` +
              (researchers.length > 0
                ? `<span style="color:rgba(255,255,255,0.5);font-size:11px">${researchers.join(", ")}</span>`
                : "") +
              (d.isShared
                ? `<br/><span style="color:#E69F00;font-size:10px;font-weight:600">SHARED INTEREST</span>`
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
        if (isNodeActive(d)) onSelectConcept(d.id);
      });

    // Drag behavior
    const drag = d3
      .drag<SVGGElement, SimNode>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
    node.call(drag);

    // Tick: update positions
    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as SimNode).x!)
        .attr("y1", (d) => (d.source as SimNode).y!)
        .attr("x2", (d) => (d.target as SimNode).x!)
        .attr("y2", (d) => (d.target as SimNode).y!);

      edgeLabel
        .attr("x", (d) => ((d.source as SimNode).x! + (d.target as SimNode).x!) / 2)
        .attr("y", (d) => ((d.source as SimNode).y! + (d.target as SimNode).y!) / 2);

      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });

    // Initial filter + zoom state
    applySemanticZoom(1);

    return () => {
      simulation.stop();
      svg.selectAll("*").remove();
    };
  }, [data, hiddenResearchers, searchQuery, isNodeActive, onSelectConcept]);

  // Separate effect for selection highlight — doesn't rebuild the graph
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll<SVGElement, SimNode>(".graph-node")
      .attr("stroke", (d) => d.id === selectedConceptId ? "#262624" : "none")
      .attr("stroke-width", (d) => d.id === selectedConceptId ? 3 : 0);
  }, [selectedConceptId]);

  return (
    <div className="map-canvas">
      <svg ref={svgRef} className="map-svg" />
      <div ref={tooltipRef} className="map-tooltip" />
    </div>
  );
}
