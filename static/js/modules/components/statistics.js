import { state } from "../core/state.js";
import { formatNumber, formatRangeText } from "../utils/format.js";
import { ensureChartJsLibrary } from "../utils/charts.js";

// --- Statistics Logic ---

let statsActivityChart = null;

export function renderStatistics(statistics) {
    console.log("[Statistics] Rendering with:", statistics);
    if (statistics && statistics.date_range) {
        console.log("[Statistics] Date range:", statistics.date_range);
    } else {
        console.warn("[Statistics] Date range missing or invalid");
    }

    if (!statistics) {
        setTextContent("stats-total-conversations", "—");
        setTextContent("stats-total-messages", "—");
        setTextContent("stats-average-per-day", "—");
        setTextContent("stats-average-messages", "—");
        setTextContent("stats-active-restaurants", "—");
        setTextContent("stats-resolution-rate", "—");
        const fallbackRange = {
            start: state.statistics.startDate,
            end: state.statistics.endDate,
        };
        setTextContent("statistics-range-label", formatRangeText(fallbackRange));
        renderTopQuestions([]);
        renderDietBreakdown([]);
        // updateBusiestSections(null); // This function is in overview.js, but statistics uses it too?
        // In original code, updateBusiestSections was defined in dashboard.js and used by both.
        // I should probably export it from overview.js or move it to a shared place.
        // Or just duplicate it for now to avoid circular dependency if overview imports statistics.
        // Actually, updateBusiestSections updates "stats-busiest-list".
        // I'll duplicate it here or import it if I can.
        // overview.js imports restaurants.js.
        // statistics.js doesn't import overview.js.
        // I'll duplicate it for simplicity or move to a shared UI module.
        updateBusiestSections(null);

        renderStatisticsActivityChart([]);
        renderStatsRestaurantBreakdown([]);
        return;
    }
    setTextContent("stats-total-conversations", formatNumber(statistics.total_conversations));
    setTextContent("stats-total-messages", formatNumber(statistics.total_messages));
    setTextContent("stats-average-per-day", formatNumber(statistics.average_per_day));
    setTextContent(
        "stats-average-messages",
        typeof statistics.average_messages === "number"
            ? statistics.average_messages.toFixed(1)
            : "—"
    );
    const resolution = typeof statistics.resolution_rate === "number" ? `${statistics.resolution_rate}%` : "—";
    setTextContent("stats-resolution-rate", resolution);
    setTextContent("statistics-range-label", formatRangeText(statistics.date_range));
    const breakdownEntries = Array.isArray(statistics.restaurant_breakdown)
        ? statistics.restaurant_breakdown.filter((entry) => (entry.count || 0) > 0)
        : [];
    const activeCount = breakdownEntries.length
        || state.statistics.selectedRestaurants.length
        || state.statistics.availableRestaurants.length;
    setTextContent("stats-active-restaurants", formatNumber(activeCount || 0));
    renderTopQuestions(statistics.top_questions);
    renderDietBreakdown(statistics.diet_breakdown);
    updateBusiestSections(statistics.busiest);
    renderStatisticsActivityChart(statistics.timeline);
    renderStatsRestaurantBreakdown(statistics.restaurant_breakdown);
}

