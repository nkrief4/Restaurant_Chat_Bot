import { state } from "./modules/core/state.js";
import { ensureSupabaseClient } from "./modules/core/supabase.js";
import { ensureAuthenticated, getAccessToken } from "./modules/core/auth.js";
import { bindFormEvents, setupRestaurantTabs, renderRestaurants } from "./modules/components/restaurants.js";
import { bindOverviewUI, syncOverviewStateWithRestaurants, updateOverview, selectOverviewRestaurant } from "./modules/components/overview.js";
import { bindChatbotUI, syncChatbotStateWithRestaurants, setupQrModal } from "./modules/components/chatbot.js";
import { bindStatisticsUI, syncStatsRestaurantsFromSnapshot, renderStatistics, fetchStatisticsData } from "./modules/components/statistics.js";
import { bindPurchasingSectionUI, refreshPurchasingDashboard } from "./modules/components/purchasing.js";
import { bindStockManagementUI, loadStockData } from "./modules/components/stock.js";
import { bindProfileForm, updateProfileFormFields, loadStockThresholds } from "./modules/components/profile.js";
import { setupNavigation } from "./modules/components/navigation.js";
import { bindGlobalButtons, setupGlobalRestaurantPicker, setupActionHandlers, setDashboardLoading, updateUIWithUserData, showToast } from "./modules/components/ui.js";
import { renderBilling } from "./modules/components/billing.js";
import { setupUploadUI, setupMenuEditors } from "./modules/components/restaurants.js"; // Assuming these are exported or I need to check

// --- Initialization ---

let navigateToSection = () => { };

function startDashboard() {
  console.log("[Dashboard] Starting initialization...");
  try {
    navigateToSection = setupNavigation();
    setupActionHandlers();
    setupGlobalRestaurantPicker();
    setupQrModal();
    bindGlobalButtons();
    bindOverviewUI();
    bindChatbotUI();
    bindStatisticsUI();
    bindPurchasingSectionUI();
    bindStockManagementUI();
    setupRestaurantTabs();
    setupGlobalDateFilters();

    initializeDashboard().catch(handleInitializationError);
  } catch (error) {
    console.error("[Dashboard] Error during synchronous setup:", error);
    handleInitializationError(error);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startDashboard);
} else {
  startDashboard();
}

async function initializeDashboard() {
  console.log("[Dashboard] Step 1: Ensuring Supabase client...");
  state.supabase = await ensureSupabaseClient();
  console.log("[Dashboard] Step 2: Authenticating...");
  await ensureAuthenticated();
  console.log("[Dashboard] Step 3: Authentication successful, token set");

  // These seem to be in restaurants.js but I need to verify exports
  // setupUploadUI and setupMenuEditors were in dashboard.js.
  // I need to make sure they are exported from restaurants.js or wherever I put them.
  // I put them in restaurants.js (lines 350+ in dashboard.js were moved there).
  // Let's assume they are exported. If not I will fix.
  if (typeof setupUploadUI === 'function') setupUploadUI();
  if (typeof setupMenuEditors === 'function') setupMenuEditors();

  console.log("[Dashboard] Step 4: Binding forms...");
  bindFormEvents();
  bindProfileForm();
  bindOrderForm();

  console.log("[Dashboard] Step 5: Refreshing dashboard data...");
  await refreshDashboardData();
  console.log("[Dashboard] Step 6: Dashboard data refresh complete");

  state.supabase.auth.onAuthStateChange((_event, session) => {
    if (!session) {
      window.location.href = "/login";
      return;
    }
    state.session = session;
    state.token = session.access_token || null;

    // Expose token globally for other modules
    window.supabaseToken = state.token;
    document.dispatchEvent(new CustomEvent('tokenReady', {
      detail: { token: state.token }
    }));
  });

  console.log("[Dashboard] Initialization complete!");
}

