
import { state } from "../core/state.js";
import { OVERVIEW_HISTORY_LIMIT } from "../core/constants.js";
import { formatNumber, formatRangeText, escapeHtml, formatChatbotMessage } from "../utils/format.js";
import { startEditRestaurant, countCategories } from "./restaurants.js";
import { goToRestaurantManagement } from "./restaurants.js"; // Need to export this from restaurants.js
import { getAccessToken } from "../core/auth.js";

// --- Overview Logic ---

let overviewConversationChart = null;
let overviewFetchToken = 0;
let overviewLoadingState = false;

export function bindOverviewUI() {
    const chatForm = document.getElementById("overview-chat-form");
    if (chatForm) {
        chatForm.addEventListener("submit", handleOverviewChatSubmit);
    }
}
let chartJsReadyPromise = null;

export function syncOverviewStateWithRestaurants() {
    renderOverviewRestaurantCards();
    populateGlobalRestaurantSelect();
    const restaurants = Array.isArray(state.restaurants) ? state.restaurants : [];

    if (!restaurants.length) {
        state.overview.hasManualSelection = false;
        persistActiveRestaurantId(null);
        selectOverviewRestaurant(null, { manual: false });
        updateOverviewChatState();
        renderOverviewChatMessages();
        return;
    }

    const current = restaurants.find((entry) => entry.id === state.overview.restaurantId);
    if (current) {
        state.overview.restaurantName = current.display_name || current.name || state.overview.restaurantName;
        updateOverviewChatState();
        renderOverviewChatMessages();
        highlightOverviewSelection();
        return;
    }

    if (state.overview.hasManualSelection) {
        selectOverviewRestaurant(null, { manual: false });
    } else {
        const fallback = restaurants[0];
        if (fallback && fallback.id) {
            selectOverviewRestaurant(fallback.id, { manual: false });
        } else {
            selectOverviewRestaurant(null, { manual: false });
        }
    }
}

export function renderOverviewRestaurantCards() {
    const container = document.getElementById("overview-restaurant-cards");
    if (!container) {
        return;
    }

    container.innerHTML = "";
    const restaurants = Array.isArray(state.restaurants) ? state.restaurants : [];
    if (!restaurants.length) {
        const empty = document.createElement("p");
        empty.className = "muted empty-state";
        empty.textContent = "Ajoutez un restaurant pour commencer.";
        container.appendChild(empty);
        highlightOverviewSelection();
        return;
    }

    const fragment = document.createDocumentFragment();
    restaurants.forEach((restaurant) => {
        const card = document.createElement("article");
        card.className = "overview-restaurant-card";
        card.dataset.restaurantId = restaurant.id || "";
        card.setAttribute("role", "button");
        card.tabIndex = 0;

        const title = document.createElement("h4");
        title.textContent = restaurant.display_name || "Sans nom";

        const slugMeta = document.createElement("p");
        slugMeta.className = "card-meta";
        // slugMeta.textContent = restaurant.slug || "—"; // Original code didn't set textContent for slugMeta?
        // Checking original code:
        // 3441:       const slugMeta = document.createElement("p");
        // 3442:       slugMeta.className = "card-meta";
        // It seems empty in original code? Wait.
        // Ah, lines 3441-3442. It creates it but doesn't set content?
        // Let's check if I missed something.
        // No, it seems empty. Maybe it was intended to show slug but missed.
        // I'll leave it empty to match original behavior or check if I missed a line.
        // Actually, looking at line 3441, it just creates it.
        // Maybe it's a spacer?

        const menuMeta = document.createElement("p");
        menuMeta.className = "card-meta";
        const categories = countCategories(restaurant.menu_document);
        menuMeta.textContent = categories
            ? `${categories} section${categories > 1 ? "s" : ""} de menu`
            : "Menu non importé";

        const actions = document.createElement("div");
        actions.className = "restaurant-card-actions";

        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "ghost-btn";
        editBtn.textContent = "Configurer";
        editBtn.addEventListener("click", (event) => {
            event.preventDefault();
            if (restaurant.id) {
                startEditRestaurant(restaurant.id);
                goToRestaurantManagement("edit");
            }
        });

        const testerBtn = document.createElement("button");
        testerBtn.type = "button";
        testerBtn.className = "secondary-btn";
        testerBtn.textContent = "Tester";
        testerBtn.dataset.openChat = "true";
        testerBtn.dataset.restaurantId = restaurant.id ? String(restaurant.id) : "";
        testerBtn.dataset.restaurantName = restaurant.display_name || restaurant.name || "";

        actions.append(editBtn, testerBtn);

        card.addEventListener("click", (event) => {
            if (event.target.closest("button")) {
                return;
            }
            if (restaurant.id) {
                selectOverviewRestaurant(restaurant.id, { manual: true });
            }
        });

        card.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                if (event.target.closest("button")) {
                    return;
                }
                event.preventDefault();
                if (restaurant.id) {
                    selectOverviewRestaurant(restaurant.id, { manual: true });
                }
            }
        });

        card.append(title, slugMeta, menuMeta, actions);
        fragment.appendChild(card);
    });

    container.appendChild(fragment);
    highlightOverviewSelection();
}

