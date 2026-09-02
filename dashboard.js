"use strict";

const X_TICKS = [0, 0.03, 0.1, 0.3, 1, 3, 10, 30];
const FULL_Y_TICKS = [0, 20, 40, 60, 80, 100];
const X_FLOOR = 0.03;
const X_CEILING = 30;
const FILTERED_LABEL_LIMIT = 10;
const COST_MODES = {
  token: {
    key: "blended_price",
    title: "traffic economics",
    shortLabel: "200:7:1 token blend",
    axisLabel: "USD per 1M usage tokens →",
    unitLabel: "per million usage tokens",
  },
  task: {
    key: "coding_agent_source_cost",
    title: "AA run cost",
    shortLabel: "AA mean run cost / task",
    axisLabel: "Artificial Analysis mean USD per task →",
    unitLabel: "per Artificial Analysis task",
  },
};
const METRICS = {
  coding_agent: { scoreKey: "coding_agent_index", label: "Artificial Analysis Coding Agent Index", shortLabel: "Coding Agent Index", chartShort: "Agent Index" },
  coding: { scoreKey: "coding_index", label: "Artificial Analysis Coding Index", shortLabel: "Coding Index", chartShort: "Coding Index" },
  model_terminal_bench: { scoreKey: "model_terminal_bench_score", label: "Terminal-Bench v2.1 · AA model evaluation", shortLabel: "Model Terminal-Bench", chartShort: "Model TB" },
  scicode: { scoreKey: "scicode_score", label: "SciCode · AA model evaluation", shortLabel: "SciCode", chartShort: "SciCode" },
  coding_agent_deep_swe: { scoreKey: "coding_agent_deep_swe_score", label: "DeepSWE · Coding Agent Index run", shortLabel: "Agent DeepSWE", chartShort: "Agent DeepSWE" },
  coding_agent_terminal_bench: { scoreKey: "coding_agent_terminal_bench_score", label: "Terminal-Bench v2.1 · Coding Agent Index run", shortLabel: "Agent Terminal-Bench", chartShort: "Agent TB" },
  coding_agent_swe_atlas_qna: { scoreKey: "coding_agent_swe_atlas_qna_score", label: "SWE-Atlas-QnA · Coding Agent Index run", shortLabel: "Agent SWE-Atlas-QnA", chartShort: "Agent SWE" },
};

const state = {
  data: null,
  metric: "coding_agent",
  query: "",
  provider: "all",
  frontierOnly: false,
  costMode: "token",
  sort: "rank",
  showFullRange: false,
  activeId: null,
  hoverId: null,
  frontierCache: null,
};
let chartContext = null;

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
})[char]);

