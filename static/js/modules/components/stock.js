import { state } from "../core/state.js";
import { purchasingApi } from "../services/api.js";
import { forEachNode } from "../utils/dom.js";
import { showToast } from "./ui.js"; // Need to create ui.js or export showToast

// --- Stock Management Logic ---

const CATEGORY_STORAGE_KEY = "restaubot_ingredient_categories";

const ingredientFormRuntime = {
    modal: null,
    form: null,
    title: null,
    description: null,
    submitButton: null,
    inputs: {},
    categoryNewBtn: null,
};

export function bindStockManagementUI() {
    const searchInput = document.getElementById("stock-search");
    const statusFilter = document.getElementById("stock-filter-status");
    const categoryFilter = document.getElementById("stock-filter-category");

    const filterHandler = () => {
        // We can filter client-side since we have the data
        filterStockTable();
    };

    if (searchInput) searchInput.addEventListener("input", filterHandler);
    if (statusFilter) statusFilter.addEventListener("change", filterHandler);
    if (categoryFilter) categoryFilter.addEventListener("change", filterHandler);

    const addBtn = document.getElementById("stock-add-ingredient-btn");
    if (addBtn) {
        addBtn.addEventListener("click", () => {
            const restaurantId = getActiveStockRestaurantId();
            if (!restaurantId) {
                alert("Veuillez sélectionner un restaurant avant d'ajouter un ingrédient.");
                return;
            }
            openIngredientFormModal("create");
        });
    }

    setupStockRowActions();
    setupIngredientFormModal();
}

function setupStockRowActions() {
    const tableBody = document.getElementById("stock-table-body");
    if (!tableBody) return;

    tableBody.addEventListener("click", (event) => {
        const target = event.target;
        const editBtn = target.closest("[data-action='edit-ingredient']");
        const deleteBtn = target.closest("[data-action='delete-ingredient']");

        if (editBtn) {
            const id = editBtn.dataset.ingredientId;
            const ingredient = findIngredientById(id);
            if (ingredient) {
                openIngredientFormModal("edit", ingredient);
            }
        } else if (deleteBtn) {
            const id = deleteBtn.dataset.ingredientId;
            const name = deleteBtn.dataset.ingredientName;
            if (confirm(`Voulez-vous vraiment supprimer "${name}" ?`)) {
                deleteIngredientById(id, name);
            }
        }
    });
}

function findIngredientById(id) {
    return state.stockData.find(item => String(item.ingredient_id) === String(id));
}

export async function loadStockData(restaurantId = null) {
    const tableBody = document.getElementById("stock-table-body");
    if (!tableBody) return;

    const targetRestaurantId = restaurantId || state.overview?.restaurantId || null;
    state.activeStockRestaurantId = targetRestaurantId;
    if (!targetRestaurantId) {
        tableBody.innerHTML = '<tr><td colspan="5" class="muted text-center">Utilisez le sélecteur global pour afficher le stock.</td></tr>';
        state.stockData = [];
        return;
    }

    ensureCategoryStore(targetRestaurantId);

    // Skeleton loader
    tableBody.innerHTML = Array(5).fill(0).map(() => `
    <tr>
      <td><span class="loading-skeleton"></span></td>
      <td><span class="loading-skeleton" style="width: 60%"></span></td>
      <td><span class="loading-skeleton" style="width: 40%"></span></td>
      <td><span class="loading-skeleton" style="width: 30%"></span></td>
      <td><span class="loading-skeleton" style="width: 20px"></span></td>
    </tr>
  `).join('');

    try {
        // Fetch recommendations which include stock levels and consumption
        // We use default filters for now (current date range)
        const today = new Date();
        const past = new Date();
        past.setDate(today.getDate() - 30); // Look back 30 days for consumption avg

        const params = {
            restaurant_id: targetRestaurantId,
            date_from: past.toISOString().split('T')[0],
            date_to: today.toISOString().split('T')[0],
            reorder_cycle_days: 7, // Default
            default_lead_time_days: 2 // Default
        };

        const recommendations = await purchasingApi.fetchRecommendations(params);
        state.stockData = recommendations || [];
        renderStockTable(state.stockData);

    } catch (error) {
        console.error("Failed to load stock data:", error);
        tableBody.innerHTML = `<tr><td colspan="5" class="muted text-center text-red-600">Error loading data: ${error.message}</td></tr>`;
        state.stockData = [];
    }
}

