const appRoot = document.getElementById("purchasing-app");
const filterForm = document.getElementById("purchasing-filter-form");
const filterMessage = document.getElementById("filter-status");
const tableBody = document.getElementById("ingredients-table-body");
const tableCount = document.getElementById("table-count");
const tableRangeLabel = document.getElementById("table-range-label");
const summaryCards = {
  dishes: document.getElementById("summary-dishes"),
  critical: document.getElementById("summary-critical"),
  low: document.getElementById("summary-low"),
  ok: document.getElementById("summary-ok"),
};
const topIngredientList = document.getElementById("top-ingredients");
const topMenuItemList = document.getElementById("top-menu-items");
const orderModal = document.getElementById("order-modal");
const openModalBtn = document.getElementById("open-order-modal");
const closeModalBtn = document.getElementById("close-order-modal");
const cancelModalBtn = document.getElementById("cancel-order");
const modalBackdrop = document.querySelector("[data-close-modal]");
const orderLinesContainer = document.getElementById("order-lines");
const orderSupplierSelect = document.getElementById("order-supplier-select");
const orderForm = document.getElementById("order-form");
const orderFormMessage = document.getElementById("order-form-message");
const expectedDateInput = document.getElementById("order-expected-date");
const ingredientForm = document.getElementById("ingredient-form");
const ingredientFormMessage = document.getElementById("ingredient-form-message");
const ingredientSupplierSelect = document.getElementById("ingredient-supplier-select");
const ingredientTabButtons = document.querySelectorAll("[data-ingredient-tab]");
const ingredientAddPanel = document.getElementById("ingredient-add-panel");
const ingredientManagePanel = document.getElementById("ingredient-manage-panel");
const ingredientManageList = document.getElementById("ingredient-manage-list");
const ingredientManageMessage = document.getElementById("ingredient-manage-message");
const menuConfigSelect = document.getElementById("menu-config-select");
const recipeTableBody = document.getElementById("recipe-table-body");
const recipeStatus = document.getElementById("recipe-status");
const recipeAddForm = document.getElementById("recipe-add-form");
const recipeAddFormMessage = document.getElementById("recipe-add-form-message");
const recipeAddIngredientSelect = document.getElementById("recipe-add-ingredient-select");
const recipeAddQuantityInput = document.getElementById("recipe-add-quantity");
const salesForm = document.getElementById("sales-form");
const salesFormMessage = document.getElementById("sales-form-message");
const salesMenuSelect = document.getElementById("sales-menu-select");
const salesDateInput = document.getElementById("sales-date");
const restaurantSelect = document.getElementById("restaurant-select");
const restaurantSelectMessage = document.getElementById("restaurant-select-message");
const isEmbeddedView = detectEmbeddedView();

const state = {
  filters: {},
  recommendations: [],
  summary: null,
  suppliers: new Map(),
  supplierList: [],
  sort: { column: "status", direction: "asc" },
  supabase: null,
  token: null,
  restaurantId: null,
  menuItems: [],
  ingredientCatalog: [],
  selectedMenuItemId: null,
  activeRecipe: [],
  restaurants: [],
  isLoadingRestaurants: false,
  activeIngredientTab: "add",
};

if (isEmbeddedView) {
  const applyEmbeddedClass = () => {
    if (document.body) {
      document.body.classList.add("embedded-purchasing");
    }
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyEmbeddedClass, { once: true });
  } else {
    applyEmbeddedClass();
  }
}