function money(value) {
  if (value == null) return "—";
  if (value === 0) return "$0";
  if (value < 0.1) return `$${value.toFixed(3)}`;
  if (value < 10) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(0)}`;
}

function compact(value) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function percent(value) { return `${(value * 100).toFixed(2)}%`; }
function ratioText(mix) {
  const ratio = mix.ratio;
  return `${ratio.cached_input} : ${ratio.uncached_input} : ${ratio.output}`;
}
function providerLabel(value) { return value.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "); }
function metricSpec() { return METRICS[state.metric]; }
function costSpec() { return COST_MODES[state.costMode]; }
function modelScore(model) { return model[metricSpec().scoreKey]; }
function modelCost(model) { return model[costSpec().key]; }
function frontierIds() {
  const cacheKey = `${state.metric}:${state.costMode}`;
  if (state.frontierCache?.key === cacheKey) return state.frontierCache.ids;
  const scored = state.data.models
    .filter((model) => modelScore(model) != null && modelCost(model) != null)
    .slice()
    .sort((a, b) => modelCost(a) - modelCost(b) || modelScore(b) - modelScore(a));
  const ids = new Set();
  let bestScore = -Infinity;
  scored.forEach((model) => {
    if (modelScore(model) > bestScore) {
      ids.add(model.id);
      bestScore = modelScore(model);
    }
  });
  state.frontierCache = { key: cacheKey, ids };
  return ids;
}
function isFrontier(model) { return frontierIds().has(model.id); }
function scoreText(value) { return value == null ? "—" : value.toFixed(1); }
function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }

function chartModelLabel(model) {
  const separator = model.name.indexOf(": ");
  return separator === -1 ? model.name : model.name.slice(separator + 2);
}

function xPercent(price) {
  const value = Math.log10(price + X_FLOOR);
  const low = Math.log10(X_FLOOR);
  const high = Math.log10(X_CEILING + X_FLOOR);
  return ((value - low) / (high - low)) * 100;
}

function focusedCeiling() {
  const scores = state.data.models.map(modelScore).filter((score) => score != null);
  return Math.max(focusedFloor() + 20, Math.ceil(Math.max(...scores, 0) / 5) * 5);
}

function focusedFloor() {
  const reference = state.data.meta.reference_model[metricSpec().scoreKey];
  if (reference == null) return 40;
  return Math.max(0, Math.floor(reference / 5) * 5 - 15);
}

function yPercent(score, floor, ceiling) {
  return 100 - ((score - floor) / (ceiling - floor)) * 100;
}

function focusedTicks(ceiling) {
  const ticks = [];
  for (let tick = focusedFloor(); tick <= ceiling; tick += 5) ticks.push(tick);
  return ticks;
}

function filteredModels() {
  const needle = state.query.trim().toLowerCase();
  return state.data.models.filter((model) => {
    if (state.provider !== "all" && model.provider !== state.provider) return false;
    if (state.frontierOnly && !isFrontier(model)) return false;
    return !needle || `${model.name} ${model.id} ${model.provider} ${model.coding_agent_harness ?? ""}`.toLowerCase().includes(needle);
  }).sort((a, b) => {
    if (state.sort === "performance") return (modelScore(b) ?? -1) - (modelScore(a) ?? -1);
    if (state.sort === "price") return (modelCost(a) ?? Infinity) - (modelCost(b) ?? Infinity);
    if (state.sort === "tokens") return b.observed_tokens_30d - a.observed_tokens_30d;
    return (a.weekly_usage_rank ?? Infinity) - (b.weekly_usage_rank ?? Infinity);
  });
}

function hasActiveModelFilters() {
  return state.query.trim() !== "" || state.provider !== "all" || state.frontierOnly;
}

function agentSetup(model) {
  if (!model.coding_agent_harness) return "—";
  return model.coding_agent_effort
    ? `${model.coding_agent_harness} · ${model.coding_agent_effort}`
    : model.coding_agent_harness;
}

function priceNote(model) {
  return model.is_free_endpoint
    ? "This endpoint is free to the OpenRouter user. The plotted value is the underlying model’s traffic-weighted economic rate, not the endpoint charge."
    : "OpenRouter traffic-weighted effective prices recalibrated to the fixed 200:7:1 token mix.";
}

function renderSummary() {
  const { meta, models } = state.data;
  const mix = meta.token_mix;
  const spec = metricSpec();
  const cost = costSpec();
  const threshold = meta.reference_model[spec.scoreKey];
  const above = threshold == null
    ? null
    : models.filter((model) => modelScore(model) != null && modelScore(model) >= threshold).length;
  $("#data-date").textContent = `OpenRouter through ${meta.usage_end_date} · AA model data v${meta.artificial_analysis_model_version} · Coding Agent Index v${meta.artificial_analysis_version}`;
  $("#summary").innerHTML = `
    <div><span>${escapeHtml(spec.shortLabel)} scored</span><strong>${meta.performance_metrics[state.metric].scored_model_count}</strong></div>
    <div><span>At / above Opus 4.8 (max)</span><strong>${above == null ? "—" : above}</strong></div>
    <div><span>${escapeHtml(spec.shortLabel)} Pareto frontier</span><strong>${frontierIds().size}</strong></div>
    <div><span>Cost basis</span><strong>${escapeHtml(cost.shortLabel)}</strong></div>`;
  $("#legend").innerHTML = `
    <span><i class="legend-dot"></i> Model</span><span><i class="legend-dot frontier"></i> Frontier</span>
    <span><i class="legend-promo"></i> Promo</span>
    ${threshold == null ? "" : `<span><i class="legend-line"></i> Opus 4.8 max (${scoreText(threshold)})</span>`}`;
}

function tooltipHtml(model) {
  const rank = `#${model.weekly_usage_rank} usage rank`;
  const promo = model.promotion_discount == null ? "" : ` · ${Math.round(model.promotion_discount * 100)}% promo`;
  return `<strong>${escapeHtml(model.name)}</strong><span>${rank}${promo}</span><dl>
    <div><dt>Coding Agent Index</dt><dd>${scoreText(model.coding_agent_index)}</dd></div>
    <div><dt>Agent · DeepSWE</dt><dd>${scoreText(model.coding_agent_deep_swe_score)}</dd></div>
    <div><dt>Agent · Terminal-Bench</dt><dd>${scoreText(model.coding_agent_terminal_bench_score)}</dd></div>
    <div><dt>Agent · SWE-Atlas</dt><dd>${scoreText(model.coding_agent_swe_atlas_qna_score)}</dd></div>
    <div><dt>Agent setup</dt><dd>${escapeHtml(agentSetup(model))}</dd></div>
    <div><dt>Coding Index</dt><dd>${scoreText(model.coding_index)}</dd></div>
    <div><dt>Model · Terminal-Bench</dt><dd>${scoreText(model.model_terminal_bench_score)}</dd></div>
    <div><dt>Model · SciCode</dt><dd>${scoreText(model.scicode_score)}</dd></div>
    <div><dt>Model effort</dt><dd>${escapeHtml(model.model_evaluation_effort ?? "—")}</dd></div>
    <div><dt>AA run cost</dt><dd>${money(model.coding_agent_source_cost)}/task</dd></div>
    <div><dt>Economic blend</dt><dd>${money(model.blended_price)}/M</dd></div>
    ${model.is_free_endpoint ? `<div><dt>Catalog charge</dt><dd>${money(model.catalog_blended_price)}/M (free)</dd></div>` : ""}
    <div><dt>Uncached input</dt><dd>${money(model.effective_uncached_input_price)}/M</dd></div>
    <div><dt>Cached input</dt><dd>${money(model.effective_cached_input_price)}/M</dd></div>
    <div><dt>Output</dt><dd>${money(model.effective_output_price)}/M</dd></div>
  </dl>`;
}