function highlightOverviewSelection() {
    const container = document.getElementById("overview-restaurant-cards");
    if (!container) {
        return;
    }
    const cards = container.querySelectorAll(".overview-restaurant-card");
    const targetId = state.overview.restaurantId ? String(state.overview.restaurantId) : "";
    cards.forEach((card) => {
        const isSelected = card.dataset.restaurantId === targetId && targetId !== "";
        card.classList.toggle("selected", isSelected);
        card.setAttribute("aria-pressed", isSelected ? "true" : "false");
    });
}

function populateGlobalRestaurantSelect() {
    const select = document.getElementById("global-restaurant-select");
    if (!select) {
        return;
    }

    const restaurants = Array.isArray(state.restaurants) ? state.restaurants : [];
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = restaurants.length
        ? "Sélectionnez un restaurant"
        : "Aucun restaurant disponible";

    select.innerHTML = "";
    select.appendChild(placeholder);

    restaurants.forEach((restaurant) => {
        const option = document.createElement("option");
        option.value = restaurant.id ? String(restaurant.id) : "";
        option.textContent = restaurant.display_name || restaurant.name || "Sans nom";
        select.appendChild(option);
    });

    if (state.overview.restaurantId) {
        select.value = String(state.overview.restaurantId);
    } else {
        select.value = "";
    }
    select.disabled = !restaurants.length;
}

export function selectOverviewRestaurant(restaurantId, options = {}) {
    const { manual = false } = options;
    const select = document.getElementById("global-restaurant-select");
    const normalizedId = restaurantId ? String(restaurantId) : null;

    if (!normalizedId) {
        if (select) {
            select.value = "";
        }
        const hadSelection = Boolean(state.overview.restaurantId);
        state.overview.restaurantId = null;
        state.overview.restaurantName = "";
        persistActiveRestaurantId(null);
        state.overview.hasManualSelection = manual ? true : false;
        if (hadSelection) {
            state.overview.history = [];
            clearOverviewChatStatus();
            renderOverviewChatMessages();
        }
        updateOverviewChatState();
        highlightOverviewSelection();
        updateActiveRestaurantIndicators();

        // Clear global for legacy scripts
        window.activeRestaurant = null;

        // Dispatch event for other components to react
        document.dispatchEvent(new CustomEvent('activeRestaurantChange', {
            detail: { id: null, name: "" }
        }));

        // Trigger data refresh
        document.dispatchEvent(new CustomEvent('dashboard:refreshStockAndPurchasing', { detail: { restaurantId: null } }));
        refreshOverviewMetrics(null).catch((error) => {
            console.warn("[Overview] Unable to reset metrics:", error);
        });
        return;
    }

    const record = state.restaurants.find((restaurant) => restaurant && String(restaurant.id) === normalizedId);
    if (!record) {
        // Handle invalid ID same as null
        if (select) select.value = "";
        state.overview.restaurantId = null;
        state.overview.restaurantName = "";
        persistActiveRestaurantId(null);
        state.overview.hasManualSelection = manual ? true : false;
        updateOverviewChatState();
        highlightOverviewSelection();
        updateActiveRestaurantIndicators();

        // Clear global for legacy scripts
        window.activeRestaurant = null;

        document.dispatchEvent(new CustomEvent('activeRestaurantChange', { detail: { id: null, name: "" } }));
        document.dispatchEvent(new CustomEvent('dashboard:refreshStockAndPurchasing', { detail: { restaurantId: null } }));
        refreshOverviewMetrics(null).catch((error) => {
            console.warn("[Overview] Unable to reset metrics:", error);
        });
        return;
    }

    const previousId = state.overview.restaurantId ? String(state.overview.restaurantId) : null;
    const currentId = record.id ? String(record.id) : null;
    const changed = previousId !== currentId;

    state.overview.restaurantId = record.id;
    state.overview.restaurantName = record.display_name || record.name || "";
    persistActiveRestaurantId(record.id);
    if (manual) {
        state.overview.hasManualSelection = true;
    }
    if (changed) {
        state.overview.history = [];
        clearOverviewChatStatus();
        renderOverviewChatMessages();
    }
    if (select) {
        select.value = currentId || "";
    }
    updateOverviewChatState();
    highlightOverviewSelection();
    updateActiveRestaurantIndicators();

    if (changed) {
        // Expose for legacy scripts (recipes.js, sales.js)
        window.activeRestaurant = {
            id: record.id,
            name: record.display_name || record.name || ""
        };

        document.dispatchEvent(new CustomEvent('activeRestaurantChange', {
            detail: { id: String(record.id), name: record.display_name || record.name || "" }
        }));
        document.dispatchEvent(new CustomEvent('dashboard:refreshStockAndPurchasing', { detail: { restaurantId: record.id } }));
        refreshOverviewMetrics(record.id).catch((error) => {
            console.warn("[Overview] Unable to refresh metrics:", error);
        });
    }
}