function renderStockTable(data) {
    const tableBody = document.getElementById("stock-table-body");
    if (!tableBody) return;

    if (!data || data.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5" class="muted text-center">No stock data available.</td></tr>';
        return;
    }

    const restaurantId = getActiveStockRestaurantId();
    const categories = new Map();
    const statusCounts = { ok: 0, low: 0, critical: 0 };

    tableBody.innerHTML = data.map(item => {
        // Ensure status always has a value and is not NO_DATA
        let status = item.status || 'OK';
        if (status === 'NO_DATA') {
            // Calculate status if missing
            if (item.current_stock <= item.safety_stock) {
                status = 'CRITICAL';
            } else if (item.current_stock <= item.safety_stock * 1.2) {
                status = 'LOW';
            } else {
                status = 'OK';
            }
        }
        const statusClass = normalizeStatus(status);
        if (statusCounts[statusClass] !== undefined) {
            statusCounts[statusClass] += 1;
        }

        // Calculate days of coverage
        let coverageText = '∞';
        if (item.total_quantity_consumed > 0) {
            const dailyConsumption = item.total_quantity_consumed / 30; // Assuming 30 days period
            const days = item.current_stock / dailyConsumption;
            coverageText = days.toFixed(1) + ' days';
        } else if (item.current_stock === 0) {
            coverageText = '0 days';
        }

        // Format numbers
        const qty = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(item.current_stock);

        const categoryMeta = deriveIngredientCategory(item, restaurantId);
        categories.set(categoryMeta.value, categoryMeta.label);

        return `
      <tr data-ingredient-id="${item.ingredient_id}" data-status="${statusClass}" data-category="${categoryMeta.value}">
        <td>
          <div class="stock-item-name">
            <span class="stock-ingredient-name">${item.ingredient_name}</span>
            <div class="stock-metadata-row">
              <span class="stock-category-pill">${categoryMeta.label}</span>
              <span class="stock-ingredient-unit">${item.unit}</span>
            </div>
          </div>
        </td>
        <td>${qty} <small class="text-gray-500">${item.unit}</small></td>
        <td>${coverageText}</td>
        <td><span class="stock-badge ${statusClass}">${formatStatusLabel(statusClass)}</span></td>
        <td class="actions-cell">
          <div class="stock-row-actions">
            <button type="button" class="action-edit-btn" data-action="edit-ingredient" data-ingredient-id="${item.ingredient_id}">
              Modifier
            </button>
            <button type="button" class="action-delete-btn" data-action="delete-ingredient" data-ingredient-id="${item.ingredient_id}" data-ingredient-name="${item.ingredient_name}">
              Supprimer
            </button>
          </div>
        </td>
      </tr>
    `;
    }).join("");

    updateStockCategoryFilterOptions(categories);
    updateStockStatusOverview(statusCounts);
    filterStockTable();
}

function filterStockTable() {
    const searchInput = document.getElementById("stock-search");
    const statusFilter = document.getElementById("stock-filter-status");
    const categoryFilter = document.getElementById("stock-filter-category");
    const tableBody = document.getElementById("stock-table-body");

    if (!tableBody) return;

    const searchTerm = searchInput ? searchInput.value.toLowerCase() : "";
    const statusTerm = statusFilter ? statusFilter.value.toLowerCase() : "";
    const categoryTerm = categoryFilter ? categoryFilter.value : "";

    const rows = tableBody.querySelectorAll("tr");
    let visibleCount = 0;

    rows.forEach(row => {
        // Skip empty state row
        if (row.cells.length === 1) return;

        const name = row.querySelector(".stock-ingredient-name").textContent.toLowerCase();
        const status = (row.dataset.status || "").toLowerCase();
        const category = row.dataset.category || "";

        const matchesSearch = name.includes(searchTerm);
        const matchesStatus = statusTerm === "" || status === statusTerm;
        const matchesCategory = categoryTerm === "" || category === categoryTerm;

        if (matchesSearch && matchesStatus && matchesCategory) {
            row.style.display = "";
            visibleCount++;
        } else {
            row.style.display = "none";
        }
    });
}