function updateTooltip(plotted, floor, ceiling) {
  const plot = $("#plot");
  plot.querySelector(".chart-tooltip")?.remove();
  const focused = plotted.find((model) => model.id === (state.hoverId ?? state.activeId));
  if (!focused) return;
  const tooltip = document.createElement("div");
  tooltip.className = "chart-tooltip";
  tooltip.innerHTML = tooltipHtml(focused);
  plot.append(tooltip);

  const pointX = plot.clientWidth * xPercent(modelCost(focused)) / 100;
  const pointY = plot.clientHeight * (yPercent(modelScore(focused), floor, ceiling) + 3) / 100;
  const maximumLeft = Math.max(4, plot.clientWidth - tooltip.offsetWidth - 4);
  const maximumTop = Math.max(4, plot.clientHeight - tooltip.offsetHeight - 4);
  tooltip.style.left = `${clamp(pointX, 4, maximumLeft)}px`;
  tooltip.style.top = `${clamp(pointY, 4, maximumTop)}px`;
}

function overlapArea(first, second, padding = 6) {
  const width = Math.max(0, Math.min(first.x + first.width + padding, second.x + second.width) - Math.max(first.x, second.x - padding));
  const height = Math.max(0, Math.min(first.y + first.height + padding, second.y + second.height) - Math.max(first.y, second.y - padding));
  return width * height;
}