function renderStatisticsActivityChart(timeline) {
    const canvas = document.getElementById("stats-activity-chart");
    const emptyState = document.getElementById("stats-activity-empty");
    if (!canvas || !emptyState) {
        return;
    }
    const normalizedTimeline = normalizeStatisticsTimeline(timeline);
    const hasData = normalizedTimeline.length > 0;
    if (!hasData) {
        if (statsActivityChart) {
            statsActivityChart.destroy();
            statsActivityChart = null;
        }
        emptyState.hidden = false;
        canvas.hidden = true;
        return;
    }
    emptyState.hidden = true;
    canvas.hidden = false;
    ensureChartJsLibrary()
        .then((ChartLib) => {
            const ctx = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
            if (!ctx) {
                return;
            }
            const labels = normalizedTimeline.map((point) => point.label || point.date || "");
            const conversations = normalizedTimeline.map((point) =>
                typeof point.conversations === "number"
                    ? point.conversations
                    : typeof point.count === "number"
                        ? point.count
                        : 0,
            );
            const messages = normalizedTimeline.map((point) =>
                typeof point.messages === "number"
                    ? point.messages
                    : typeof point.total_messages === "number"
                        ? point.total_messages
                        : typeof point.count === "number"
                            ? point.count
                            : 0,
            );
            const data = {
                labels,
                datasets: [
                    {
                        label: "Conversations",
                        data: conversations,
                        borderColor: "#7c3aed",
                        backgroundColor: "rgba(139, 92, 246, 0.18)",
                        tension: 0.4,
                        fill: true,
                        borderWidth: 2,
                        pointRadius: 0,
                    },
                    {
                        label: "Messages",
                        data: messages,
                        borderColor: "#93a5ff",
                        backgroundColor: "rgba(147, 165, 255, 0.18)",
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.4,
                    },
                ],
            };
            const options = {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: {
                            autoSkip: true,
                            maxTicksLimit: 6,
                        },
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: "rgba(148, 163, 184, 0.3)" },
                        ticks: {
                            precision: 0,
                        },
                    },
                },
                plugins: {
                    legend: {
                        display: true,
                        position: "bottom",
                    },
                    tooltip: {
                        intersect: false,
                        mode: "index",
                    },
                },
            };
            if (statsActivityChart && statsActivityChart.canvas !== canvas) {
                statsActivityChart.destroy();
                statsActivityChart = null;
            }
            if (statsActivityChart) {
                statsActivityChart.data = data;
                statsActivityChart.options = options;
                statsActivityChart.update();
            } else {
                statsActivityChart = new ChartLib(ctx, {
                    type: "line",
                    data,
                    options,
                });
            }
        })
        .catch((error) => {
            console.error("Statistics chart rendering failed", error);
        });
}

function normalizeStatisticsTimeline(timeline) {
    if (Array.isArray(timeline) && timeline.length) {
        return timeline;
    }
    const overviewTimeline = state.snapshot?.kpis?.timeline;
    if (Array.isArray(overviewTimeline) && overviewTimeline.length) {
        return overviewTimeline.map((point) => ({
            label: point.label || point.date || "",
            date: point.date || point.label || "",
            conversations: typeof point.count === "number" ? point.count : 0,
            messages: typeof point.total_messages === "number" ? point.total_messages : point.count || 0,
        }));
    }
    return [];
}

function renderStatsRestaurantBreakdown(breakdown) {
    const list = document.getElementById("stats-restaurant-breakdown");
    if (!list) {
        return;
    }
    list.innerHTML = "";
    const entries = Array.isArray(breakdown) ? breakdown.filter((entry) => (entry.count || 0) > 0) : [];
    if (!entries.length) {
        const empty = document.createElement("li");
        empty.className = "muted";
        empty.textContent = state.statistics.selectedRestaurants.length
            ? "Aucune conversation sur cette période."
            : "Sélectionnez au moins un restaurant.";
        list.appendChild(empty);
        return;
    }
    const totalCount = entries.reduce((acc, entry) => acc + (entry.count || 0), 0) || 1;
    entries.forEach((entry) => {
        const row = document.createElement("li");
        const meta = document.createElement("div");
        meta.className = "stats-breakdown-row";
        const name = document.createElement("span");
        name.textContent = entry.name || "Restaurant";
        const value = document.createElement("strong");
        value.textContent = `${formatNumber(entry.count || 0)} conv.`;
        meta.append(name, value);

        const bar = document.createElement("div");
        bar.className = "stats-breakdown-bar";
        const fill = document.createElement("span");
        const share = typeof entry.share === "number"
            ? entry.share
            : Math.round(((entry.count || 0) / totalCount) * 1000) / 10;
        fill.style.width = `${Math.max(0, share)}%`;
        bar.appendChild(fill);

        const shareLabel = document.createElement("span");
        shareLabel.className = "stats-breakdown-share";
        shareLabel.textContent = `${share.toFixed(1)}%`;

        row.append(meta, bar, shareLabel);
        list.appendChild(row);
    });
}

