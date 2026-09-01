"use strict";

const X_TICKS = [0, 0.03, 0.1, 0.3, 1, 3, 10, 30];
const FULL_Y_TICKS = [0, 20, 40, 60, 80, 100];
const X_FLOOR = 0.03;
const X_CEILING = 30;
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
  sort: "rank",
  showFullRange: false,
  activeId: null,
  hoverId: null,
};

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
function modelScore(model) { return model[metricSpec().scoreKey]; }
function modelPrice(model) { return model.blended_price; }
function isFrontier(model) { return (model.frontier_metrics ?? []).includes(state.metric); }
function scoreText(value) { return value == null ? "—" : value.toFixed(1); }
function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }

function chartModelLabel(model) {
  if (model.chart_label) return model.chart_label;
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
    if (state.sort === "price") return (modelPrice(a) ?? Infinity) - (modelPrice(b) ?? Infinity);
    if (state.sort === "tokens") return b.observed_tokens_30d - a.observed_tokens_30d;
    return (a.weekly_usage_rank ?? Infinity) - (b.weekly_usage_rank ?? Infinity);
  });
}

function agentSetup(model) {
  if (!model.coding_agent_harness) return "—";
  return model.coding_agent_effort
    ? `${model.coding_agent_harness} · ${model.coding_agent_effort}`
    : model.coding_agent_harness;
}

function renderSummary() {
  const { meta, models } = state.data;
  const mix = meta.token_mix;
  const spec = metricSpec();
  const threshold = meta.reference_model[spec.scoreKey];
  const above = models.filter((model) => !model.is_supplemental && modelScore(model) != null && modelScore(model) >= threshold).length;
  $("#data-date").textContent = `OpenRouter through ${meta.usage_end_date} · AA model data v${meta.artificial_analysis_model_version} · Coding Agent Index v${meta.artificial_analysis_version}`;
  $("#summary").innerHTML = `
    <div><span>${escapeHtml(spec.shortLabel)} scored</span><strong>${meta.performance_metrics[state.metric].scored_model_count}</strong></div>
    <div><span>At / above Opus 4.8 (max)</span><strong>${threshold == null ? "—" : above}</strong></div>
    <div><span>${escapeHtml(spec.shortLabel)} Pareto frontier</span><strong>${meta.performance_metrics[state.metric].frontier_count}</strong></div>
    <div><span>Cached : uncached : output blend</span><strong>${ratioText(mix)}</strong></div>`;
  $("#legend").innerHTML = `
    <span><i class="legend-dot"></i> Model</span><span><i class="legend-dot frontier"></i> Frontier</span>
    <span><i class="legend-interest"></i> Tracked</span><span><i class="legend-promo"></i> Promo</span>
    ${threshold == null ? "" : `<span><i class="legend-line"></i> Opus 4.8 max (${scoreText(threshold)})</span>`}`;
}

function tooltipHtml(model) {
  const rank = model.weekly_usage_rank == null ? "Supplemental · not OpenRouter-ranked" : `#${model.weekly_usage_rank} usage rank`;
  const tracked = model.is_interest ? " · tracked" : "";
  const promo = model.promotion_discount == null ? "" : ` · ${Math.round(model.promotion_discount * 100)}% promo`;
  const note = model.is_interest ? '<p class="tooltip-note">Tracked model</p>' : "";
  return `<strong>${escapeHtml(model.name)}</strong><span>${rank}${tracked}${promo}</span><dl>
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
    <div><dt>Economic blend</dt><dd>${money(modelPrice(model))}/M</dd></div>
    ${model.is_free_endpoint ? `<div><dt>Catalog charge</dt><dd>${money(model.catalog_blended_price)}/M (free)</dd></div>` : ""}
    <div><dt>Uncached input</dt><dd>${money(model.effective_uncached_input_price)}/M</dd></div>
    <div><dt>Cached input</dt><dd>${money(model.effective_cached_input_price)}/M</dd></div>
    <div><dt>Output</dt><dd>${money(model.effective_output_price)}/M</dd></div>
  </dl>${note}`;
}