function placePointLabels(models, plotted, floor, ceiling) {
  const plot = $("#plot");
  const width = plot.clientWidth;
  const height = plot.clientHeight;
  if (!width || !height) return;

  plot.querySelectorAll("[data-model-leader-id], [data-model-label-id]").forEach((element) => {
    element.style.visibility = "hidden";
  });

  const occupied = [];
  const points = plotted.map((model) => ({
    id: model.id,
    x: width * xPercent(modelCost(model)) / 100,
    y: height * yPercent(modelScore(model), floor, ceiling) / 100,
  }));

  models.forEach((model) => {
    const label = plot.querySelector(`[data-model-label-id="${CSS.escape(model.id)}"]`);
    const leader = plot.querySelector(`[data-model-leader-id="${CSS.escape(model.id)}"]`);
    if (!label || !leader) return;

    const labelWidth = label.offsetWidth;
    const labelHeight = label.offsetHeight;
    const pointX = width * xPercent(modelCost(model)) / 100;
    const pointY = height * yPercent(modelScore(model), floor, ceiling) / 100;
    const gap = 15;
    const candidates = [
      { x: pointX + gap, y: pointY - labelHeight / 2 },
      { x: pointX - labelWidth - gap, y: pointY - labelHeight / 2 },
      { x: pointX - labelWidth / 2, y: pointY - labelHeight - gap },
      { x: pointX - labelWidth / 2, y: pointY + gap },
      { x: pointX + gap, y: pointY - labelHeight - 8 },
      { x: pointX - labelWidth - gap, y: pointY - labelHeight - 8 },
      { x: pointX + gap, y: pointY + 8 },
      { x: pointX - labelWidth - gap, y: pointY + 8 },
    ];
    [-30, 30, -60, 60, -90, 90, -120, 120].forEach((shift) => {
      candidates.push(
        { x: pointX + gap, y: pointY - labelHeight / 2 + shift },
        { x: pointX - labelWidth - gap, y: pointY - labelHeight / 2 + shift },
      );
    });

    const lastGridX = Math.max(4, width - labelWidth - 4);
    const lastGridY = Math.max(4, height - labelHeight - 4);
    const gridXs = [];
    for (let x = 4; x <= lastGridX; x += labelWidth + 8) gridXs.push(x);
    if (gridXs.at(-1) !== lastGridX) gridXs.push(lastGridX);
    for (let y = 4; y <= lastGridY; y += labelHeight + 6) {
      gridXs.forEach((x) => candidates.push({ x, y }));
    }
    if ((lastGridY - 4) % (labelHeight + 6) !== 0) {
      gridXs.forEach((x) => candidates.push({ x, y: lastGridY }));
    }

    const scored = candidates.map((candidate) => {
      const rectangle = {
        x: clamp(candidate.x, 4, Math.max(4, width - labelWidth - 4)),
        y: clamp(candidate.y, 4, Math.max(4, height - labelHeight - 4)),
        width: labelWidth,
        height: labelHeight,
      };
      const labelOverlap = occupied.reduce((sum, placed) => sum + overlapArea(rectangle, placed), 0);
      const coveredPoints = points.filter((point) => point.id !== model.id
        && point.x >= rectangle.x - 8 && point.x <= rectangle.x + rectangle.width + 8
        && point.y >= rectangle.y - 8 && point.y <= rectangle.y + rectangle.height + 8).length;
      const clampDistance = Math.abs(rectangle.x - candidate.x) + Math.abs(rectangle.y - candidate.y);
      const centerX = rectangle.x + rectangle.width / 2;
      const centerY = rectangle.y + rectangle.height / 2;
      const leaderDistance = Math.hypot(centerX - pointX, centerY - pointY);
      return {
        rectangle,
        labelOverlap,
        penalty: labelOverlap * 1000 + coveredPoints * 50000 + clampDistance * 30 + leaderDistance,
      };
    }).sort((a, b) => {
      if ((a.labelOverlap === 0) !== (b.labelOverlap === 0)) return a.labelOverlap === 0 ? -1 : 1;
      return a.penalty - b.penalty;
    });

    const rectangle = scored[0].rectangle;
    if (scored[0].labelOverlap > 0) return;
    occupied.push(rectangle);
    label.style.left = `${rectangle.x}px`;
    label.style.top = `${rectangle.y}px`;
    label.style.visibility = "visible";

    const anchorX = clamp(pointX, rectangle.x, rectangle.x + rectangle.width);
    const anchorY = clamp(pointY, rectangle.y, rectangle.y + rectangle.height);
    const deltaX = anchorX - pointX;
    const deltaY = anchorY - pointY;
    leader.style.left = `${pointX}px`;
    leader.style.top = `${pointY}px`;
    leader.style.width = `${Math.hypot(deltaX, deltaY)}px`;
    leader.style.transform = `rotate(${Math.atan2(deltaY, deltaX)}rad)`;
    leader.style.visibility = "visible";
  });
}