function renderTopQuestions(topQuestions) {
    const list = document.getElementById("stats-top-questions");
    if (!list) {
        return;
    }
    list.innerHTML = "";
    const entries = Array.isArray(topQuestions) && topQuestions.length ? topQuestions : null;
    if (!entries) {
        const row = document.createElement("li");
        row.textContent = "Pas encore de conversations analysées.";
        list.appendChild(row);
        return;
    }
    entries.forEach((question) => {
        const row = document.createElement("li");
        const label = question.label || "Autres";
        row.textContent = `${label} — ${formatNumber(question.count || 0)}`;
        list.appendChild(row);
    });
}

function renderDietBreakdown(breakdown) {
    const container = document.getElementById("stats-diet-breakdown");
    if (!container) {
        return;
    }
    container.innerHTML = "";
    const entries = Array.isArray(breakdown) && breakdown.length ? breakdown : null;
    if (!entries) {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = "Aucune donnée diététique disponible.";
        container.appendChild(empty);
        return;
    }
    const total = entries.reduce((acc, entry) => acc + (entry.count || 0), 0) || 1;
    entries.forEach((entry) => {
        const segment = document.createElement("div");
        segment.className = "diet-segment";
        const percent = Math.round(((entry.count || 0) / total) * 100);
        segment.dataset.value = `${percent}%`;
        segment.textContent = entry.label || "";
        segment.style.setProperty("--value", `${percent}%`);
        container.appendChild(segment);
    });
}

// --- Statistics UI Binding ---

export function bindStatisticsUI() {
    ensureStatsRangeDefaults();
    const rangeButtons = document.querySelectorAll("[data-stats-range]");
    rangeButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const days = parseInt(button.dataset.statsRange || "", 10);
            if (!Number.isFinite(days)) {
                return;
            }
            setStatsRangeFromPreset(days);
        });
    });

    const applyButton = document.getElementById("stats-apply-range");
    if (applyButton) {
        applyButton.addEventListener("click", (event) => {
            event.preventDefault();
            handleStatsRangeApply();
        });
    }

    const toggle = document.getElementById("stats-restaurant-toggle");
    if (toggle) {
        toggle.addEventListener("click", () => {
            const panel = document.getElementById("stats-restaurant-panel");
            if (!panel) {
                return;
            }
            if (panel.hasAttribute("hidden")) {
                openStatsRestaurantPanel(panel, toggle);
            } else {
                closeStatsRestaurantPanel(panel, toggle);
            }
        });
    }

    const panel = document.getElementById("stats-restaurant-panel");
    if (panel) {
        panel.addEventListener("click", (event) => {
            const actionBtn = event.target.closest("[data-action]");
            if (actionBtn) {
                handleStatsPanelAction(actionBtn.dataset.action);
                event.preventDefault();
                return;
            }
            const option = event.target.closest("li[data-value]");
            if (option) {
                const value = option.dataset.value;
                toggleStatsRestaurantSelection(value);
            }
        });
    }

    const searchInput = document.getElementById("stats-restaurant-search");
    if (searchInput) {
        searchInput.addEventListener("input", () => {
            filterStatsRestaurantOptions(searchInput.value || "");
        });
    }

    document.addEventListener("click", (event) => {
        const panelEl = document.getElementById("stats-restaurant-panel");
        const toggleBtn = document.getElementById("stats-restaurant-toggle");
        if (!panelEl || !toggleBtn) {
            return;
        }
        if (panelEl.hasAttribute("hidden")) {
            return;
        }
        if (panelEl.contains(event.target) || toggleBtn.contains(event.target)) {
            return;
        }
        closeStatsRestaurantPanel(panelEl, toggleBtn);
    });
}