function getActiveStockRestaurantId() {
    return state.activeStockRestaurantId || (state.overview?.restaurantId || null);
}

// --- Ingredient Form ---

function setupIngredientFormModal() {
    const modal = document.getElementById('ingredient-form-modal');
    const form = document.getElementById('ingredient-form');
    if (!modal || !form) return;

    ingredientFormRuntime.modal = modal;
    ingredientFormRuntime.form = form;
    ingredientFormRuntime.title = modal.querySelector('[data-role="modal-title"]');
    ingredientFormRuntime.description = modal.querySelector('[data-role="modal-description"]');
    ingredientFormRuntime.submitButton = modal.querySelector('[data-role="modal-submit"]');
    ingredientFormRuntime.inputs = {
        id: document.getElementById('ingredient-form-id'),
        name: document.getElementById('ingredient-name'),
        unit: document.getElementById('ingredient-unit'),
        categorySelect: document.getElementById('ingredient-category-select'),
        categoryInput: document.getElementById('ingredient-category-input'),
        currentStock: document.getElementById('ingredient-current-stock'),
        coverage: document.getElementById('ingredient-coverage'),
    };

    ingredientFormRuntime.categoryNewBtn = modal.querySelector('[data-role="category-new-btn"]');

    modal.querySelectorAll('.close-modal-btn').forEach(btn => {
        btn.addEventListener('click', closeIngredientFormModal);
    });

    if (ingredientFormRuntime.inputs.categorySelect) {
        ingredientFormRuntime.inputs.categorySelect.addEventListener("change", handleCategorySelectChange);
    }
    if (ingredientFormRuntime.categoryNewBtn) {
        ingredientFormRuntime.categoryNewBtn.addEventListener("click", () => {
            if (!ingredientFormRuntime.inputs.categorySelect) return;
            ingredientFormRuntime.inputs.categorySelect.value = "__new__";
            showCategoryInput();
        });
    }

    form.addEventListener('submit', handleIngredientFormSubmit);
}

export function openIngredientFormModal(mode, ingredient = null) {
    const runtime = ingredientFormRuntime;
    if (!runtime.modal || !runtime.form || !runtime.inputs.name) return;

    runtime.form.dataset.mode = mode;
    const { inputs } = runtime;
    const restaurantId = getActiveStockRestaurantId();

    if (mode === "edit" && ingredient) {
        inputs.id.value = ingredient.ingredient_id || "";
        inputs.name.value = ingredient.ingredient_name || "";
        inputs.unit.value = ingredient.unit || "";
        inputs.currentStock.value =
            ingredient.current_stock !== undefined ? String(ingredient.current_stock) : "0";
        inputs.currentStock.disabled = true;
        inputs.coverage.value = calculateCoverageDaysValue(ingredient);
        inputs.coverage.disabled = true;
        const derivedCategory = deriveIngredientCategory(ingredient, restaurantId);
        const storedLabel = getIngredientCategoryLabel(restaurantId, ingredient.ingredient_id);
        const initialCategoryLabel = storedLabel || derivedCategory.label || "";
        populateIngredientCategoryOptions(initialCategoryLabel);
        runtime.title.textContent = `Modifier ${ingredient.ingredient_name || "l'ingrédient"}`;
        runtime.description.textContent = "Mettez à jour les informations principales de l'ingrédient.";
        runtime.submitButton.textContent = "Mettre à jour";
    } else {
        runtime.form.reset();
        if (inputs.id) inputs.id.value = "";
        inputs.currentStock.disabled = false;
        inputs.coverage.disabled = false;
        populateIngredientCategoryOptions();
        runtime.title.textContent = "Ajouter un ingrédient";
        runtime.description.textContent = "Renseignez les informations clés pour suivre ce produit dans vos stocks.";
        runtime.submitButton.textContent = "Ajouter l'ingrédient";
    }

    runtime.modal.hidden = false;
    runtime.modal.setAttribute("aria-hidden", "false");
    runtime.modal.classList.add("open");

    requestAnimationFrame(() => {
        inputs.name.focus();
        inputs.name.select();
    });
}