function labeledModels(plotted) {
  const automatic = hasActiveModelFilters()
    ? plotted.slice(0, FILTERED_LABEL_LIMIT)
    : plotted.filter((model) => isFrontier(model));
  const plottedById = new Map(plotted.map((model) => [model.id, model]));
  const ids = [...automatic.map((model) => model.id), state.activeId, state.hoverId].filter(Boolean);
  return [...new Set(ids)].map((id) => plottedById.get(id)).filter(Boolean);
}

function syncInteraction() {
  if (!chartContext) return;
  const { plotted, floor, ceiling } = chartContext;
  const focusedId = state.hoverId ?? state.activeId;

  $("#plot").querySelectorAll("[data-model-id]").forEach((point) => {
    point.classList.toggle("active", point.dataset.modelId === state.activeId);
    point.classList.toggle("hovered", point.dataset.modelId === focusedId);
  });
  $("#plot").querySelectorAll("[data-model-label-id]").forEach((label) => {
    label.classList.toggle("active", label.dataset.modelLabelId === state.activeId);
    label.classList.toggle("hovered", label.dataset.modelLabelId === focusedId);
  });
  $("#model-rows").querySelectorAll("[data-row-id]").forEach((row) => {
    const selected = row.dataset.rowId === state.activeId;
    row.classList.toggle("selected-row", selected);
    row.classList.toggle("hovered-row", row.dataset.rowId === focusedId);
    row.setAttribute("aria-selected", String(selected));
  });

  placePointLabels(labeledModels(plotted), plotted, floor, ceiling);
  updateTooltip(plotted, floor, ceiling);
}

function setHoverId(id) {
  if (state.hoverId === id) return;
  state.hoverId = id;
  syncInteraction();
}

function clearHoverId(id) {
  if (state.hoverId !== id) return;
  state.hoverId = null;
  syncInteraction();
}

function toggleActiveId(id) {
  state.activeId = state.activeId === id ? null : id;
  syncInteraction();
}