function updateTooltip(floor, ceiling) {
  $("#plot .chart-tooltip")?.remove();
  const focused = state.data.models.find((model) => model.id === (state.hoverId ?? state.activeId));
  if (!focused || modelScore(focused) == null || modelPrice(focused) == null || modelScore(focused) < floor) return;
  const tooltip = document.createElement("div");
  tooltip.className = "chart-tooltip";
  tooltip.style.left = `${Math.min(78, Math.max(3, xPercent(modelPrice(focused))))}%`;
  tooltip.style.top = `${Math.min(72, Math.max(2, yPercent(modelScore(focused), floor, ceiling) + 3))}%`;
  tooltip.innerHTML = tooltipHtml(focused);
  $("#plot").append(tooltip);
}

function overlapArea(first, second, padding = 6) {
  const width = Math.max(0, Math.min(first.x + first.width + padding, second.x + second.width) - Math.max(first.x, second.x - padding));
  const height = Math.max(0, Math.min(first.y + first.height + padding, second.y + second.height) - Math.max(first.y, second.y - padding));
  return width * height;
}

function placeFrontierLabels(models, plotted, floor, ceiling) {
  const plot = $("#plot");
  const width = plot.clientWidth;
  const height = plot.clientHeight;
  if (!width || !height) return;

  const occupied = [];
  const points = plotted.map((model) => ({
    id: model.id,
    x: width * xPercent(modelPrice(model)) / 100,
    y: height * yPercent(modelScore(model), floor, ceiling) / 100,
  }));

  models.slice().sort((a, b) => xPercent(modelPrice(a)) - xPercent(modelPrice(b))).forEach((model) => {
    const label = plot.querySelector(`[data-frontier-label-id="${CSS.escape(model.id)}"]`);
    const leader = plot.querySelector(`[data-frontier-leader-id="${CSS.escape(model.id)}"]`);
    if (!label || !leader) return;

    const labelWidth = label.offsetWidth;
    const labelHeight = label.offsetHeight;
    const pointX = width * xPercent(modelPrice(model)) / 100;
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
        penalty: labelOverlap * 1000 + coveredPoints * 50000 + clampDistance * 30 + leaderDistance,
      };
    }).sort((a, b) => a.penalty - b.penalty);

    const rectangle = scored[0].rectangle;
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