function closeIngredientFormModal() {
    const runtime = ingredientFormRuntime;
    if (!runtime.modal || !runtime.form) return;
    runtime.form.reset();
    runtime.form.dataset.mode = "create";
    if (runtime.inputs.id) {
        runtime.inputs.id.value = "";
    }
    runtime.inputs.currentStock.disabled = false;
    runtime.inputs.coverage.disabled = false;
    hideCategoryInput(true);
    runtime.modal.hidden = true;
    runtime.modal.setAttribute("aria-hidden", "true");
    runtime.modal.classList.remove("open");
}

function handleCategorySelectChange(event) {
    if (!ingredientFormRuntime.inputs.categorySelect) return;
    if (event.target.value === "__new__") {
        showCategoryInput();
    } else {
        hideCategoryInput(true);
    }
}

function showCategoryInput(presetValue = "") {
    const input = ingredientFormRuntime.inputs.categoryInput;
    if (!input) return;
    input.hidden = false;
    if (presetValue) {
        input.value = presetValue;
    }
    requestAnimationFrame(() => {
        input.focus();
        input.select();
    });
}

function hideCategoryInput(resetValue = false) {
    const input = ingredientFormRuntime.inputs.categoryInput;
    if (!input) return;
    input.hidden = true;
    if (resetValue) {
        input.value = "";
    }
}

function calculateCoverageDaysValue(ingredient) {
    if (!ingredient) return "";
    if (ingredient.total_quantity_consumed > 0) {
        const dailyConsumption = ingredient.total_quantity_consumed / 30;
        if (dailyConsumption > 0) {
            return (ingredient.current_stock / dailyConsumption).toFixed(1);
        }
    }
    if (ingredient.current_stock === 0) {
        return "0";
    }
    return "";
}