function renderChart(models) {
  const spec = metricSpec();
  const cost = costSpec();
  const floor = state.showFullRange ? 0 : focusedFloor();
  const ceiling = state.showFullRange ? 100 : focusedCeiling();
  const ticks = state.showFullRange ? FULL_Y_TICKS : focusedTicks(ceiling);
  const threshold = state.data.meta.reference_model[spec.scoreKey];
  const plotted = models.filter((model) => modelScore(model) != null && modelCost(model) != null && modelScore(model) >= floor);
  const frontier = state.data.models.filter((model) => isFrontier(model) && modelScore(model) != null && modelCost(model) != null && modelScore(model) >= floor).sort((a, b) => modelCost(a) - modelCost(b));
  const path = frontier.map((model, index) => `${index ? "L" : "M"} ${xPercent(modelCost(model))} ${yPercent(modelScore(model), floor, ceiling)}`).join(" ");

  $("#token-cost").setAttribute("aria-pressed", String(state.costMode === "token"));
  $("#task-cost").setAttribute("aria-pressed", String(state.costMode === "task"));
  $("#near-range").setAttribute("aria-pressed", String(!state.showFullRange));
  $("#full-range").setAttribute("aria-pressed", String(state.showFullRange));
  $("#chart-title").textContent = `${spec.label} vs. ${cost.title}`;
  $("#chart-subtitle").textContent = `${state.showFullRange ? "All scored models" : "Focused on the Opus 4.8 neighborhood"} · ${spec.shortLabel} frontier · ${cost.shortLabel} · log cost scale`;
  $("#y-title").textContent = spec.label;
  $("#x-title").textContent = cost.axisLabel;

  const plot = $("#plot");
  plot.innerHTML = [
    ...ticks.map((tick) => `<div class="y-grid" style="top:${yPercent(tick, floor, ceiling)}%"><span>${tick}</span></div>`),
    ...X_TICKS.map((tick) => `<div class="x-grid" style="left:${xPercent(tick)}%"><span>${money(tick)}</span></div>`),
    threshold != null && threshold >= floor && threshold <= ceiling
      ? `<div class="reference-line" style="top:${yPercent(threshold, floor, ceiling)}%"><span>Opus 4.8 max · ${scoreText(threshold)}</span></div>`
      : "",
    `<svg class="frontier-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="${path}"></path></svg>`,
    ...plotted.map((model) => {
      const classes = ["model-point", isFrontier(model) && "frontier", model.promotion_discount != null && "promo", state.activeId === model.id && "active"].filter(Boolean).join(" ");
      return `<button type="button" class="${classes}" data-model-id="${escapeHtml(model.id)}" style="left:${xPercent(modelCost(model))}%;top:${yPercent(modelScore(model), floor, ceiling)}%" aria-label="${escapeHtml(`${model.name}, ${spec.label} ${scoreText(modelScore(model))}, ${money(modelCost(model))} ${cost.unitLabel}`)}"></button>`;
    }),
    ...plotted.map((model) => `<i aria-hidden="true" class="model-leader" data-model-leader-id="${escapeHtml(model.id)}"></i><button type="button" class="model-label ${state.activeId === model.id ? "active" : ""}" data-model-label-id="${escapeHtml(model.id)}" aria-label="Inspect ${escapeHtml(model.name)}"><span>${escapeHtml(chartModelLabel(model))}</span><small>${scoreText(modelScore(model))} ${escapeHtml(spec.chartShort)} <b>·</b> ${money(modelCost(model))}${state.costMode === "token" ? "/M" : "/task"}</small></button>`),
  ].join("");

  chartContext = { plotted, floor, ceiling };
  plot.querySelectorAll("[data-model-id], [data-model-label-id]").forEach((target) => {
    const id = target.dataset.modelId ?? target.dataset.modelLabelId;
    target.addEventListener("mouseenter", () => setHoverId(id));
    target.addEventListener("mouseleave", () => clearHoverId(id));
    target.addEventListener("focus", () => setHoverId(id));
    target.addEventListener("blur", () => clearHoverId(id));
    target.addEventListener("click", () => toggleActiveId(id));
  });
  syncInteraction();
  return plotted.length;
}

function badges(model) {
  return [
    isFrontier(model) ? `<span class="frontier-badge" title="${escapeHtml(metricSpec().shortLabel)} Pareto frontier">Frontier</span>` : "",
    model.promotion_discount != null ? `<span class="promo-badge">Promo ${Math.round(model.promotion_discount * 100)}% off</span>` : "",
  ].join("");
}