const purchasingApi = (() => {
  const buildHeaders = (headers = {}, options = {}) => {
    const finalHeaders = {
      Accept: "application/json",
      ...headers,
    };
    const includeRestaurantId = options.includeRestaurantId !== false;
    const restaurantId = getRestaurantId();
    if (includeRestaurantId && restaurantId) {
      finalHeaders["X-Restaurant-Id"] = restaurantId;
    }
    if (state.token) {
      finalHeaders.Authorization = `Bearer ${state.token}`;
    }
    return finalHeaders;
  };

  const request = async (url, options = {}) => {
    const response = await fetch(url, options);
    if (!response.ok) {
      const detail = await safeReadJson(response);
      const message = detail?.detail || detail?.message || response.statusText;
      throw new Error(message || "Erreur réseau inattendue");
    }
    if (response.status === 204) {
      return null;
    }
    return response.json();
  };

  return {
    async fetchRecommendations(params) {
      const query = new URLSearchParams(params).toString();
      return request(`/api/purchasing/ingredients?${query}`, {
        headers: buildHeaders(),
      });
    },
    async fetchRestaurants() {
      return request(`/api/dashboard/restaurants`, {
        headers: buildHeaders({}, { includeRestaurantId: false }),
      });
    },
    async fetchSummary(params) {
      const query = new URLSearchParams(params).toString();
      return request(`/api/purchasing/summary?${query}`, {
        headers: buildHeaders(),
      });
    },
    async fetchIngredientCatalog() {
      return request(`/api/purchasing/ingredients/catalog`, {
        headers: buildHeaders(),
      });
    },
    async fetchMenuItems() {
      return request(`/api/purchasing/menu-items`, {
        headers: buildHeaders(),
      });
    },
    async fetchSuppliers() {
      return request(`/api/purchasing/suppliers`, {
        headers: buildHeaders(),
      });
    },
    async fetchMenuItemRecipes(menuItemId) {
      return request(`/api/purchasing/menu-items/${menuItemId}/recipes`, {
        headers: buildHeaders(),
      });
    },
    async createPurchaseOrder(payload) {
      return request(`/api/purchasing/purchase-orders`, {
        method: "POST",
        headers: buildHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
    },
    async createIngredient(payload) {
      return request(`/api/purchasing/ingredients`, {
        method: "POST",
        headers: buildHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
    },
    async updateIngredient(ingredientId, payload) {
      return request(`/api/purchasing/ingredients/${ingredientId}`, {
        method: "PUT",
        headers: buildHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
    },
    async deleteIngredient(ingredientId) {
      return request(`/api/purchasing/ingredients/${ingredientId}`, {
        method: "DELETE",
        headers: buildHeaders(),
      });
    },
    async upsertRecipe(payload) {
      return request(`/api/purchasing/recipes`, {
        method: "POST",
        headers: buildHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
    },
    async recordSale(payload) {
      return request(`/api/purchasing/sales`, {
        method: "POST",
        headers: buildHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
    },
  };
})();

initPurchasingPage();

async function initPurchasingPage() {
  if (!filterForm) {
    return;
  }

  state.restaurantId = initializeRestaurantContext();

  if (salesDateInput && !salesDateInput.value) {
    salesDateInput.value = formatDateInput(new Date());
  }

  try {
    await ensureAuthToken();
  } catch (error) {
    handleAuthFailure(error);
    return;
  }

  bindIngredientTabs();
  renderIngredientManageList();
  await loadRestaurantOptions();

  setupDefaultDates();
  filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    fetchDataAndRender();
  });
  document
    .querySelectorAll("#ingredients-table thead th[data-sort]")
    .forEach((th) => th.addEventListener("click", () => handleSortClick(th.dataset.sort)));
  openModalBtn?.addEventListener("click", () => {
    populateOrderModal(state.recommendations, state.suppliers);
    openModal();
  });
  closeModalBtn?.addEventListener("click", closeModal);
  cancelModalBtn?.addEventListener("click", closeModal);
  modalBackdrop?.addEventListener("click", closeModal);
  orderForm?.addEventListener("submit", handleOrderSubmit);
  ingredientForm?.addEventListener("submit", handleIngredientSubmit);
  recipeAddForm?.addEventListener("submit", handleRecipeAddSubmit);
  salesForm?.addEventListener("submit", handleSalesSubmit);
  menuConfigSelect?.addEventListener("change", (event) => {
    const value = event.target.value || null;
    setSelectedMenuItem(value).catch((error) => console.error(error));
  });
  salesMenuSelect?.addEventListener("change", (event) => {
    const value = event.target.value || null;
    setSelectedMenuItem(value).catch((error) => console.error(error));
  });
  recipeTableBody?.addEventListener("click", handleRecipeTableClick);
  ingredientManageList?.addEventListener("click", handleIngredientManageClick);
  restaurantSelect?.addEventListener("change", handleRestaurantSelectChange);

  if (state.restaurantId) {
    fetchDataAndRender();
  } else if (state.restaurants.length) {
    setFilterMessage(
      getEmbeddedSelectionHint(
        "Sélectionnez un restaurant pour afficher vos données de stock.",
        "Sélectionnez un restaurant depuis le dashboard pour afficher vos données de stock.",
      ),
      "info",
    );
  }
}

function handleAuthFailure(error) {
  if (error?.message === "AUTH_REQUIRED") {
    setFilterMessage("Session expirée. Merci de vous reconnecter depuis le dashboard.", "error");
  } else if (error?.message === "SUPABASE_UNAVAILABLE") {
    setFilterMessage("Supabase n'est pas initialisé sur cette page.", "error");
  } else {
    setFilterMessage("Nous n'avons pas pu vérifier votre session.", "error");
  }
}

function detectEmbeddedView() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("embedded") === "1") {
    return true;
  }
  try {
    return window.self !== window.top;
  } catch (error) {
    return true;
  }
}

function initializeRestaurantContext() {
  const params = new URLSearchParams(window.location.search);
  const queryId = params.get("restaurant_id");
  if (queryId) {
    persistRestaurantId(queryId);
    return queryId;
  }
  if (appRoot?.dataset?.restaurantId) {
    persistRestaurantId(appRoot.dataset.restaurantId);
    return appRoot.dataset.restaurantId;
  }
  if (typeof window !== "undefined" && window.localStorage) {
    const stored = window.localStorage.getItem("restaurantId");
    if (stored) {
      if (appRoot) {
        appRoot.dataset.restaurantId = stored;
      }
      return stored;
    }
  }
  return null;
}

function persistRestaurantId(restaurantId) {
  if (appRoot) {
    if (restaurantId) {
      appRoot.dataset.restaurantId = restaurantId;
    } else {
      delete appRoot.dataset.restaurantId;
    }
  }
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    if (restaurantId) {
      window.localStorage.setItem("restaurantId", restaurantId);
    } else {
      window.localStorage.removeItem("restaurantId");
    }
  } catch (error) {
    console.warn("Impossible de persister le restaurant actif", error);
  }
}

function getRestaurantId() {
  if (state.restaurantId) {
    return state.restaurantId;
  }
  if (appRoot?.dataset?.restaurantId) {
    return appRoot.dataset.restaurantId;
  }
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage.getItem("restaurantId") || "";
  }
  return "";
}

async function loadRestaurantOptions() {
  if (!restaurantSelect) {
    return;
  }
  state.isLoadingRestaurants = true;
  setRestaurantMessage("Chargement des restaurants…", "loading");
  try {
    const payload = await purchasingApi.fetchRestaurants();
    state.restaurants = normalizeRestaurantsPayload(payload);
    const currentId = state.restaurantId ? String(state.restaurantId) : null;
    const hasMatch = currentId && state.restaurants.some((restaurant) => String(restaurant.id) === currentId);
    if (!hasMatch) {
      setRestaurantContext(null, { triggerFetch: false, showMessage: false });
    }
    renderRestaurantSelect();
    if (!state.restaurantId && state.restaurants.length === 1) {
      setRestaurantContext(state.restaurants[0].id, { triggerFetch: false, showMessage: false });
    }
    if (state.restaurantId) {
      setRestaurantMessage("", "");
    } else if (!state.restaurants.length) {
      setRestaurantMessage("Ajoutez un restaurant depuis le dashboard pour utiliser cet écran.", "error");
    } else {
      setRestaurantMessage(
        getEmbeddedSelectionHint(
          "Sélectionnez un restaurant pour afficher vos données.",
          "Sélectionnez un restaurant depuis le dashboard pour afficher vos données.",
        ),
        "info",
      );
    }
  } catch (error) {
    console.error(error);
    setRestaurantMessage(error.message || "Impossible de charger vos restaurants.", "error");
  } finally {
    state.isLoadingRestaurants = false;
  }
}

function normalizeRestaurantsPayload(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload?.restaurants && Array.isArray(payload.restaurants)) {
    return payload.restaurants;
  }
  return [];
}

function renderRestaurantSelect() {
  if (!restaurantSelect) {
    return;
  }
  const placeholder = '<option value="">Sélectionnez un restaurant</option>';
  if (!state.restaurants.length) {
    restaurantSelect.innerHTML = placeholder;
    restaurantSelect.disabled = true;
    return;
  }
  const options = state.restaurants
    .map((restaurant) => {
      const label = restaurant.display_name || restaurant.name || "Restaurant";
      return `<option value="${restaurant.id}">${label}</option>`;
    })
    .join("\n");
  restaurantSelect.innerHTML = `${placeholder}${options}`;
  restaurantSelect.disabled = false;
  syncRestaurantPickerValue();
}

function syncRestaurantPickerValue() {
  if (!restaurantSelect) {
    return;
  }
  const value = state.restaurantId ? String(state.restaurantId) : "";
  if (restaurantSelect.value !== value) {
    restaurantSelect.value = value;
  }
}

function handleRestaurantSelectChange(event) {
  const target = event.target;
  if (!target) {
    return;
  }
  const value = target.value || null;
  setRestaurantContext(value, { triggerFetch: Boolean(value) });
  if (!value) {
    setFilterMessage(
      getEmbeddedSelectionHint(
        "Sélectionnez un restaurant pour afficher vos besoins d'achat.",
        "Sélectionnez un restaurant depuis le dashboard pour afficher vos besoins d'achat.",
      ),
      "info",
    );
  }
}

function setRestaurantContext(restaurantId, options = {}) {
  const { triggerFetch = false, showMessage = true, reset = true } = options;
  const normalized = restaurantId ? String(restaurantId) : null;
  const changed = state.restaurantId !== normalized;
  state.restaurantId = normalized;
  persistRestaurantId(normalized);
  if (normalized) {
    setRestaurantMessage("", "");
  } else if (showMessage && !state.isLoadingRestaurants) {
    setRestaurantMessage(
      getEmbeddedSelectionHint(
        "Sélectionnez un restaurant pour commencer.",
        "Sélectionnez un restaurant depuis le dashboard pour commencer.",
      ),
      "error",
    );
  }
  syncRestaurantPickerValue();
  if (!normalized && changed && reset) {
    renderSummaryCards(null);
    renderIngredientsTable([]);
  }
  if (!normalized) {
    renderIngredientManageList();
  }
  if (triggerFetch && normalized && changed) {
    fetchDataAndRender();
  }
}

function setRestaurantMessage(message, stateClass) {
  if (!restaurantSelectMessage) {
    return;
  }
  restaurantSelectMessage.textContent = message || "";
  restaurantSelectMessage.dataset.state = stateClass || "";
}

async function ensureAuthToken() {
  if (!state.supabase) {
    if (!window.getSupabaseClient) {
      throw new Error("SUPABASE_UNAVAILABLE");
    }
    state.supabase = await window.getSupabaseClient();
  }
  const { data, error } = await state.supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (error || !token) {
    throw new Error("AUTH_REQUIRED");
  }
  state.token = token;
  return token;
}

function setupDefaultDates() {
  const toInput = document.getElementById("filter-date-to");
  const fromInput = document.getElementById("filter-date-from");
  if (!toInput || !fromInput) return;
  const today = new Date();
  const past = new Date();
  past.setDate(today.getDate() - 6);
  toInput.value = toInput.value || formatDateInput(today);
  fromInput.value = fromInput.value || formatDateInput(past);
}

function formatDateInput(date) {
  return date.toISOString().split("T")[0];
}

async function fetchDataAndRender() {
  if (!state.restaurantId) {
    setFilterMessage(
      getEmbeddedSelectionHint(
        "Sélectionnez un restaurant pour afficher vos données.",
        "Sélectionnez un restaurant depuis le dashboard pour afficher vos données.",
      ),
      "error",
    );
    return;
  }
  const filters = readFilters();
  if (!filters) {
    return;
  }
  state.filters = filters;
  setFilterMessage("Chargement des données…", "loading");
  try {
    await ensureAuthToken();
    const [recommendations, summary, ingredientCatalog, menuItems, suppliers] = await Promise.all([
      purchasingApi.fetchRecommendations(filters),
      purchasingApi.fetchSummary(filters),
      purchasingApi.fetchIngredientCatalog(),
      purchasingApi.fetchMenuItems(),
      purchasingApi.fetchSuppliers(),
    ]);
    state.recommendations = recommendations || [];
    state.summary = summary || null;
    state.suppliers = extractSuppliersFromRecommendations(state.recommendations);
    state.ingredientCatalog = ingredientCatalog || [];
    state.menuItems = menuItems || [];
    state.supplierList = suppliers || [];
    renderReferenceSelects();
    renderMenuSelects();
    if (!state.selectedMenuItemId && state.menuItems.length) {
      state.selectedMenuItemId = state.menuItems[0].id;
    } else if (
      state.selectedMenuItemId &&
      state.menuItems.length &&
      !state.menuItems.some((item) => String(item.id) === String(state.selectedMenuItemId))
    ) {
      state.selectedMenuItemId = state.menuItems[0]?.id || null;
    }
    syncMenuSelectValues();
    await fetchRecipesForActiveMenuItem();
    renderSummaryCards(state.summary);
    renderIngredientsTable();
    renderIngredientManageList();
    setFilterMessage(
      `Dernière mise à jour : ${new Date().toLocaleTimeString("fr-FR")}`,
      "success",
    );
  } catch (error) {
    console.error(error);
    if (error?.message === "AUTH_REQUIRED") {
      handleAuthFailure(error);
      return;
    }
    renderSummaryCards(null);
    renderIngredientsTable([]);
    renderIngredientManageList();
    setFilterMessage(error.message || "Impossible de charger les données.", "error");
  }
}

function readFilters() {
  const formData = new FormData(filterForm);
  const dateFrom = formData.get("date_from");
  const dateTo = formData.get("date_to");
  if (!dateFrom || !dateTo) {
    setFilterMessage("Merci de choisir une période valide.", "error");
    return null;
  }
  if (new Date(dateFrom) > new Date(dateTo)) {
    setFilterMessage("La date de début doit précéder la date de fin.", "error");
    return null;
  }
  return {
    date_from: dateFrom,
    date_to: dateTo,
    reorder_cycle_days: formData.get("reorder_cycle_days") || 7,
    default_lead_time_days: formData.get("default_lead_time_days") || 2,
  };
}

function setFilterMessage(message, stateClass) {
  if (!filterMessage) return;
  filterMessage.textContent = message || "";
  filterMessage.dataset.state = stateClass || "";
}

function getEmbeddedSelectionHint(defaultMessage, embeddedMessage) {
  if (isEmbeddedView) {
    return embeddedMessage || "Sélectionnez un restaurant depuis le dashboard principal pour afficher vos données.";
  }
  return defaultMessage;
}

function renderSummaryCards(summary) {
  if (!summary) {
    summaryCards.dishes.textContent = "—";
    summaryCards.critical.textContent = "—";
    summaryCards.low.textContent = "—";
    summaryCards.ok.textContent = "—";
    topIngredientList.innerHTML = "<li>Aucune donnée disponible.</li>";
    topMenuItemList.innerHTML = "<li>Aucune donnée disponible.</li>";
    tableRangeLabel.textContent = "Aucune période sélectionnée";
    return;
  }
  summaryCards.dishes.textContent = formatNumber(summary.total_dishes_sold || 0);
  summaryCards.critical.textContent = summary.count_critical;
  summaryCards.low.textContent = summary.count_low;
  summaryCards.ok.textContent = summary.count_ok;
  tableRangeLabel.textContent = `Du ${summary.date_from} au ${summary.date_to}`;
  renderTopList(topIngredientList, summary.top_ingredients, (item) =>
    `${item.ingredient_name} • ${item.status} (${formatNumber(item.recommended_order_quantity)} unités)`,
  );
  renderTopList(topMenuItemList, summary.top_menu_items, (item) =>
    `${item.menu_item_name} • ${formatNumber(item.quantity_sold ?? item.quantity ?? 0)} portions`,
  );
}

function renderTopList(element, data = [], formatter) {
  if (!element) return;
  if (!data.length) {
    element.innerHTML = "<li>Aucun élément pour le moment.</li>";
    return;
  }
  element.innerHTML = data
    .map((item) => `<li>${formatter(item)}</li>`)
    .join("\n");
}

function renderIngredientsTable(recommendations = state.recommendations) {
  if (!tableBody) return;
  const sorted = sortRecommendations(recommendations);
  tableCount.textContent = `${sorted.length} ingrédients`;
  if (!sorted.length) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="8">Aucune recommandation disponible sur cette période.</td>
      </tr>`;
    return;
  }
  tableBody.innerHTML = sorted
    .map((rec) => `
      <tr>
        <td>
          <strong>${rec.ingredient_name}</strong>
          <p class="muted">${rec.unit}</p>
        </td>
        <td>${formatNumber(rec.current_stock)}</td>
        <td>${formatNumber(rec.safety_stock)}</td>
        <td>${formatNumber(rec.avg_daily_consumption)}</td>
        <td>${rec.lead_time_days}</td>
        <td>${formatNumber(rec.recommended_order_quantity)}</td>
        <td>
          <span class="status-pill ${statusClass(rec.status)}">${rec.status}</span>
        </td>
        <td>${rec.default_supplier?.name || "—"}</td>
      </tr>
    `)
    .join("\n");
}

function sortRecommendations(recommendations) {
  if (!recommendations?.length) return [];
  const { column, direction } = state.sort;
  const sorted = [...recommendations];
  sorted.sort((a, b) => {
    const valueA = a[column];
    const valueB = b[column];
    if (typeof valueA === "number" && typeof valueB === "number") {
      return direction === "asc" ? valueA - valueB : valueB - valueA;
    }
    const textA = String(valueA || "").toLowerCase();
    const textB = String(valueB || "").toLowerCase();
    if (textA < textB) return direction === "asc" ? -1 : 1;
    if (textA > textB) return direction === "asc" ? 1 : -1;
    return 0;
  });
  return sorted;
}

function handleSortClick(column) {
  if (!column) return;
  if (state.sort.column === column) {
    state.sort.direction = state.sort.direction === "asc" ? "desc" : "asc";
  } else {
    state.sort.column = column;
    state.sort.direction = "asc";
  }
  renderIngredientsTable();
}

function statusClass(status) {
  switch ((status || "").toUpperCase()) {
    case "CRITICAL":
      return "status-critical";
    case "LOW":
      return "status-low";
    case "OK":
      return "status-ok";
    default:
      return "status-idle";
  }
}

function formatNumber(value) {
  const number = Number(value) || 0;
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(number);
}

function extractSuppliersFromRecommendations(recommendations) {
  const map = new Map();
  recommendations.forEach((rec) => {
    if (rec.default_supplier?.id) {
      map.set(rec.default_supplier.id, {
        id: rec.default_supplier.id,
        name: rec.default_supplier.name || "Fournisseur",
      });
    }
  });
  return map;
}

function renderReferenceSelects() {
  if (ingredientSupplierSelect) {
    ingredientSupplierSelect.innerHTML = '<option value="">— Aucun fournisseur —</option>';
    state.supplierList.forEach((supplier) => {
      ingredientSupplierSelect.insertAdjacentHTML(
        "beforeend",
        `<option value="${supplier.id}">${supplier.name || "Fournisseur"}</option>`,
      );
    });
  }
  if (recipeAddIngredientSelect) {
    const ingredientOptions = state.ingredientCatalog
      .map((ingredient) => `<option value="${ingredient.id}">${ingredient.name} (${ingredient.unit})</option>`)
      .join("\n");
    recipeAddIngredientSelect.innerHTML = `<option value="">Choisissez un ingrédient</option>${ingredientOptions}`;
  }

  renderIngredientManageList();
}

function renderMenuSelects() {
  const menuOptions = state.menuItems
    .map((item) => `<option value="${item.id}">${item.name}</option>`)
    .join("\n");
  const placeholder = '<option value="">Sélectionnez un plat</option>';
  if (menuConfigSelect) {
    menuConfigSelect.innerHTML = `${placeholder}${menuOptions}`;
  }
  if (salesMenuSelect) {
    salesMenuSelect.innerHTML = `${placeholder}${menuOptions}`;
  }
}

function bindIngredientTabs() {
  if (!ingredientTabButtons?.length) {
    return;
  }
  ingredientTabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.ingredientTab;
      setIngredientTab(tab);
    });
  });
  setIngredientTab(state.activeIngredientTab);
}

function setIngredientTab(tab) {
  const nextTab = tab === "manage" ? "manage" : "add";
  state.activeIngredientTab = nextTab;
  ingredientTabButtons?.forEach((button) => {
    const isActive = button.dataset.ingredientTab === nextTab;
    button.classList.toggle("active", isActive);
    if (button.hasAttribute("aria-selected")) {
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    }
  });
  if (ingredientAddPanel) {
    ingredientAddPanel.hidden = nextTab !== "add";
  }
  if (ingredientManagePanel) {
    ingredientManagePanel.hidden = nextTab !== "manage";
  }
}

function renderIngredientManageList() {
  if (!ingredientManageList) {
    return;
  }
  if (!state.restaurantId) {
    ingredientManageList.innerHTML = '<p class="muted">Sélectionnez un restaurant pour gérer son catalogue.</p>';
    setIngredientManageMessage("", "");
    return;
  }
  if (!Array.isArray(state.ingredientCatalog) || !state.ingredientCatalog.length) {
    ingredientManageList.innerHTML = '<p class="muted">Aucun ingrédient enregistré encore.</p>';
    setIngredientManageMessage("", "");
    return;
  }
  const rows = state.ingredientCatalog
    .map((ingredient) => {
      const supplierOptions = buildSupplierOptions(ingredient.default_supplier_id);
      return `
        <div class="ingredient-manage-row" data-ingredient-id="${ingredient.id}">
          <label>
            <span>Nom</span>
            <input type="text" data-field="name" value="${escapeHtml(ingredient.name || "")}" required />
          </label>
          <label>
            <span>Unité</span>
            <input type="text" data-field="unit" value="${escapeHtml(ingredient.unit || "")}" required />
          </label>
          <label>
            <span>Fournisseur par défaut</span>
            <select data-field="supplier">
              ${supplierOptions}
            </select>
          </label>
          <div class="ingredient-manage-actions">
            <button type="button" class="secondary-btn" data-action="save">Enregistrer</button>
            <button type="button" class="ghost-btn" data-action="delete">Supprimer</button>
          </div>
        </div>`;
    })
    .join("\n");
  ingredientManageList.innerHTML = rows;
  setIngredientManageMessage("", "");
}

function buildSupplierOptions(selectedId) {
  const current = selectedId ? String(selectedId) : "";
  const entries = state.supplierList
    .map((supplier) => {
      const isSelected = current && String(supplier.id) === current;
      return `<option value="${supplier.id}" ${isSelected ? "selected" : ""}>${escapeHtml(
        supplier.name || "Fournisseur",
      )}</option>`;
    })
    .join("\n");
  return `<option value="" ${current ? "" : "selected"}>— Aucun fournisseur —</option>${entries}`;
}

function handleIngredientManageClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }
  const row = button.closest(".ingredient-manage-row");
  if (!row) {
    return;
  }
  const ingredientId = row.dataset.ingredientId;
  if (!ingredientId) {
    return;
  }
  const action = button.dataset.action;
  if (action === "save") {
    saveIngredientRow(row, button, ingredientId);
    return;
  }
  if (action === "delete") {
    deleteIngredientRow(button, ingredientId);
  }
}

async function saveIngredientRow(row, button, ingredientId) {
  const nameInput = row.querySelector('[data-field="name"]');
  const unitInput = row.querySelector('[data-field="unit"]');
  const supplierSelect = row.querySelector('[data-field="supplier"]');
  const name = nameInput?.value.trim();
  const unit = unitInput?.value.trim();
  if (!name || !unit) {
    setIngredientManageMessage("Renseignez le nom et l'unité de l'ingrédient.", "error");
    return;
  }
  const payload = {
    name,
    unit,
    default_supplier_id: supplierSelect?.value || null,
  };
  button.disabled = true;
  setIngredientManageMessage("Enregistrement en cours…", "loading");
  try {
    await ensureAuthToken();
    await purchasingApi.updateIngredient(ingredientId, payload);
    setIngredientManageMessage("Ingrédient mis à jour.", "success");
    await fetchDataAndRender();
    setIngredientTab("manage");
  } catch (error) {
    console.error(error);
    setIngredientManageMessage(error.message || "Impossible de mettre à jour l'ingrédient.", "error");
  } finally {
    button.disabled = false;
  }
}

async function deleteIngredientRow(button, ingredientId) {
  if (!window.confirm("Supprimer cet ingrédient ?")) {
    return;
  }
  button.disabled = true;
  setIngredientManageMessage("Suppression en cours…", "loading");
  try {
    await ensureAuthToken();
    await purchasingApi.deleteIngredient(ingredientId);
    setIngredientManageMessage("Ingrédient supprimé.", "success");
    await fetchDataAndRender();
    setIngredientTab("manage");
  } catch (error) {
    console.error(error);
    setIngredientManageMessage(error.message || "Impossible de supprimer l'ingrédient.", "error");
  } finally {
    button.disabled = false;
  }
}

function setIngredientManageMessage(message, stateClass) {
  if (!ingredientManageMessage) {
    return;
  }
  ingredientManageMessage.textContent = message || "";
  ingredientManageMessage.dataset.state = stateClass || "";
}

function syncMenuSelectValues() {
  const value = state.selectedMenuItemId ? String(state.selectedMenuItemId) : "";
  if (menuConfigSelect && menuConfigSelect.value !== value) {
    menuConfigSelect.value = value;
  }
  if (salesMenuSelect && salesMenuSelect.value !== value) {
    salesMenuSelect.value = value;
  }
}

function openModal() {
  if (!orderModal) return;
  orderModal.classList.remove("hidden");
  orderFormMessage.textContent = "";
}

function closeModal() {
  if (!orderModal) return;
  orderModal.classList.add("hidden");
  orderForm?.reset();
}

function populateOrderModal(recommendations, suppliers) {
  if (!orderLinesContainer || !orderSupplierSelect) return;
  const supplierOptions = Array.from(suppliers.values());
  if (!supplierOptions.length) {
    orderSupplierSelect.innerHTML = '<option value="">Aucun fournisseur renseigné</option>';
  } else {
    orderSupplierSelect.innerHTML = supplierOptions
      .map((supplier, index) => `
        <option value="${supplier.id}" ${index === 0 ? "selected" : ""}>${supplier.name}</option>
      `)
      .join("\n");
  }

  const urgent = recommendations.filter((rec) =>
    ["LOW", "CRITICAL"].includes((rec.status || "").toUpperCase()),
  );
  const source = urgent.length ? urgent : recommendations;
  if (!source.length) {
    orderLinesContainer.innerHTML = "<p>Aucun ingrédient disponible. Rafraîchissez les données.</p>";
    return;
  }
  orderLinesContainer.innerHTML = source
    .map((rec) => {
      const checked = urgent.length ? urgent.includes(rec) : true;
      const recommended = Number(rec.recommended_order_quantity || 0).toFixed(2);
      return `
        <div class="order-line" data-ingredient="${rec.ingredient_id}">
          <label class="order-line-header">
            <input type="checkbox" class="order-line-toggle" data-ingredient-id="${rec.ingredient_id}" ${
              checked ? "checked" : ""
            } />
            <span>${rec.ingredient_name}</span>
            <span class="status-pill ${statusClass(rec.status)}">${rec.status}</span>
          </label>
          <div class="order-line-body">
            <small>Quantité recommandée : ${formatNumber(rec.recommended_order_quantity)} ${rec.unit}</small>
            <input type="number" step="0.01" min="0" value="${recommended}" data-quantity-for="${rec.ingredient_id}" />
            <span>${rec.unit}</span>
          </div>
        </div>
      `;
    })
    .join("\n");
}

async function handleOrderSubmit(event) {
  event.preventDefault();
  if (!orderForm) return;
  try {
    await ensureAuthToken();
  } catch (error) {
    handleAuthFailure(error);
    return;
  }
  const formData = new FormData(orderForm);
  const supplierId = formData.get("supplier_id");
  if (!supplierId) {
    orderFormMessage.textContent = "Sélectionnez un fournisseur.";
    return;
  }
  const selectedLines = Array.from(
    orderLinesContainer.querySelectorAll("input.order-line-toggle:checked"),
  );
  if (!selectedLines.length) {
    orderFormMessage.textContent = "Choisissez au moins un ingrédient.";
    return;
  }
  const lines = selectedLines
    .map((checkbox) => {
      const ingredientId = checkbox.dataset.ingredientId;
      const container = checkbox.closest(".order-line");
      const rec = state.recommendations.find((item) => String(item.ingredient_id) === String(ingredientId));
      const quantityInput = container.querySelector(`[data-quantity-for="${ingredientId}"]`);
      const quantity = Number(quantityInput.value);
      if (!rec || Number.isNaN(quantity)) {
        return null;
      }
      return {
        ingredient_id: rec.ingredient_id,
        quantity_ordered: Math.max(quantity, 0),
        unit: rec.unit,
      };
    })
    .filter(Boolean);
  if (!lines.length) {
    orderFormMessage.textContent = "Impossible de constituer les lignes.";
    return;
  }
  const payload = {
    supplier_id: supplierId,
    expected_delivery_date: expectedDateInput?.value || null,
    reorder_cycle_days: state.filters.reorder_cycle_days,
    notes: null,
    lines,
  };
  orderFormMessage.textContent = "Envoi en cours…";
  try {
    await purchasingApi.createPurchaseOrder(payload);
    orderFormMessage.textContent = "Commande créée avec succès.";
    setTimeout(closeModal, 800);
  } catch (error) {
    orderFormMessage.textContent = error.message || "Échec de la création de commande.";
  }
}

async function handleIngredientSubmit(event) {
  event.preventDefault();
  if (!ingredientForm) return;
  try {
    await ensureAuthToken();
  } catch (error) {
    handleAuthFailure(error);
    return;
  }
  const formData = new FormData(ingredientForm);
  const payload = {
    name: formData.get("name")?.toString().trim(),
    unit: formData.get("unit")?.toString().trim(),
    default_supplier_id: formData.get("default_supplier_id") || null,
  };
  if (!payload.name || !payload.unit) {
    ingredientFormMessage.textContent = "Veuillez renseigner tous les champs.";
    return;
  }
  ingredientFormMessage.textContent = "Création en cours…";
  try {
    await purchasingApi.createIngredient(payload);
    ingredientForm.reset();
    ingredientFormMessage.textContent = "Ingrédient ajouté.";
    fetchDataAndRender();
  } catch (error) {
    ingredientFormMessage.textContent = error.message || "Impossible d'ajouter l'ingrédient.";
  }
}

async function handleRecipeAddSubmit(event) {
  event.preventDefault();
  if (!recipeAddForm) return;
  if (!state.selectedMenuItemId) {
    recipeAddFormMessage.textContent = "Sélectionnez d'abord un plat dans la liste.";
    return;
  }
  try {
    await ensureAuthToken();
  } catch (error) {
    handleAuthFailure(error);
    return;
  }
  const ingredientId = recipeAddIngredientSelect?.value;
  const quantity = Number(recipeAddQuantityInput?.value);
  if (!ingredientId || Number.isNaN(quantity) || quantity <= 0) {
    recipeAddFormMessage.textContent = "Choisissez un ingrédient et une quantité valide.";
    return;
  }
  recipeAddFormMessage.textContent = "Ajout en cours…";
  try {
    await purchasingApi.upsertRecipe({
      menu_item_id: state.selectedMenuItemId,
      ingredient_id: ingredientId,
      quantity_per_unit: quantity,
    });
    recipeAddFormMessage.textContent = "Ingrédient ajouté à ce plat.";
    recipeAddForm.reset();
    fetchRecipesForActiveMenuItem();
  } catch (error) {
    recipeAddFormMessage.textContent = error.message || "Impossible d'ajouter l'ingrédient.";
  }
}

async function handleSalesSubmit(event) {
  event.preventDefault();
  if (!salesForm) return;
  try {
    await ensureAuthToken();
  } catch (error) {
    handleAuthFailure(error);
    return;
  }
  const formData = new FormData(salesForm);
  const payload = {
    menu_item_id: formData.get("menu_item_id"),
    quantity: Number(formData.get("quantity")),
  };
  const orderedAt = formData.get("ordered_at");
  if (orderedAt) {
    payload.ordered_at = `${orderedAt}T00:00:00Z`;
  }
  if (!payload.menu_item_id || Number.isNaN(payload.quantity) || payload.quantity <= 0) {
    salesFormMessage.textContent = "Indiquez le plat et la quantité.";
    return;
  }
  salesFormMessage.textContent = "Enregistrement de la vente…";
  try {
    await purchasingApi.recordSale(payload);
    salesForm.reset();
    if (salesDateInput && !salesDateInput.value) {
      salesDateInput.value = formatDateInput(new Date());
    }
    salesFormMessage.textContent = "Vente enregistrée.";
    fetchDataAndRender();
  } catch (error) {
    salesFormMessage.textContent = error.message || "Impossible d'enregistrer la vente.";
  }
}

async function setSelectedMenuItem(menuItemId) {
  const normalized = menuItemId || null;
  if (state.selectedMenuItemId === normalized) {
    syncMenuSelectValues();
    if (!normalized) {
      state.activeRecipe = [];
      renderRecipeTable();
      return;
    }
    await fetchRecipesForActiveMenuItem();
    return;
  }
  state.selectedMenuItemId = normalized;
  syncMenuSelectValues();
  await fetchRecipesForActiveMenuItem();
}

async function fetchRecipesForActiveMenuItem() {
  if (!state.selectedMenuItemId) {
    state.activeRecipe = [];
    renderRecipeTable();
    setRecipeStatus("Sélectionnez un plat pour voir sa recette.", "info");
    return;
  }
  setRecipeStatus("Chargement de la recette…", "loading");
  try {
    const rows = await purchasingApi.fetchMenuItemRecipes(state.selectedMenuItemId);
    state.activeRecipe = rows || [];
    renderRecipeTable();
    setRecipeStatus(
      state.activeRecipe.length
        ? ""
        : "Aucun ingrédient n'est lié à ce plat pour le moment.",
      state.activeRecipe.length ? "" : "info",
    );
  } catch (error) {
    state.activeRecipe = [];
    renderRecipeTable();
    setRecipeStatus(error.message || "Impossible de charger la recette.", "error");
  }
}

function renderRecipeTable() {
  if (!recipeTableBody) {
    return;
  }
  if (!state.selectedMenuItemId) {
    recipeTableBody.innerHTML = `<tr><td colspan="3" class="muted">Sélectionnez un plat pour afficher sa composition.</td></tr>`;
    return;
  }
  if (!state.activeRecipe.length) {
    recipeTableBody.innerHTML = `<tr><td colspan="3" class="muted">Aucun ingrédient n'est encore associé à ce plat.</td></tr>`;
    return;
  }
  recipeTableBody.innerHTML = state.activeRecipe
    .map((row) => {
      const quantity = Number(row.quantity_per_unit || 0);
      const unit = row.unit || "";
      const identifier = row.ingredient_id;
      return `
        <tr>
          <td>
            <strong>${row.ingredient_name || "Ingrédient"}</strong>
            <p class="muted">${unit}</p>
          </td>
          <td>
            <div class="recipe-quantity">
              <input type="number" step="0.01" min="0.01" value="${quantity.toFixed(2)}" data-quantity-input="${identifier}" />
              <span>${unit}</span>
            </div>
          </td>
          <td class="recipe-actions">
            <button type="button" data-action="update-recipe" data-ingredient-id="${identifier}">Mettre à jour</button>
          </td>
        </tr>`;
    })
    .join("\n");
}

function setRecipeStatus(message, stateClass) {
  if (!recipeStatus) {
    return;
  }
  recipeStatus.textContent = message || "";
  recipeStatus.dataset.state = stateClass || "";
}

async function handleRecipeTableClick(event) {
  const button = event.target.closest("[data-action='update-recipe']");
  if (!button) {
    return;
  }
  if (!state.selectedMenuItemId) {
    setRecipeStatus("Sélectionnez un plat avant de modifier les ingrédients.", "error");
    return;
  }
  const ingredientId = button.dataset.ingredientId;
  const input = recipeTableBody?.querySelector(`[data-quantity-input='${ingredientId}']`);
  const quantity = Number(input?.value);
  if (!ingredientId || !input || Number.isNaN(quantity) || quantity <= 0) {
    setRecipeStatus("Indiquez une quantité valide.", "error");
    return;
  }
  button.disabled = true;
  setRecipeStatus("Mise à jour de la recette…", "loading");
  try {
    await purchasingApi.upsertRecipe({
      menu_item_id: state.selectedMenuItemId,
      ingredient_id: ingredientId,
      quantity_per_unit: quantity,
    });
    setRecipeStatus("Quantité mise à jour.", "success");
    fetchRecipesForActiveMenuItem();
  } catch (error) {
    setRecipeStatus(error.message || "Impossible de mettre à jour la recette.", "error");
  } finally {
    button.disabled = false;
  }
}

function safeReadJson(response) {
  return response
    .json()
    .catch(() => null);
}

function escapeHtml(value) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return String(value ?? "").replace(/[&<>"']/g, (char) => map[char]);
}