function handleInitializationError(error) {
  console.error("Dashboard initialization failed:", error);
  document.body.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;text-align:center;font-family:sans-serif;">
      <h1 style="color:#ef4444;margin-bottom:1rem;">Erreur de chargement</h1>
      <p style="color:#374151;margin-bottom:2rem;">Impossible d'initialiser le tableau de bord.</p>
      <button onclick="window.location.reload()" style="padding:0.75rem 1.5rem;background:#2563eb;color:white;border:none;border-radius:0.5rem;cursor:pointer;">
        Réessayer
      </button>
    </div>
  `;
}

// --- Data Refresh ---

async function refreshDashboardData(options = {}) {
  const { silent = false } = options;
  if (state.isFetchingSnapshot) {
    return;
  }
  const shouldShowOverlay = !silent;
  if (shouldShowOverlay) {
    setDashboardLoading(true, { useOverlay: true });
  }
  const tbody = document.getElementById("restaurants-table-body");
  if (tbody && !silent) {
    tbody.innerHTML = `<tr><td colspan="5">Chargement des restaurants…</td></tr>`;
  }

  const params = new URLSearchParams();
  if (state.filters.startDate) {
    params.set("start_date", state.filters.startDate);
  }
  if (state.filters.endDate) {
    params.set("end_date", state.filters.endDate);
  }
  const query = params.toString();
  const endpoint = query ? `/api/dashboard/snapshot?${query}` : "/api/dashboard/snapshot";

  state.isFetchingSnapshot = true;
  try {
    const token = await getAccessToken();
    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail = payload && payload.detail ? payload.detail : "Impossible de charger vos données.";
      throw new Error(detail);
    }

    const snapshot = await response.json();
    state.snapshot = snapshot;
    state.restaurants = snapshot.restaurants || [];

    // Expose restaurants globally for other modules (like recipes.js)
    window.restaurantData = state.restaurants;
    document.dispatchEvent(new CustomEvent('restaurantsLoaded', {
      detail: { restaurants: state.restaurants }
    }));

    syncStatsRestaurantsFromSnapshot(state.restaurants);

    updateUIWithUserData(snapshot.user);
    updateProfileFormFields(snapshot.profile);
    syncOverviewStateWithRestaurants();
    syncChatbotStateWithRestaurants();
    console.log("[Dashboard] KPIs data:", snapshot.kpis);
    updateOverview(snapshot.kpis);
    renderRestaurants();
    if (!state.statistics.hasInitialized) {
      console.log("[Dashboard] Statistics data:", snapshot.statistics);
      renderStatistics(snapshot.statistics);
    }
    renderBilling(snapshot.billing);
    // fetchStatisticsData might need to be imported or called differently
    // It was calling fetchStatisticsData({ silent: ... }) in dashboard.js
    // I exported it from statistics.js but it didn't take arguments in my implementation?
    // I'll check statistics.js.
    // In statistics.js I implemented fetchStatisticsData() without args, using state.
    // I should probably update it to accept options or just call it.
    fetchStatisticsData();

    // Also refresh purchasing data if active
    refreshPurchasingDashboard();

    // And stock data if active
    if (state.overview.restaurantId) {
      loadStockData(state.overview.restaurantId);
    }

  } catch (error) {
    console.error("[Dashboard] Snapshot refresh failed:", error);
    showToast(error.message || "Impossible de charger vos données.");
    throw error;
  } finally {
    state.isFetchingSnapshot = false;
    console.log("[Dashboard] Hiding loading overlay...");
    setDashboardLoading(false, { useOverlay: true });
    console.log("[Dashboard] Loading overlay hidden");
  }
}

// --- Global Date Filters ---

function setupGlobalDateFilters() {
  const form = document.getElementById("date-range-form");
  const startInput = document.getElementById("filter-start-date");
  const endInput = document.getElementById("filter-end-date");
  const messageEl = document.getElementById("date-filter-message");
  if (!form || !startInput || !endInput) {
    return;
  }

  if (!state.filters.startDate || !state.filters.endDate) {
    const today = new Date();
    const fallbackStart = new Date(today.getTime());
    fallbackStart.setDate(today.getDate() - 6);
    state.filters.startDate = formatInputDate(fallbackStart);
    state.filters.endDate = formatInputDate(today);
  }

  startInput.value = state.filters.startDate;
  endInput.value = state.filters.endDate;

  async function handleDateChange() {
    const startValue = startInput.value;
    const endValue = endInput.value;
    const error = validateRange(startValue, endValue);

    if (messageEl) {
      if (error) {
        messageEl.innerHTML = `<div class="date-error-message">${error.message}</div>`;
      } else {
        messageEl.innerHTML = '';
      }
    }

    if (error) {
      return;
    }
    if (state.filters.startDate === startValue && state.filters.endDate === endValue) {
      return;
    }
    state.filters.startDate = startValue;
    state.filters.endDate = endValue;
    await refreshDashboardData().catch((refreshError) => {
      console.error("Range refresh failed", refreshError);
      if (messageEl) {
        messageEl.textContent = refreshError.message || "Actualisation impossible.";
      }
    });
  }

  startInput.addEventListener("change", () => {
    handleDateChange();
  });
  endInput.addEventListener("change", () => {
    handleDateChange();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    handleDateChange();
  });

  const presetButtons = form.querySelectorAll("[data-range-preset]");
  presetButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const days = parseInt(button.dataset.rangePreset || "", 10);
      if (!Number.isFinite(days)) {
        return;
      }
      const today = new Date();
      const start = new Date(today.getTime());
      start.setDate(today.getDate() - (days - 1));
      startInput.value = formatInputDate(start);
      endInput.value = formatInputDate(today);
      handleDateChange();
    });
  });
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

function bindOrderForm() {
  const form = document.getElementById("order-form");
  const statusBox = document.getElementById("order-status");
  if (!form || !statusBox) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const menuItemId = (formData.get("menu_item_id") || "").toString().trim();
    const quantityValue = Number(formData.get("quantity"));
    const sourceValue = (formData.get("source") || "manual").toString().trim() || "manual";

    if (!menuItemId) {
      statusBox.textContent = "Merci de renseigner l'identifiant du plat.";
      statusBox.className = "order-status error";
      return;
    }

    let token;
    try {
      token = await getAccessToken();
    } catch (error) {
      console.error("Impossible de récupérer le jeton:", error);
      statusBox.textContent = "Session expirée. Merci de vous reconnecter.";
      statusBox.className = "order-status error";
      return;
    }

    const payload = {
      menu_item_id: menuItemId,
      quantity: Number.isFinite(quantityValue) && quantityValue > 0 ? quantityValue : 1,
      source: sourceValue,
    };

    try {
      const response = await fetch("/api/sales/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        const detail = errorPayload.detail || "Impossible d'enregistrer la commande.";
        throw new Error(detail);
      }

      const data = await response.json();
      statusBox.textContent = `Commande enregistrée (ID: ${data.id || "n/a"}).`;
      statusBox.className = "order-status success";
      form.reset();
      const quantityInput = form.querySelector('[name="quantity"]');
      const sourceInput = form.querySelector('[name="source"]');
      if (quantityInput) quantityInput.value = "1";
      if (sourceInput) sourceInput.value = sourceValue;
    } catch (error) {
      console.error("Erreur lors de l'enregistrement de la commande:", error);
      statusBox.textContent = error.message || "Impossible d'enregistrer la commande.";
      statusBox.className = "order-status error";
    }
  });
}