async function handleIngredientFormSubmit(event) {
    event.preventDefault();
    const runtime = ingredientFormRuntime;
    if (!runtime.form) return;
    const mode = runtime.form.dataset.mode || "create";
    const restaurantId = getActiveStockRestaurantId();
    if (!restaurantId) {
        alert("Veuillez sélectionner un restaurant dans la section Stock.");
        return;
    }

    const { inputs } = runtime;
    const name = inputs.name.value.trim();
    const unit = inputs.unit.value;
    const currentStock = parseFloat(inputs.currentStock.value || "0") || 0;
    const coverage = inputs.coverage.value ? parseFloat(inputs.coverage.value) : null;

    if (!name) {
        alert("Saisissez le nom de l'ingrédient.");
        inputs.name.focus();
        return;
    }
    if (!unit) {
        alert("Choisissez l'unité principale.");
        inputs.unit.focus();
        return;
    }

    const categoryLabel = resolveSelectedCategoryLabel();
    let safetyStockValue = 0;
    let effectiveCurrentStock = currentStock;
    let ingredientId = inputs.id ? inputs.id.value : "";
    if (mode === "edit" && ingredientId) {
        const existing = findIngredientById(ingredientId);
        if (existing) {
            effectiveCurrentStock = existing.current_stock ?? effectiveCurrentStock;
            safetyStockValue = existing.safety_stock ?? 0;
        }
    }

    const payload = {
        name,
        unit,
        current_stock: effectiveCurrentStock,
        safety_stock: safetyStockValue,
        days_of_coverage: Number.isFinite(coverage) ? coverage : null
    };

    const submitBtn = runtime.submitButton;
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = mode === "create" ? "Ajout..." : "Mise à jour...";

    try {
        let categoryRecipientId = "";
        if (mode === "create") {
            const created = await purchasingApi.createIngredient(payload);
            if (created && created.id) {
                categoryRecipientId = created.id;
            }
        } else {
            if (!ingredientId) {
                throw new Error("Ingrédient introuvable.");
            }
            categoryRecipientId = ingredientId;
            await purchasingApi.updateIngredient(ingredientId, payload);
        }

        if (categoryLabel && categoryRecipientId) {
            persistIngredientCategory(restaurantId, categoryRecipientId, categoryLabel);
        } else if (!categoryLabel && categoryRecipientId) {
            removeIngredientCategory(restaurantId, categoryRecipientId);
        }

        closeIngredientFormModal();
        // showToast(mode === "create" ? "Ingrédient ajouté avec succès." : "Ingrédient mis à jour.");
        document.dispatchEvent(new CustomEvent('showToast', { detail: { message: mode === "create" ? "Ingrédient ajouté avec succès." : "Ingrédient mis à jour." } }));

        if (state.overview.restaurantId) {
            loadStockData(state.overview.restaurantId);
        }
    } catch (error) {
        console.error("Erreur lors de l'enregistrement de l'ingrédient:", error);
        alert(error.message || "Impossible d'enregistrer l'ingrédient.");
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}

async function deleteIngredientById(id, name) {
    try {
        const restaurantId = state.overview?.restaurantId || null;
        if (!restaurantId) return;

        await purchasingApi.deleteIngredient(id);
        // showToast(`"${name}" supprimé.`);
        document.dispatchEvent(new CustomEvent('showToast', { detail: { message: `"${name}" supprimé.` } }));
        removeIngredientCategory(restaurantId, id);
        loadStockData(restaurantId);
    } catch (error) {
        console.error("Error deleting ingredient:", error);
        alert("Failed to delete ingredient: " + error.message);
    }
}

// --- Category Management Helpers ---

function loadCategoryStoreFromStorage(restaurantId) {
    if (!restaurantId) {
        return {};
    }
    try {
        const raw = window.localStorage.getItem(`${CATEGORY_STORAGE_KEY}:${restaurantId}`);
        if (!raw) {
            return {};
        }
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
        console.warn("Impossible de charger les catégories d'ingrédients.", error);
        return {};
    }
}

function saveCategoryStore(restaurantId) {
    if (!restaurantId) {
        return;
    }
    try {
        const payload = state.categoryStore && state.categoryStore[restaurantId] ? state.categoryStore[restaurantId] : {};
        window.localStorage.setItem(`${CATEGORY_STORAGE_KEY}:${restaurantId}`, JSON.stringify(payload));
    } catch (error) {
        console.warn("Impossible d'enregistrer les catégories d'ingrédients.", error);
    }
}

function ensureCategoryStore(restaurantId) {
    if (!restaurantId) {
        return {};
    }
    if (!state.categoryStore) {
        state.categoryStore = {};
    }
    if (!state.categoryStore[restaurantId]) {
        state.categoryStore[restaurantId] = loadCategoryStoreFromStorage(restaurantId);
    }
    return state.categoryStore[restaurantId];
}

function getIngredientCategoryLabel(restaurantId, ingredientId) {
    if (!restaurantId || !ingredientId) {
        return "";
    }
    const store = ensureCategoryStore(restaurantId);
    const key = String(ingredientId);
    return store && store[key] ? store[key] : "";
}

function persistIngredientCategory(restaurantId, ingredientId, label) {
    if (!restaurantId || !ingredientId) {
        return;
    }
    const normalized = label ? label.trim() : "";
    if (!normalized) {
        return;
    }
    const store = ensureCategoryStore(restaurantId);
    store[String(ingredientId)] = normalized;
    saveCategoryStore(restaurantId);
}

function removeIngredientCategory(restaurantId, ingredientId) {
    if (!restaurantId || !ingredientId) {
        return;
    }
    const store = ensureCategoryStore(restaurantId);
    const key = String(ingredientId);
    if (store && store[key]) {
        delete store[key];
        saveCategoryStore(restaurantId);
    }
}

function normalizeStatus(status) {
    const normalized = (status || "").toString().toLowerCase();
    if (normalized === "critical" || normalized === "low" || normalized === "ok") {
        return normalized;
    }
    return normalized || "ok";
}

function formatStatusLabel(status) {
    switch (status) {
        case "critical":
            return "Critique";
        case "low":
            return "Faible";
        default:
            return "Stable";
    }
}

function slugifyCategory(label) {
    return label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "autres";
}

function deriveIngredientCategory(item, restaurantId) {
    const fallbackLabel = "Autres";
    const stored = restaurantId ? getIngredientCategoryLabel(restaurantId, item.ingredient_id) : "";
    if (stored) {
        return { label: stored, value: slugifyCategory(stored) };
    }
    const raw =
        item.category ||
        item.ingredient_category ||
        (item.default_supplier && item.default_supplier.name) ||
        mapUnitToCategory(item.unit) ||
        fallbackLabel;
    const label = (raw || fallbackLabel).trim() || fallbackLabel;
    const value = slugifyCategory(label);
    return { label, value };
}

function mapUnitToCategory(unit) {
    if (!unit) return null;
    const value = unit.toLowerCase();
    if (["kg", "g"].includes(value)) return "Produits frais";
    if (["l", "ml"].includes(value)) return "Liquides";
    if (value === "pcs") return "Conditionnés";
    return null;
}

function getCombinedCategoriesMap(baseMap) {
    const combined = new Map();
    if (baseMap && typeof baseMap.forEach === "function") {
        baseMap.forEach((label, value) => {
            if (value) {
                combined.set(value, label);
            }
        });
    }
    const restaurantId = getActiveStockRestaurantId();
    if (Array.isArray(state.stockData)) {
        state.stockData.forEach((item) => {
            const meta = deriveIngredientCategory(item, restaurantId);
            combined.set(meta.value, meta.label);
        });
    }
    const store = restaurantId ? ensureCategoryStore(restaurantId) : {};
    Object.keys(store || {}).forEach((key) => {
        const label = store[key];
        if (label) {
            combined.set(slugifyCategory(label), label);
        }
    });
    return combined;
}

function populateIngredientCategoryOptions(selectedLabel = "") {
    const select = ingredientFormRuntime.inputs.categorySelect;
    if (!select) return;
    const categoriesMap = getCombinedCategoriesMap();
    const entries = Array.from(categoriesMap.entries()).sort((a, b) => a[1].localeCompare(b[1]));
    const options = ['<option value="">Choisissez une catégorie</option>'];
    entries.forEach(([value, label]) => {
        options.push(`<option value="${value}">${label}</option>`);
    });
    options.push('<option value="__new__">Ajouter une catégorie…</option>');
    select.innerHTML = options.join("");

    if (selectedLabel) {
        const slug = slugifyCategory(selectedLabel);
        if (categoriesMap.has(slug)) {
            select.value = slug;
            hideCategoryInput(true);
        } else {
            select.value = "__new__";
            showCategoryInput(selectedLabel);
        }
    }
}

function resolveSelectedCategoryLabel() {
    const select = ingredientFormRuntime.inputs.categorySelect;
    const input = ingredientFormRuntime.inputs.categoryInput;
    if (!select) return "";

    if (select.value === "__new__") {
        return input ? input.value.trim() : "";
    }
    const option = select.options[select.selectedIndex];
    return option ? option.text : "";
}

function updateStockCategoryFilterOptions(categories) {
    const filter = document.getElementById("stock-filter-category");
    if (!filter) return;

    const currentVal = filter.value;
    const options = ['<option value="">Toutes les catégories</option>'];

    const entries = Array.from(categories.entries()).sort((a, b) => a[1].localeCompare(b[1]));
    entries.forEach(([value, label]) => {
        options.push(`<option value="${value}">${label}</option>`);
    });

    filter.innerHTML = options.join("");
    filter.value = currentVal;
}

function updateStockStatusOverview(counts) {
    const okEl = document.getElementById("stock-count-ok");
    const lowEl = document.getElementById("stock-count-low");
    const criticalEl = document.getElementById("stock-count-critical");

    if (okEl) okEl.textContent = counts.ok;
    if (lowEl) lowEl.textContent = counts.low;
    if (criticalEl) criticalEl.textContent = counts.critical;
}