function renderChart(models) {
  const spec = metricSpec();
  const floor = state.showFullRange ? 0 : focusedFloor();
  const ceiling = state.showFullRange ? 100 : focusedCeiling();
  const ticks = state.showFullRange ? FULL_Y_TICKS : focusedTicks(ceiling);
  const threshold = state.data.meta.reference_model[spec.scoreKey];
  const plotted = models.filter((model) => modelScore(model) != null && modelPrice(model) != null && modelScore(model) >= floor);
  const frontier = state.data.models.filter((model) => isFrontier(model) && modelScore(model) != null && modelPrice(model) != null && modelScore(model) >= floor).sort((a, b) => modelPrice(a) - modelPrice(b));
  const plottedIds = new Set(plotted.map((model) => model.id));
  const labeledFrontier = frontier.filter((model) => plottedIds.has(model.id));
  const focused = state.data.models.find((model) => model.id === (state.hoverId ?? state.activeId));
  const path = frontier.map((model, index) => `${index ? "L" : "M"} ${xPercent(modelPrice(model))} ${yPercent(modelScore(model), floor, ceiling)}`).join(" ");

  $("#near-range").setAttribute("aria-pressed", String(!state.showFullRange));
  $("#full-range").setAttribute("aria-pressed", String(state.showFullRange));
  $("#chart-title").textContent = `${spec.label} vs. traffic economics`;
  $("#chart-subtitle").textContent = `${state.showFullRange ? "All scored models" : "Focused on the Opus 4.8 neighborhood"} · ${spec.shortLabel} frontier · 200:7:1 token blend · log price scale`;
  $("#y-title").textContent = spec.label;

  const plot = $("#plot");
  plot.innerHTML = [
    ...ticks.map((tick) => `<div class="y-grid" style="top:${yPercent(tick, floor, ceiling)}%"><span>${tick}</span></div>`),
    ...X_TICKS.map((tick) => `<div class="x-grid" style="left:${xPercent(tick)}%"><span>${money(tick)}</span></div>`),
    threshold != null && threshold >= floor && threshold <= ceiling
      ? `<div class="reference-line" style="top:${yPercent(threshold, floor, ceiling)}%"><span>Opus 4.8 max · ${scoreText(threshold)}</span></div>`
      : "",
    `<svg class="frontier-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="${path}"></path></svg>`,
    ...plotted.map((model) => {
      const classes = ["model-point", isFrontier(model) && "frontier", model.is_interest && "interest", model.is_promotional && "promo", state.activeId === model.id && "active"].filter(Boolean).join(" ");
      return `<button type="button" class="${classes}" data-model-id="${escapeHtml(model.id)}" style="left:${xPercent(modelPrice(model))}%;top:${yPercent(modelScore(model), floor, ceiling)}%" aria-label="${escapeHtml(`${model.name}, ${spec.label} ${scoreText(modelScore(model))}, ${money(modelPrice(model))} per million usage tokens`)}"></button>`;
    }),
    ...plotted.filter((model) => model.is_interest).map((model) => `<span aria-hidden="true" class="interest-label ${model.is_supplemental ? "supplemental" : ""}" style="left:${xPercent(modelPrice(model))}%;top:${yPercent(modelScore(model), floor, ceiling)}%">${escapeHtml(model.chart_label ?? model.name)}</span>`),
    ...labeledFrontier.map((model) => `<i aria-hidden="true" class="frontier-leader" data-frontier-leader-id="${escapeHtml(model.id)}"></i><button type="button" class="frontier-label ${state.activeId === model.id ? "active" : ""}" data-frontier-label-id="${escapeHtml(model.id)}" aria-label="Inspect ${escapeHtml(model.name)}"><span>${escapeHtml(chartModelLabel(model))}</span><small>${scoreText(modelScore(model))} ${escapeHtml(spec.chartShort)} <b>·</b> ${money(modelPrice(model))}/M</small></button>`),
    focused && modelScore(focused) != null && modelPrice(focused) != null && modelScore(focused) >= floor
      ? `<div class="chart-tooltip" style="left:${Math.min(78, Math.max(3, xPercent(modelPrice(focused))))}%;top:${Math.min(72, Math.max(2, yPercent(modelScore(focused), floor, ceiling) + 3))}%">${tooltipHtml(focused)}</div>`
      : "",
  ].join("");

  placeFrontierLabels(labeledFrontier, plotted, floor, ceiling);
  plot.querySelectorAll("[data-model-id], [data-frontier-label-id]").forEach((target) => {
    const id = target.dataset.modelId ?? target.dataset.frontierLabelId;
    target.addEventListener("mouseenter", () => { state.hoverId = id; updateTooltip(floor, ceiling); });
    target.addEventListener("mouseleave", () => { state.hoverId = null; updateTooltip(floor, ceiling); });
    target.addEventListener("focus", () => { state.hoverId = id; updateTooltip(floor, ceiling); });
    target.addEventListener("blur", () => { state.hoverId = null; updateTooltip(floor, ceiling); });
    target.addEventListener("click", () => { state.activeId = state.activeId === id ? null : id; state.hoverId = null; render(); });
  });
  return plotted.length;
}

function badges(model) {
  return [
    isFrontier(model) ? `<span class="frontier-badge" title="${escapeHtml(metricSpec().shortLabel)} Pareto frontier">Frontier</span>` : "",
    model.is_interest ? '<span class="interest-badge">Tracked</span>' : "",
    model.promotion_discount != null ? `<span class="promo-badge">Promo ${Math.round(model.promotion_discount * 100)}% off</span>` : "",
    !model.on_openrouter ? '<span class="external-badge">Off OpenRouter</span>' : "",
  ].join("");
}