function ensureStatsRangeDefaults() {
    const stats = state.statistics;
    if (!stats.startDate || !stats.endDate) {
        const today = new Date();
        const start = new Date(today.getTime());
        start.setDate(today.getDate() - 6);
        stats.startDate = formatInputDate(start);
        stats.endDate = formatInputDate(today);
        stats.activeRangePreset = 7;
    }
    syncStatsRangeInputs();
    highlightStatsPreset();
}

function syncStatsRangeInputs() {
    const startInput = document.getElementById("stats-start-date");
    const endInput = document.getElementById("stats-end-date");
    if (startInput && state.statistics.startDate) {
        startInput.value = state.statistics.startDate;
    }
    if (endInput && state.statistics.endDate) {
        endInput.value = state.statistics.endDate;
    }
}

function highlightStatsPreset() {
    const preset = state.statistics.activeRangePreset;
    const rangeButtons = document.querySelectorAll("[data-stats-range]");
    rangeButtons.forEach((button) => {
        const value = parseInt(button.dataset.statsRange || "", 10);
        if (preset && value === preset) {
            button.classList.add("active");
        } else {
            button.classList.remove("active");
        }
    });
}

function setStatsRangeFromPreset(days) {
    const today = new Date();
    const start = new Date(today.getTime());
    start.setDate(today.getDate() - (days - 1));
    state.statistics.startDate = formatInputDate(start);
    state.statistics.endDate = formatInputDate(today);
    state.statistics.activeRangePreset = days;
    const messageEl = document.getElementById("stats-range-message");
    if (messageEl) {
        messageEl.textContent = "";
    }
    syncStatsRangeInputs();
    highlightStatsPreset();
    fetchStatisticsData();
}

function handleStatsRangeApply() {
    const startInput = document.getElementById("stats-start-date");
    const endInput = document.getElementById("stats-end-date");
    const messageEl = document.getElementById("stats-range-message");
    if (!startInput || !endInput) {
        return;
    }
    const startValue = startInput.value;
    const endValue = endInput.value;
    const error = validateRange(startValue, endValue);
    if (messageEl) {
        messageEl.textContent = error ? error.message : "";
    }
    if (error) {
        return;
    }
    state.statistics.startDate = startValue;
    state.statistics.endDate = endValue;
    state.statistics.activeRangePreset = null;
    highlightStatsPreset();
    fetchStatisticsData();
}

function handleStatsPanelAction(action) {
    if (!action) {
        return;
    }
    const available = state.statistics.availableRestaurants || [];
    if (action === "select-all") {
        state.statistics.selectedRestaurants = available.map((entry) => entry.id);
        renderStatsRestaurantOptions(available);
        updateStatsSelectionSummary();
        fetchStatisticsData();
        return;
    }
    if (action === "clear-all") {
        state.statistics.selectedRestaurants = [];
        renderStatsRestaurantOptions(available);
        updateStatsSelectionSummary();
    }
}

function toggleStatsRestaurantSelection(restaurantId) {
    if (!restaurantId) {
        return;
    }
    const current = state.statistics.selectedRestaurants || [];
    const index = current.indexOf(restaurantId);
    if (index === -1) {
        current.push(restaurantId);
    } else {
        current.splice(index, 1);
    }
    state.statistics.selectedRestaurants = current;
    const available = state.statistics.availableRestaurants || [];
    renderStatsRestaurantOptions(available);
    updateStatsSelectionSummary();
    if (state.statistics.selectedRestaurants.length > 0) {
        fetchStatisticsData();
    }
}