function persistActiveRestaurantId(id) {
    if (typeof window !== "undefined" && window.localStorage) {
        if (id) {
            window.localStorage.setItem("activeRestaurantId", String(id));
        } else {
            window.localStorage.removeItem("activeRestaurantId");
        }
    }
}

function updateActiveRestaurantIndicators() {
    const activeName = state.overview.restaurantId
        ? (state.overview.restaurantName || "Restaurant sélectionné")
        : "Aucun";
    const targets = [
        "overview-active-restaurant",
        "chatbot-active-restaurant",
        "purchasing-active-restaurant",
        "stock-active-restaurant",
        "recipes-active-restaurant",
        "sales-active-restaurant",
    ];
    targets.forEach((id) => {
        const node = document.getElementById(id);
        if (node) {
            node.textContent = activeName;
        }
    });
}

// --- Overview Chat ---

function updateOverviewChatState() {
    const hasRestaurant = Boolean(state.overview.restaurantId);
    const hasOptions = Array.isArray(state.restaurants) && state.restaurants.length > 0;
    const input = document.getElementById("overview-chat-input");
    if (input) {
        input.disabled = !hasRestaurant || state.overview.isSending;
    }
    const submitBtn = document.getElementById("overview-chat-send");
    if (submitBtn) {
        submitBtn.disabled = !hasRestaurant || state.overview.isSending;
    }
    const hint = document.getElementById("overview-chat-hint");
    if (hint) {
        hint.textContent = hasRestaurant
            ? `Testez RestauBot pour ${state.overview.restaurantName || "votre restaurant"}.`
            : hasOptions
                ? "Utilisez le sélecteur global pour activer l'aperçu."
                : "Ajoutez un restaurant pour activer l'aperçu.";
    }
    if (!hasRestaurant) {
        clearOverviewChatStatus();
    }
}

function clearOverviewChatStatus() {
    const statusEl = document.getElementById("overview-chat-status");
    if (statusEl) {
        statusEl.textContent = "";
    }
}

function renderOverviewChatMessages() {
    const container = document.getElementById("overview-chat-messages");
    const empty = document.getElementById("overview-chat-empty");
    if (!container || !empty) {
        return;
    }
    container.innerHTML = "";
    const history = state.overview.history.slice(-OVERVIEW_HISTORY_LIMIT * 2);
    if (!history.length) {
        empty.hidden = false;
        return;
    }
    empty.hidden = true;
    history.forEach((entry) => {
        const bubble = buildOverviewChatMessage(entry);
        container.appendChild(bubble);
    });
    requestAnimationFrame(() => {
        if (typeof container.scrollTo === "function") {
            container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
        } else {
            container.scrollTop = container.scrollHeight;
        }
    });
}

