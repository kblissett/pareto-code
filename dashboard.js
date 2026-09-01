"use strict";

const X_TICKS = [0, 0.03, 0.1, 0.3, 1, 3, 10, 30];
const FULL_Y_TICKS = [0, 20, 40, 60, 80, 100];
const FOCUSED_Y_FLOOR = 45;
const X_FLOOR = 0.03;
const X_CEILING = 30;

const state = {
  data: null,
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
function modelScore(model) { return model.coding_agent_index; }
function modelPrice(model) { return model.blended_price; }
function isFrontier(model) { return Boolean(model.is_frontier); }
function scoreText(value) { return value == null ? "—" : value.toFixed(1); }

function xPercent(price) {
  const value = Math.log10(price + X_FLOOR);
  const low = Math.log10(X_FLOOR);
  const high = Math.log10(X_CEILING + X_FLOOR);
  return ((value - low) / (high - low)) * 100;
}

function focusedCeiling() {
  const scores = state.data.models.map(modelScore).filter((score) => score != null);
  return Math.max(70, Math.ceil(Math.max(...scores) / 5) * 5);
}

function yPercent(score, floor, ceiling) {
  return 100 - ((score - floor) / (ceiling - floor)) * 100;
}

function focusedTicks(ceiling) {
  const ticks = [];
  for (let tick = FOCUSED_Y_FLOOR; tick <= ceiling; tick += 5) ticks.push(tick);
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
  const threshold = meta.reference_model.coding_agent_index;
  const above = models.filter((model) => !model.is_supplemental && modelScore(model) != null && modelScore(model) >= threshold).length;
  $("#data-date").textContent = `OpenRouter through ${meta.usage_end_date} · AA Coding Agent Index v${meta.artificial_analysis_version}`;
  $("#summary").innerHTML = `
    <div><span>AA-index scored</span><strong>${meta.scored_model_count}</strong></div>
    <div><span>At / above Opus 4.8 (max)</span><strong>${above}</strong></div>
    <div><span>Pareto frontier</span><strong>${meta.frontier_count}</strong></div>
    <div><span>Cached : uncached : output blend</span><strong>${ratioText(mix)}</strong></div>`;
  $("#legend").innerHTML = `
    <span><i class="legend-dot"></i> Model</span><span><i class="legend-dot frontier"></i> Frontier</span>
    <span><i class="legend-interest"></i> Tracked</span><span><i class="legend-promo"></i> Promo</span>
    <span><i class="legend-line"></i> Opus 4.8 max (${scoreText(threshold)})</span>`;
}

function tooltipHtml(model) {
  const rank = model.weekly_usage_rank == null ? "Supplemental · not OpenRouter-ranked" : `#${model.weekly_usage_rank} usage rank`;
  const tracked = model.is_interest ? " · tracked" : "";
  const promo = model.promotion_discount == null ? "" : ` · ${Math.round(model.promotion_discount * 100)}% promo`;
  const note = model.is_interest
    ? `<p class="tooltip-note">${model.price_kind === "cache_mix_estimate" ? "Off OpenRouter · fixed-blend price estimate" : "Tracked model"}</p>`
    : "";
  return `<strong>${escapeHtml(model.name)}</strong><span>${rank}${tracked}${promo}</span><dl>
    <div><dt>AA agent index</dt><dd>${scoreText(modelScore(model))}</dd></div>
    <div><dt>Agent setup</dt><dd>${escapeHtml(agentSetup(model))}</dd></div>
    <div><dt>AA run cost</dt><dd>${money(model.coding_agent_source_cost)}/task</dd></div>
    <div><dt>${model.price_kind === "cache_mix_estimate" ? "Est. blend" : "Economic blend"}</dt><dd>${money(modelPrice(model))}/M</dd></div>
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

function renderChart(models) {
  const floor = state.showFullRange ? 0 : FOCUSED_Y_FLOOR;
  const ceiling = state.showFullRange ? 100 : focusedCeiling();
  const ticks = state.showFullRange ? FULL_Y_TICKS : focusedTicks(ceiling);
  const threshold = state.data.meta.reference_model.coding_agent_index;
  const plotted = models.filter((model) => modelScore(model) != null && modelPrice(model) != null && modelScore(model) >= floor);
  const frontier = state.data.models.filter((model) => isFrontier(model) && modelScore(model) != null && modelPrice(model) != null && modelScore(model) >= floor).sort((a, b) => modelPrice(a) - modelPrice(b));
  const focused = state.data.models.find((model) => model.id === (state.hoverId ?? state.activeId));
  const path = frontier.map((model, index) => `${index ? "L" : "M"} ${xPercent(modelPrice(model))} ${yPercent(modelScore(model), floor, ceiling)}`).join(" ");

  $("#near-range").setAttribute("aria-pressed", String(!state.showFullRange));
  $("#full-range").setAttribute("aria-pressed", String(state.showFullRange));
  $("#chart-subtitle").textContent = `${state.showFullRange ? "All scored models" : "Focused on the Opus 4.8 neighborhood"} · highest published thinking level · 200:7:1 token blend · log price scale`;

  const plot = $("#plot");
  plot.innerHTML = [
    ...ticks.map((tick) => `<div class="y-grid" style="top:${yPercent(tick, floor, ceiling)}%"><span>${tick}</span></div>`),
    ...X_TICKS.map((tick) => `<div class="x-grid" style="left:${xPercent(tick)}%"><span>${money(tick)}</span></div>`),
    `<div class="reference-line" style="top:${yPercent(threshold, floor, ceiling)}%"><span>Opus 4.8 max · ${scoreText(threshold)}</span></div>`,
    `<svg class="frontier-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="${path}"></path></svg>`,
    ...plotted.map((model) => {
      const classes = ["model-point", isFrontier(model) && "frontier", model.is_interest && "interest", model.is_promotional && "promo", model.price_kind === "cache_mix_estimate" && "estimate", state.activeId === model.id && "active"].filter(Boolean).join(" ");
      return `<button type="button" class="${classes}" data-model-id="${escapeHtml(model.id)}" style="left:${xPercent(modelPrice(model))}%;top:${yPercent(modelScore(model), floor, ceiling)}%" aria-label="${escapeHtml(`${model.name}, AA Coding Agent Index ${scoreText(modelScore(model))}, ${money(modelPrice(model))} per million usage tokens`)}"></button>`;
    }),
    ...plotted.filter((model) => model.is_interest).map((model) => `<span aria-hidden="true" class="interest-label ${model.is_supplemental ? "supplemental" : ""}" style="left:${xPercent(modelPrice(model))}%;top:${yPercent(modelScore(model), floor, ceiling)}%">${escapeHtml(model.chart_label ?? model.name)}</span>`),
    focused && modelScore(focused) != null && modelPrice(focused) != null && modelScore(focused) >= floor
      ? `<div class="chart-tooltip" style="left:${Math.min(78, Math.max(3, xPercent(modelPrice(focused))))}%;top:${Math.min(72, Math.max(2, yPercent(modelScore(focused), floor, ceiling) + 3))}%">${tooltipHtml(focused)}</div>`
      : "",
  ].join("");

  plot.querySelectorAll("[data-model-id]").forEach((point) => {
    const id = point.dataset.modelId;
    point.addEventListener("mouseenter", () => { state.hoverId = id; updateTooltip(floor, ceiling); });
    point.addEventListener("mouseleave", () => { state.hoverId = null; updateTooltip(floor, ceiling); });
    point.addEventListener("focus", () => { state.hoverId = id; updateTooltip(floor, ceiling); });
    point.addEventListener("blur", () => { state.hoverId = null; updateTooltip(floor, ceiling); });
    point.addEventListener("click", () => { state.activeId = state.activeId === id ? null : id; state.hoverId = null; render(); });
  });
  return plotted.length;
}