function renderStatsRestaurantOptions(restaurants) {
    const list = document.getElementById("stats-restaurant-options");
    if (!list) {
        return;
    }
    list.innerHTML = "";
    if (!restaurants || !restaurants.length) {
        const empty = document.createElement("li");
        empty.className = "muted";
        empty.textContent = "Aucun restaurant disponible.";
        list.appendChild(empty);
        return;
    }
    const selection = state.statistics.selectedRestaurants || [];
    restaurants.forEach((restaurant) => {
        const li = document.createElement("li");
        li.dataset.value = restaurant.id;
        li.setAttribute("role", "option");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selection.includes(restaurant.id);
        checkbox.tabIndex = -1;
        const label = document.createElement("span");
        label.textContent = restaurant.name || "Restaurant";
        li.append(checkbox, label);
        li.setAttribute("aria-selected", checkbox.checked ? "true" : "false");
        list.appendChild(li);
    });
}

function updateStatsSelectionSummary() {
    const summary = document.getElementById("stats-selected-summary");
    const hint = document.getElementById("stats-selection-hint");
    const headerLabel = document.getElementById("statistics-selection-label");
    const available = state.statistics.availableRestaurants || [];
    const selected = state.statistics.selectedRestaurants || [];
    const allSelected = selected.length > 0 && selected.length === available.length;
    let label = "Tous les restaurants";
    if (!selected.length) {
        label = "Sélectionnez des restaurants";
    } else if (!allSelected) {
        label = selected.length === 1 ? "1 restaurant" : `${selected.length} restaurants`;
    }
    if (summary) {
        summary.textContent = label;
    }
    if (hint) {
        if (!selected.length) {
            hint.textContent = "Sélectionnez au moins un établissement";
        } else if (allSelected) {
            hint.textContent = "Affichage global";
        } else {
            hint.textContent = `${selected.length} établissement(s) comparé(s)`;
        }
    }
    if (headerLabel) {
        if (!selected.length) {
            headerLabel.textContent = "Aucun établissement sélectionné";
        } else if (selected.length === 1) {
            const names = buildStatsSelectionNames(selected);
            headerLabel.textContent = names[0];
        } else {
            headerLabel.textContent = label;
        }
    }
}

function buildStatsSelectionNames(ids) {
    const available = state.statistics.availableRestaurants || [];
    const mapping = available.reduce((acc, entry) => {
        acc[entry.id] = entry.name;
        return acc;
    }, {});
    return ids.map((id) => mapping[id] || "Restaurant");
}

function filterStatsRestaurantOptions(query) {
    const list = document.getElementById("stats-restaurant-options");
    if (!list) {
        return;
    }
    const normalized = (query || "").trim().toLowerCase();
    const entries = list.querySelectorAll("li[data-value]");
    entries.forEach((entry) => {
        const label = entry.textContent || "";
        const matches = !normalized || label.toLowerCase().includes(normalized);
        entry.hidden = !matches;
    });
}

function openStatsRestaurantPanel(panel, toggle) {
    panel.removeAttribute("hidden");
    toggle.setAttribute("aria-expanded", "true");
}

function closeStatsRestaurantPanel(panel, toggle) {
    panel.setAttribute("hidden", "true");
    toggle.setAttribute("aria-expanded", "false");
}

export function syncStatsRestaurantsFromSnapshot(restaurants) {
    const list = Array.isArray(restaurants) ? restaurants : [];
    const normalized = list
        .map((restaurant) => ({
            id: restaurant && restaurant.id ? String(restaurant.id) : null,
            name: restaurant.display_name || restaurant.name || "Restaurant",
        }))
        .filter((entry) => Boolean(entry.id));
    state.statistics.availableRestaurants = normalized;
    const currentSelection = state.statistics.selectedRestaurants || [];
    const validatedSelection = currentSelection.filter((id) => normalized.some((entry) => entry.id === id));
    if (!state.statistics.hasInitialized && !validatedSelection.length) {
        state.statistics.selectedRestaurants = normalized.map((entry) => entry.id);
    } else {
        state.statistics.selectedRestaurants = validatedSelection;
        if (!state.statistics.selectedRestaurants.length && normalized.length) {
            state.statistics.selectedRestaurants = normalized.map((entry) => entry.id);
        }
    }
    renderStatsRestaurantOptions(normalized);
    updateStatsSelectionSummary();
}