function buildOverviewChatMessage(entry, options = {}) {
    const role = entry.role === "assistant" ? "assistant" : "user";
    const message = document.createElement("div");
    message.className = `chat-message ${role}`;

    const avatar = document.createElement("div");
    avatar.className = "chat-message-avatar";
    avatar.textContent = role === "assistant" ? "AI" : "Vous";

    const content = document.createElement("div");
    content.className = "chat-message-content";

    const author = document.createElement("p");
    author.className = "chat-message-author";
    author.textContent =
        role === "assistant"
            ? state.overview?.restaurantName || "RestauBot"
            : "Vous";

    const text = document.createElement("div");
    text.className = "chatbot-text";

    if (typeof options.renderText === "function") {
        options.renderText(text);
    } else {
        const content = entry.content || "";
        if (content) {
            // We need formatChatbotMessage. It's in chatbot.js?
            // It's better to move formatChatbotMessage to utils/format.js or duplicate/import.
            // It uses escapeHtml which is in utils/format.js.
            // I'll import it from chatbot.js if I export it, or move it to format.js.
            // formatChatbotMessage is specific to chat formatting (newlines etc).
            // I'll add it to format.js for now.
            text.innerHTML = formatChatbotMessage(content);
        }
    }

    content.append(author, text);

    if (!options.hideMeta) {
        const meta = document.createElement("small");
        meta.className = "chat-message-meta";
        meta.textContent = entry.created_at
            ? new Date(entry.created_at).toLocaleTimeString("fr-FR", {
                  hour: "2-digit",
                  minute: "2-digit",
              })
            : new Date().toLocaleTimeString("fr-FR", {
                  hour: "2-digit",
                  minute: "2-digit",
              });
        content.appendChild(meta);
    }

    message.append(avatar, content);
    return message;
}