function renderTable(models, plottedCount) {
  const rows = $("#model-rows");
  rows.innerHTML = models.map((model) => `<tr tabindex="0" aria-selected="${state.activeId === model.id}" aria-label="Inspect ${escapeHtml(model.name)} on the chart" data-row-id="${escapeHtml(model.id)}" class="${state.activeId === model.id ? "selected-row" : ""}">
    <td class="rank">${model.weekly_usage_rank == null ? "—" : `#${model.weekly_usage_rank}`}</td>
    <td><div class="model-name">${escapeHtml(model.name)}${badges(model)}</div><code>${escapeHtml(model.id)}</code></td>
    <td>${escapeHtml(providerLabel(model.provider))}</td>
    <td class="number score agent-eval" title="${escapeHtml(model.coding_agent_variant ?? "No Artificial Analysis Coding Agent Index result")}">${scoreText(model.coding_agent_index)}</td>
    <td class="number score agent-eval" title="DeepSWE from the selected Coding Agent Index model–agent–effort row">${scoreText(model.coding_agent_deep_swe_score)}</td>
    <td class="number score agent-eval" title="Terminal-Bench v2.1 from the selected Coding Agent Index model–agent–effort row">${scoreText(model.coding_agent_terminal_bench_score)}</td>
    <td class="number score agent-eval" title="SWE-Atlas-QnA from the selected Coding Agent Index model–agent–effort row">${scoreText(model.coding_agent_swe_atlas_qna_score)}</td>
    <td class="agent-eval">${escapeHtml(agentSetup(model))}</td>
    <td class="number agent-eval" title="Artificial Analysis mean cost for the selected model–agent–effort benchmark run">${money(model.coding_agent_source_cost)}</td>
    <td class="number score model-eval" title="Artificial Analysis Coding Index: two-thirds model Terminal-Bench v2.1 plus one-third SciCode">${scoreText(model.coding_index)}</td>
    <td class="number score model-eval" title="Terminal-Bench v2.1 from Artificial Analysis's model evaluation">${scoreText(model.model_terminal_bench_score)}</td>
    <td class="number score model-eval" title="SciCode from Artificial Analysis's model evaluation">${scoreText(model.scicode_score)}</td>
    <td class="model-eval" title="${escapeHtml(model.model_evaluation_variant ?? "No Artificial Analysis model evaluation")}">${escapeHtml(model.model_evaluation_effort ?? "—")}</td>
    <td class="number" title="${priceNote(model)}">${money(model.blended_price)}</td>
    <td class="number muted-cell">${model.context_length ? compact(model.context_length) : "—"}</td>
    <td class="number muted-cell" title="${model.observed_days_30d} daily top-50 appearances">${model.observed_tokens_30d ? compact(model.observed_tokens_30d) : "—"}</td>
  </tr>`).join("");
  rows.querySelectorAll("[data-row-id]").forEach((row) => {
    const id = row.dataset.rowId;
    row.addEventListener("mouseenter", () => setHoverId(id));
    row.addEventListener("mouseleave", () => clearHoverId(id));
    row.addEventListener("focus", () => setHoverId(id));
    row.addEventListener("blur", () => clearHoverId(id));
    row.addEventListener("click", () => toggleActiveId(id));
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggleActiveId(id);
    });
  });
  syncInteraction();
  $("#empty-state").hidden = models.length !== 0;
  const frontierCount = models.filter((model) => isFrontier(model)).length;
  $("#table-status").textContent = `${models.length} shown · ${plottedCount} in ${metricSpec().shortLabel} chart · ${frontierCount} frontier`;
}

function renderMethodology() {
  const { meta } = state.data;
  const mix = meta.token_mix;
  const threshold = meta.reference_model.coding_agent_index;
  $("#methodology").innerHTML = `
    <p><strong>Performance views.</strong> The default is the <a href="${escapeHtml(meta.artificial_analysis_source_url)}">Artificial Analysis Coding Agent Index</a> v${escapeHtml(meta.artificial_analysis_version)}, an equal-weight composite of DeepSWE, Terminal-Bench v2.1, and SWE-Atlas-QnA. The selector also exposes the Artificial Analysis Coding Index and both sets of components. All seven measures use a 0–100, higher-is-better scale, and every view computes its own price/performance Pareto frontier. The Opus 4.8 (max) Coding Agent Index reference is ${threshold == null ? "unavailable" : threshold.toFixed(1)}.</p>
    <p><strong>Two Terminal-Bench results.</strong> <em>Model · Terminal-Bench v2.1</em> is Artificial Analysis’s model-level evaluation and supplies two-thirds of the Coding Index; SciCode supplies the other third. The composite uses AA’s full-precision inputs before the table rounds each displayed value to one decimal. <em>Agent · Terminal-Bench v2.1</em> is the result from the exact model–agent–effort row selected for the Coding Agent Index. The table groups and labels them separately because they are different runs in different evaluation contexts.</p>
    <p><strong>Score selection and provenance.</strong> Every benchmark input is fetched directly from Artificial Analysis; OpenRouter’s benchmark fields are ignored. For AA model evaluations and Coding Agent Index results published at several reasoning levels, this dashboard selects the highest level. At the same level it prefers AA’s default row and then the higher score. Coding Agent Index components come from that exact selected agent row. The Coding Index is calculated from AA’s directly published Terminal-Bench v2.1 and SciCode results using their current 16% and 8% Intelligence Index weights, normalized within AA’s 24% Coding category.</p>
    <p><strong>Population and price.</strong> Models without advertised tool calling are excluded before taking OpenRouter’s top 100 <code>top-weekly</code> ordering. The default cost axis uses a fixed ${ratioText(mix)} cached-input, uncached-input, and output token ratio: ${percent(mix.cached_input_share)} cached input, ${percent(mix.uncached_input_share)} uncached input, and ${percent(mix.output_share)} output. OpenRouter’s traffic-weighted effective input price is separated using its observed cache-hit rate and catalog cache-read ratio. These are underlying traffic economics, not necessarily endpoint charges; <code>:free</code> endpoints still cost the OpenRouter user $0.</p>
    <p><strong>AA cost-per-task option.</strong> The alternate cost axis uses Artificial Analysis’s mean USD cost per task for the exact model–agent–effort row selected for the Coding Agent Index. It captures the model plus the benchmark agent harness, task workload, and reasoning effort, so it is useful as an empirical agent-run cost but should not be read as a universal price for one task or as the cost of AA’s separate model-level evaluations. Models without a mapped AA agent-run cost are omitted in this mode. The dashboard recomputes the selected score’s Pareto frontier whenever the cost basis changes.</p>
    <p><strong>Coverage.</strong> ${meta.performance_metrics.coding_agent.scored_model_count} of ${meta.model_count} ranked models have a mapped Coding Agent Index result, while ${meta.performance_metrics.coding.scored_model_count} have both model-level Coding Index components. AA currently publishes ${meta.artificial_analysis_model_row_count} model evaluation rows and ${meta.artificial_analysis_row_count} model–agent–effort rows. Observed 30-day tokens are lower bounds because OpenRouter’s daily dataset exposes only the top 50 models per day. Promotion badges come from OpenRouter’s <a href="${escapeHtml(meta.promotional_pricing_source)}">Discounted Models collection</a>.</p>
    <p>Performance: <a href="${escapeHtml(meta.artificial_analysis_model_source_url)}">Artificial Analysis model evaluations</a> and <a href="${escapeHtml(meta.artificial_analysis_source_url)}">Coding Agent Index</a>. Population, usage, and price: <a href="${escapeHtml(meta.source_url)}">OpenRouter rankings</a>, as of ${escapeHtml(meta.usage_as_of)}.</p>`;
}

function render() {
  renderSummary();
  const models = filteredModels();
  const plottedCount = renderChart(models);
  renderTable(models, plottedCount);
}

function bindControls() {
  const providers = [...new Set(state.data.models.map((model) => model.provider))].sort();
  $("#provider").insertAdjacentHTML("beforeend", providers.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(providerLabel(item))}</option>`).join(""));
  $("#search").addEventListener("input", (event) => { state.query = event.target.value; render(); });
  $("#provider").addEventListener("change", (event) => { state.provider = event.target.value; render(); });
  $("#frontier-only").addEventListener("change", (event) => { state.frontierOnly = event.target.checked; render(); });
  $("#metric").addEventListener("change", (event) => { state.metric = event.target.value; state.hoverId = null; render(); });
  $("#sort").addEventListener("change", (event) => { state.sort = event.target.value; render(); });
  $("#token-cost").addEventListener("click", () => { state.costMode = "token"; state.hoverId = null; render(); });
  $("#task-cost").addEventListener("click", () => { state.costMode = "task"; state.hoverId = null; render(); });
  $("#near-range").addEventListener("click", () => { state.showFullRange = false; render(); });
  $("#full-range").addEventListener("click", () => { state.showFullRange = true; render(); });
  $("#reset").addEventListener("click", () => {
    Object.assign(state, {
      query: "", provider: "all", frontierOnly: false, metric: "coding_agent",
      costMode: "token", sort: "rank", showFullRange: false, activeId: null, hoverId: null,
    });
    $("#search").value = ""; $("#provider").value = "all"; $("#frontier-only").checked = false;
    $("#metric").value = "coding_agent"; $("#sort").value = "rank";
    render();
  });
  let resizeFrame = null;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(render);
  });
}

function start() {
  const dataset = $("#model-data");
  if (!dataset) throw new Error("Embedded dataset is missing");
  state.data = JSON.parse(dataset.textContent);
  renderMethodology();
  bindControls();
  render();
}

try {
  start();
} catch (error) {
  $("#data-date").textContent = "Dashboard unavailable";
  $("#summary").innerHTML = `<div class="load-error"><strong>Dashboard failed to initialize</strong><span>${escapeHtml(error.message)}</span></div>`;
}