function renderTable(models, plottedCount) {
  const rows = $("#model-rows");
  rows.innerHTML = models.map((model) => `<tr data-row-id="${escapeHtml(model.id)}" class="${state.activeId === model.id ? "selected-row" : ""}">
    <td class="rank">${model.weekly_usage_rank == null ? "—" : `#${model.weekly_usage_rank}`}</td>
    <td><div class="model-name">${escapeHtml(model.name)}${badges(model)}</div><code>${escapeHtml(model.id)}</code></td>
    <td>${escapeHtml(providerLabel(model.provider))}</td>
    <td class="number score agent-eval" title="${escapeHtml(model.coding_agent_variant ?? "No Artificial Analysis Coding Agent Index result")}">${scoreText(model.coding_agent_index)}</td>
    <td class="number score agent-eval" title="DeepSWE from the selected Coding Agent Index model–agent–effort row">${scoreText(model.coding_agent_deep_swe_score)}</td>
    <td class="number score agent-eval" title="Terminal-Bench v2.1 from the selected Coding Agent Index model–agent–effort row">${scoreText(model.coding_agent_terminal_bench_score)}</td>
    <td class="number score agent-eval" title="SWE-Atlas-QnA from the selected Coding Agent Index model–agent–effort row">${scoreText(model.coding_agent_swe_atlas_qna_score)}</td>
    <td class="agent-eval">${escapeHtml(agentSetup(model))}</td>
    <td class="number score model-eval" title="Artificial Analysis Coding Index: two-thirds model Terminal-Bench v2.1 plus one-third SciCode">${scoreText(model.coding_index)}</td>
    <td class="number score model-eval" title="Terminal-Bench v2.1 from Artificial Analysis's model evaluation">${scoreText(model.model_terminal_bench_score)}</td>
    <td class="number score model-eval" title="SciCode from Artificial Analysis's model evaluation">${scoreText(model.scicode_score)}</td>
    <td class="model-eval" title="${escapeHtml(model.model_evaluation_variant ?? "No Artificial Analysis model evaluation")}">${escapeHtml(model.model_evaluation_effort ?? "—")}</td>
    <td class="number" title="${escapeHtml(model.price_note ?? "")}">${money(modelPrice(model))}</td>
    <td class="number muted-cell">${model.context_length ? compact(model.context_length) : "—"}</td>
    <td class="number muted-cell" title="${model.on_openrouter ? `${model.observed_days_30d} daily top-50 appearances` : "Not available on OpenRouter"}">${model.observed_tokens_30d ? compact(model.observed_tokens_30d) : "—"}</td>
  </tr>`).join("");
  rows.querySelectorAll("[data-row-id]").forEach((row) => row.addEventListener("click", () => {
    state.activeId = state.activeId === row.dataset.rowId ? null : row.dataset.rowId;
    render();
  }));
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
    <p><strong>Population and price.</strong> Models without advertised tool calling are excluded before taking OpenRouter’s top 100 <code>top-weekly</code> ordering. The cost axis uses a fixed ${ratioText(mix)} cached-input, uncached-input, and output token ratio: ${percent(mix.cached_input_share)} cached input, ${percent(mix.uncached_input_share)} uncached input, and ${percent(mix.output_share)} output. OpenRouter’s traffic-weighted effective input price is separated using its observed cache-hit rate and catalog cache-read ratio. These are underlying traffic economics, not necessarily endpoint charges; <code>:free</code> endpoints still cost the OpenRouter user $0. The Pareto frontier includes ranked models with both an AA score and an effective price.</p>
    <p><strong>Tracked models.</strong> Tracked catalog models remain visible outside the top 100 and do not alter the ranked frontier.</p>
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
  $("#metric").addEventListener("change", (event) => { state.metric = event.target.value; state.activeId = null; state.hoverId = null; render(); });
  $("#sort").addEventListener("change", (event) => { state.sort = event.target.value; render(); });
  $("#near-range").addEventListener("click", () => { state.showFullRange = false; render(); });
  $("#full-range").addEventListener("click", () => { state.showFullRange = true; render(); });
  $("#reset").addEventListener("click", () => {
    Object.assign(state, { query: "", provider: "all", frontierOnly: false, metric: "coding_agent" });
    $("#search").value = ""; $("#provider").value = "all"; $("#frontier-only").checked = false; $("#metric").value = "coding_agent";
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