function formatInputDate(date) {
    if (!date) return "";
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().split("T")[0];
}

function validateRange(start, end) {
    if (!start || !end) {
        return { message: "Veuillez sélectionner deux dates.", type: "error" };
    }
    const s = new Date(start);
    const e = new Date(end);
    if (s > e) {
        return { message: "La date de début doit être antérieure à la fin.", type: "error" };
    }
    return null;
}

// Placeholder for fetchStatisticsData - needs to be implemented or imported
// It likely calls an API and then renderStatistics
// I'll add a placeholder or import it if I extracted it to api.js?
// No, api.js has generic calls.
// fetchStatisticsData logic was in dashboard.js.
// I need to extract it too.
// It was around line 2650 (I saw it in previous view).
// I'll add it here.

export async function fetchStatisticsData() {
    if (state.statistics.isFetching) {
        return;
    }
    const { startDate, endDate, selectedRestaurants } = state.statistics;
    if (!selectedRestaurants.length) {
        renderStatistics(null);
        return;
    }
    state.statistics.isFetching = true;
    try {
        const token = await import("../core/auth.js").then(m => m.getAccessToken());
        const params = new URLSearchParams();
        if (startDate) params.append("start_date", startDate);
        if (endDate) params.append("end_date", endDate);
        selectedRestaurants.forEach(id => params.append("restaurant_id", id));

        const response = await fetch(`/api/dashboard/statistics?${params.toString()}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
            throw new Error("Erreur lors de la récupération des statistiques.");
        }
        const data = await response.json();
        console.log("[Statistics] Fetched data:", data);
        renderStatistics(data.statistics);
    } catch (error) {
        console.error("Statistics fetch failed", error);
        // showToast(error.message || "Impossible de charger les statistiques.");
        document.dispatchEvent(new CustomEvent('showToast', { detail: { message: error.message || "Impossible de charger les statistiques." } }));
        setTextContent("statistics-range-label", formatRangeText({ start: startDate, end: endDate }));
    } finally {
        state.statistics.isFetching = false;
    }
}

function setTextContent(id, value) {
    const target = document.getElementById(id);
    if (!target) {
        return;
    }
    if (value === null || value === undefined || value === "") {
        target.textContent = "—";
        return;
    }
    target.textContent = value;
}

function updateBusiestSections(busiest) {
    // Duplicate of overview.js function to avoid circular dependency
    const entries = Array.isArray(busiest) && busiest.length ? busiest : null;

    const highlight = document.getElementById("overview-top-restaurant");
    if (highlight) {
        if (!entries) {
            highlight.textContent = "—";
        } else {
            const top = entries[0];
            const name = top?.name || "Restaurant";
            const count = typeof top?.count === "number" ? formatNumber(top.count) : "—";
            highlight.textContent = `${name} (${count})`;
        }
    }

    const list = document.getElementById("stats-busiest-list");
    if (!list) {
        return;
    }
    list.innerHTML = "";
    if (!entries) {
        const row = document.createElement("li");
        row.textContent = "Aucune conversation suivie pour le moment.";
        list.appendChild(row);
        return;
    }
    entries.forEach((entry) => {
        const row = document.createElement("li");
        const content = document.createElement("div");
        const name = document.createElement("p");
        name.className = "busiest-name";
        name.textContent = entry.name || "Restaurant";
        const meta = document.createElement("p");
        meta.className = "busiest-meta";
        meta.textContent = `${formatNumber(entry.count || 0)} conversations`;
        content.append(name, meta);

        const value = document.createElement("span");
        value.className = "busiest-count";
        value.textContent = formatNumber(entry.count || 0);

        row.append(content, value);
        list.appendChild(row);
    });
}