function badges(model) {
  return [
    isFrontier(model) ? '<span class="frontier-badge">Frontier</span>' : "",
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
    <td class="number score" title="${escapeHtml(model.coding_agent_variant ?? "No Artificial Analysis Coding Agent Index result")}">${modelScore(model) == null ? "—" : scoreText(modelScore(model))}</td>
    <td>${escapeHtml(agentSetup(model))}</td>
    <td class="number" title="${escapeHtml(model.price_note ?? "")}">${money(modelPrice(model))}${model.price_kind === "cache_mix_estimate" ? "<sup>est.</sup>" : ""}</td>
    <td class="number muted-cell">${model.context_length ? compact(model.context_length) : "—"}</td>
    <td class="number muted-cell" title="${model.on_openrouter ? `${model.observed_days_30d} daily top-50 appearances` : "Not available on OpenRouter"}">${model.observed_tokens_30d ? compact(model.observed_tokens_30d) : "—"}</td>
  </tr>`).join("");
  rows.querySelectorAll("[data-row-id]").forEach((row) => row.addEventListener("click", () => {
    state.activeId = state.activeId === row.dataset.rowId ? null : row.dataset.rowId;
    render();
  }));
  $("#empty-state").hidden = models.length !== 0;
  const frontierCount = models.filter((model) => isFrontier(model)).length;
  $("#table-status").textContent = `${models.length} shown · ${plottedCount} in chart · ${frontierCount} frontier`;
}

function renderMethodology() {
  const { meta } = state.data;
  const mix = meta.token_mix;
  const threshold = meta.reference_model.coding_agent_index;
  $("#methodology").innerHTML = `
    <p><strong>One performance measure.</strong> Performance is the <a href="${escapeHtml(meta.artificial_analysis_source_url)}">Artificial Analysis Coding Agent Index</a> v${escapeHtml(meta.artificial_analysis_version)}, an equal-weight composite of DeepSWE, Terminal-Bench v2.1, and SWE-Atlas-QnA. For models published at several reasoning levels, this dashboard selects the highest level (<code>max</code> above <code>xhigh</code>, and so on); at the same level it prefers AA’s default row, then the higher-scoring harness. The separate DeepSWE and older AA Coding Index views have been removed. The Opus 4.8 (max) reference is ${threshold.toFixed(1)}.</p>
    <p><strong>Population and price.</strong> Models without advertised tool calling are excluded before taking OpenRouter’s top 100 <code>top-weekly</code> ordering. The cost axis uses a fixed ${ratioText(mix)} cached-input, uncached-input, and output token ratio: ${percent(mix.cached_input_share)} cached input, ${percent(mix.uncached_input_share)} uncached input, and ${percent(mix.output_share)} output. OpenRouter’s traffic-weighted effective input price is separated using its observed cache-hit rate and catalog cache-read ratio. These are underlying traffic economics, not necessarily endpoint charges; <code>:free</code> endpoints still cost the OpenRouter user $0. The Pareto frontier includes ranked models with both an AA score and an effective price.</p>
    <p><strong>Tracked models.</strong> Tracked catalog models remain visible outside the top 100. Muse Contributor shares the Muse Spark 1.2 checkpoint and selected AA agent result; its price uses <a href="https://developer.meta.com/ai/resources/blog/build-with-muse-code/">Meta API pricing</a> and the same fixed token mix. Tracked models do not alter the ranked frontier.</p>
    <p><strong>Coverage.</strong> ${meta.scored_model_count} of ${meta.model_count} ranked models have a mapped Coding Agent Index result; AA currently publishes ${meta.artificial_analysis_row_count} model–agent–effort rows. Observed 30-day tokens are lower bounds because OpenRouter’s daily dataset exposes only the top 50 models per day. Promotion badges come from OpenRouter’s <a href="${escapeHtml(meta.promotional_pricing_source)}">Discounted Models collection</a>.</p>
    <p>Source: <a href="${escapeHtml(meta.source_url)}">OpenRouter rankings</a>, as of ${escapeHtml(meta.usage_as_of)}.</p>`;
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
  $("#sort").addEventListener("change", (event) => { state.sort = event.target.value; render(); });
  $("#near-range").addEventListener("click", () => { state.showFullRange = false; render(); });
  $("#full-range").addEventListener("click", () => { state.showFullRange = true; render(); });
  $("#reset").addEventListener("click", () => {
    Object.assign(state, { query: "", provider: "all", frontierOnly: false });
    $("#search").value = ""; $("#provider").value = "all"; $("#frontier-only").checked = false;
    render();
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