export async function handleOverviewChatSubmit(event) {
    event.preventDefault();
    if (state.overview.isSending) {
        return;
    }
    if (!state.overview.restaurantId) {
        const statusEl = document.getElementById("overview-chat-status");
        if (statusEl) {
            statusEl.textContent = "Utilisez le sélecteur global avant d'envoyer un message.";
        }
        return;
    }

    const input = document.getElementById("overview-chat-input");
    const statusEl = document.getElementById("overview-chat-status");
    const message = (input?.value || "").trim();
    if (!message) {
        if (statusEl) {
            statusEl.textContent = "Votre message ne peut pas être vide.";
        }
        return;
    }

    const payloadHistory = buildChatPayloadHistory(state.overview.history, OVERVIEW_HISTORY_LIMIT);
    state.overview.history.push(createChatHistoryEntry("user", message));
    trimOverviewHistory();
    renderOverviewChatMessages();
    if (input) {
        input.value = "";
    }

    state.overview.isSending = true;
    updateOverviewChatState();
    showOverviewTypingIndicator();
    if (statusEl) {
        statusEl.textContent = "Envoi en cours…";
    }

    try {
        const token = await getAccessToken();
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token} `,
            },
            body: JSON.stringify({
                restaurant_id: state.overview.restaurantId,
                message,
                history: payloadHistory,
            }),
        });

        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            const detail = body && body.detail ? body.detail : null;
            throw new Error(detail || "Impossible d'obtenir une réponse.");
        }

        const reply = body.reply || "";
        if (reply) {
            state.overview.history.push(createChatHistoryEntry("assistant", reply));
            trimOverviewHistory();
            renderOverviewChatMessages();
        }
        if (statusEl) {
            statusEl.textContent = "Réponse générée.";
        }
    } catch (error) {
        console.error("Overview chat failed", error);
        if (statusEl) {
            statusEl.textContent = error.message || "Impossible d'obtenir une réponse.";
        }
    } finally {
        hideOverviewTypingIndicator();
        state.overview.isSending = false;
        updateOverviewChatState();
    }
}

function buildChatPayloadHistory(history, limit) {
    if (!Array.isArray(history) || history.length === 0) {
        return [];
    }
    const sliceLimit = limit ? -Math.abs(limit) : undefined;
    return history.slice(sliceLimit).map((entry) => ({
        role: entry.role === "assistant" ? "assistant" : "user",
        content: entry.content || "",
    }));
}

function createChatHistoryEntry(role, content) {
    return {
        role: role === "assistant" ? "assistant" : "user",
        content: content || "",
        created_at: new Date().toISOString(),
    };
}

function trimOverviewHistory() {
    const maxEntries = OVERVIEW_HISTORY_LIMIT * 2;
    if (state.overview.history.length > maxEntries) {
        state.overview.history = state.overview.history.slice(-maxEntries);
    }
}

function showOverviewTypingIndicator() {
    const typing = document.getElementById("overview-chat-typing");
    if (!typing) {
        return;
    }
    const empty = document.getElementById("overview-chat-empty");
    if (empty) {
        empty.hidden = true;
    }
    typing.hidden = false;
}

function hideOverviewTypingIndicator() {
    const typing = document.getElementById("overview-chat-typing");
    if (typing) {
        typing.hidden = true;
    }
}

// --- Overview Stats & Charts ---

export function updateOverview(kpis) {
    if (!kpis) {
        return;
    }

    const restaurantsTotal =
        typeof kpis.total_restaurants === "number" ? kpis.total_restaurants : kpis.restaurants;
    const conversationsTotal =
        typeof kpis.conversations === "number" ? kpis.conversations : kpis.conversations_last_30;
    const messagesTotal =
        typeof kpis.messages === "number" ? kpis.messages : kpis.total_messages;
    const customersTotal =
        typeof kpis.unique_customers === "number" ? kpis.unique_customers : kpis.total_users;
    const averagePerDay =
        typeof kpis.average_per_day === "number" ? kpis.average_per_day : kpis.average_conversations_per_day;
    const averageMessagesRaw =
        typeof kpis.average_messages === "number"
            ? kpis.average_messages
            : kpis.average_messages_per_conversation;

    setTextContent("kpi-restaurants", formatNumber(restaurantsTotal));
    setTextContent("kpi-conversations", formatNumber(conversationsTotal));
    setTextContent("kpi-messages", formatNumber(messagesTotal));
    setTextContent("kpi-customers", formatNumber(customersTotal));
    setTextContent("overview-average-per-day", formatNumber(averagePerDay));
    const avgMessagesLabel =
        typeof averageMessagesRaw === "number" ? averageMessagesRaw.toFixed(1) : formatNumber(averageMessagesRaw);
    setTextContent("overview-average-messages", avgMessagesLabel);
    const fallbackPlan = state.snapshot && state.snapshot.user ? state.snapshot.user.plan : null;
    setTextContent("overview-plan-name", kpis.plan || fallbackPlan || "—");
    setTextContent("overview-plan-detail", kpis.plan_detail || "");
    setTextContent("overview-range-label", kpis.range_label || formatRangeText(kpis.date_range));

    renderConversationChart(kpis.timeline);

    // Backend sends 'busiest' array directly with {restaurant_id, name, count}
    const busiestEntries = Array.isArray(kpis.busiest) ? kpis.busiest : [];
    updateBusiestSections(busiestEntries);
}

export async function refreshOverviewMetrics(restaurantId) {
    const targetId = restaurantId || state.overview.restaurantId;
    if (!targetId) {
        if (state.snapshot?.kpis) {
            updateOverview(state.snapshot.kpis);
        }
        return;
    }

    const requestToken = ++overviewFetchToken;
    setOverviewLoading(true);
    try {
        const token = await getAccessToken();
        const params = new URLSearchParams();
        params.append("restaurant_id", targetId);
        const response = await fetch(`/api/dashboard/statistics?${params.toString()}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const detail = payload?.detail || "Impossible de charger les données du restaurant.";
            throw new Error(detail);
        }
        if (requestToken !== overviewFetchToken) {
            return;
        }
        const stats = payload.statistics;
        if (!stats) {
            throw new Error("Aucune donnée disponible pour ce restaurant.");
        }
        const scopedKpis = {
            restaurants: 1,
            conversations: stats.total_conversations,
            messages: stats.total_messages,
            unique_customers: stats.total_conversations,
            plan: state.snapshot?.kpis?.plan,
            plan_detail: state.snapshot?.kpis?.plan_detail,
            timeline: stats.timeline,
            busiest: stats.busiest,
            average_per_day: stats.average_per_day,
            average_messages: stats.average_messages,
            date_range: stats.date_range,
            range_label: formatRangeText(stats.date_range),
        };
        updateOverview(scopedKpis);
    } catch (error) {
        console.error("[Overview] refreshOverviewMetrics error:", error);
        document.dispatchEvent(
            new CustomEvent("showToast", {
                detail: { message: error.message || "Impossible de charger les données du restaurant." },
            }),
        );
    } finally {
        if (requestToken === overviewFetchToken) {
            setOverviewLoading(false);
        }
    }
}

function setOverviewLoading(isLoading) {
    if (overviewLoadingState === isLoading) {
        return;
    }
    overviewLoadingState = isLoading;
    const cards = document.querySelectorAll("[data-overview-kpi]");
    cards.forEach((card) => {
        card.classList.toggle("is-loading", isLoading);
    });
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

async function ensureChartJsLibrary() {
    if (typeof window === "undefined") {
        return null;
    }
    if (typeof window.Chart !== "undefined") {
        return window.Chart;
    }
    if (chartJsReadyPromise) {
        return chartJsReadyPromise;
    }

    chartJsReadyPromise = new Promise((resolve, reject) => {
        const existingScript = document.querySelector("script[data-chartjs]") || document.querySelector("script[src*='chart.umd']");

        const attachListeners = (script) => {
            if (!script) {
                reject(new Error("CHARTJS_SCRIPT_MISSING"));
                return;
            }
            script.addEventListener(
                "load",
                () => {
                    if (typeof window.Chart !== "undefined") {
                        resolve(window.Chart);
                    } else {
                        reject(new Error("CHARTJS_UNAVAILABLE"));
                    }
                },
                { once: true },
            );
            script.addEventListener(
                "error",
                () => {
                    reject(new Error("CHARTJS_LOAD_FAILED"));
                },
                { once: true },
            );
        };

        if (existingScript) {
            attachListeners(existingScript);
            return;
        }

        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
        script.defer = true;
        script.dataset.chartjs = "true";
        document.head.appendChild(script);
        attachListeners(script);
    })
        .then((lib) => {
            return lib;
        })
        .catch((error) => {
            chartJsReadyPromise = null;
            throw error;
        });

    return chartJsReadyPromise;
}

function setConversationEmptyState(isVisible, message) {
    const emptyState = document.getElementById("overview-conversation-empty");
    if (!emptyState) {
        return;
    }
    if (isVisible) {
        emptyState.hidden = false;
        emptyState.style.display = "flex";
        emptyState.setAttribute("aria-hidden", "false");
        if (message) {
            emptyState.textContent = message;
        }
    } else {
        emptyState.hidden = true;
        emptyState.style.display = "none";
        emptyState.setAttribute("aria-hidden", "true");
    }
}

async function renderConversationChart(timeline) {
    const canvas = document.getElementById("overview-conversation-chart");
    if (!canvas) {
        return;
    }

    let ChartLib = null;
    try {
        ChartLib = await ensureChartJsLibrary();
    } catch (error) {
        console.error("Chart.js failed to load", error);
        setConversationEmptyState(true, "Graphique indisponible pour le moment.");
        return;
    }

    if (!ChartLib) {
        setConversationEmptyState(true, "Graphique indisponible.");
        return;
    }

    const entries = Array.isArray(timeline) ? timeline.filter(Boolean) : [];
    const hasData = entries.length > 0;
    setConversationEmptyState(!hasData, "Aucune donnée disponible sur cette période.");

    const labels = (hasData ? entries : Array.from({ length: 7 }, () => ({}))).map((entry, index) => {
        const rawLabel = entry.label || entry.date;
        if (rawLabel) {
            return rawLabel;
        }
        return `Jour ${index + 1} `;
    });
    const values = (hasData ? entries : Array.from({ length: labels.length }, () => ({ count: 0 }))).map((entry) => {
        if (!entry) {
            return 0;
        }
        const value = typeof entry.count === "number" ? entry.count : entry.conversations || 0;
        return Number.isFinite(value) ? value : 0;
    });

    const context = canvas.getContext("2d");
    if (!context) {
        return;
    }

    const chartData = {
        labels,
        datasets: [
            {
                label: "Conversations",
                data: values,
                backgroundColor: "rgba(139, 92, 246, 0.65)",
                hoverBackgroundColor: "rgba(139, 92, 246, 0.9)",
                borderRadius: 12,
                borderSkipped: false,
                barThickness: values.length > 30 ? 12 : undefined,
            },
        ],
    };

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
            duration: 500,
        },
        scales: {
            x: {
                grid: {
                    display: false,
                },
                ticks: {
                    maxRotation: 0,
                    minRotation: 0,
                    autoSkip: true,
                    color: "#6b7280",
                },
            },
            y: {
                beginAtZero: true,
                ticks: {
                    precision: 0,
                    color: "#6b7280",
                },
                grid: {
                    color: "rgba(15, 23, 42, 0.08)",
                    drawBorder: false,
                },
            },
        },
        plugins: {
            legend: {
                display: false,
            },
            tooltip: {
                callbacks: {
                    label(context) {
                        const value = context.raw;
                        return `${value} conversation${value > 1 ? "s" : ""} `;
                    },
                },
            },
        },
    };

    if (overviewConversationChart) {
        overviewConversationChart.data.labels = chartData.labels;
        overviewConversationChart.data.datasets[0].data = chartData.datasets[0].data;
        overviewConversationChart.update();
        setConversationEmptyState(false);
        return;
    }

    overviewConversationChart = new ChartLib(context, {
        type: "bar",
        data: chartData,
        options: chartOptions,
    });
    setConversationEmptyState(false);
}
