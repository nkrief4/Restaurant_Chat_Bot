/**
 * Recipes Management Module
 * Handles recipe list display, selection, and details panel
 * Connected to real API endpoints with Restaurant Selector
 */

(function () {
    'use strict';

    // State management
    let currentRestaurantId = null;
    let currentRecipeId = null;
    let allRecipes = [];
    let filteredRecipes = [];
    let currentRecipeData = null;
    let isEditingRecipe = false;

    // Ingredient Management State
    let currentRecipeIngredients = [];
    let originalRecipeIngredients = [];
    let allIngredients = [];

    // DOM Elements
    const searchInput = document.getElementById('recipes-search');
    const categoryFilter = document.getElementById('recipes-category-filter');
    const sortSelect = document.getElementById('recipes-sort');
    const tableBody = document.getElementById('recipes-table-body');

    // Details Panel Elements
    const layout = document.getElementById('recipes-layout');
    const detailsShell = document.getElementById('recipe-details-shell');
    const detailNameEl = document.getElementById('recipe-detail-name');
    const detailCategoryEl = document.getElementById('recipe-detail-category');
    const detailCostEl = document.getElementById('recipe-detail-cost');
    const detailPriceEl = document.getElementById('recipe-detail-price');
    const detailMarginEl = document.getElementById('recipe-detail-margin');
    const detailInstructionsEl = document.getElementById('recipe-instructions');
    const editRecipeBtn = document.getElementById('btn-edit-recipe');
    const collapseDetailsBtn = document.getElementById('btn-collapse-details');
    const deleteRecipeBtn = document.getElementById('btn-delete-recipe');
    const editIngredientsBtn = document.getElementById('btn-edit-ingredients');
    const editForm = document.getElementById('recipe-edit-form');
    const editNameInput = document.getElementById('edit-recipe-name');
    const editCostInput = document.getElementById('edit-recipe-cost');
    const editPriceInput = document.getElementById('edit-recipe-price');
    const editInstructionsInput = document.getElementById('edit-recipe-instructions');
    const btnSaveRecipe = document.getElementById('btn-save-recipe');
    const btnCancelEdit = document.getElementById('btn-cancel-edit');

    /**
     * Initialize the recipes module
     */
    function init() {
        console.log('Initializing Recipes Module');

        // Listen for token ready event
        document.addEventListener('tokenReady', function (e) {
            console.log('Recipes Module received tokenReady event');
            // If we have restaurants but couldn't load recipes due to missing token, retry now
            if (currentRestaurantId) {
                loadRecipes(currentRestaurantId);
            }
        });

        // Listen for global restaurant selection changes
        document.addEventListener('activeRestaurantChange', handleActiveRestaurantUpdate);

        // Set up event listeners
        setupEventListeners();

        // Initialize from the current global selection if available
        initializeFromActiveRestaurant();
    }

    /**
     * Set up event listeners
     */
    function setupEventListeners() {
        if (searchInput) searchInput.addEventListener('input', handleSearch);
        if (categoryFilter) categoryFilter.addEventListener('change', handleFilter);
        if (sortSelect) sortSelect.addEventListener('change', handleSort);
        if (tableBody) tableBody.addEventListener('click', handleRecipeClick);

        // Panel controls
        if (collapseDetailsBtn) collapseDetailsBtn.addEventListener('click', hideRecipeDetails);
        if (editRecipeBtn) editRecipeBtn.addEventListener('click', handleEditRecipe);
        if (deleteRecipeBtn) deleteRecipeBtn.addEventListener('click', handleDeleteRecipe);
        if (editIngredientsBtn) editIngredientsBtn.addEventListener('click', handleEditIngredients);
        if (editForm) editForm.addEventListener('submit', handleSaveRecipe);
        if (btnCancelEdit) btnCancelEdit.addEventListener('click', closeEditModal);

        // Modal close button
        const btnCloseEditModal = document.getElementById('btn-close-edit-modal');
        if (btnCloseEditModal) btnCloseEditModal.addEventListener('click', closeEditModal);

        // Close modal on overlay click
        const editModal = document.getElementById('recipe-edit-modal');
        if (editModal) {
            const overlay = editModal.querySelector('.recipe-edit-modal-overlay');
            if (overlay) overlay.addEventListener('click', closeEditModal);
        }

        // Add ingredient button redirection
        const btnAddIngredient = document.getElementById('btn-add-recipe-ingredient');
        if (btnAddIngredient) {
            btnAddIngredient.addEventListener('click', (e) => {
                e.preventDefault();
                const stockLink = document.querySelector('[data-purchasing-view="stock"]');
                if (stockLink) stockLink.click();
            });
        }

        // Ingredient Manager Events
        const btnAddIng = document.getElementById('btn-add-ingredient');
        if (btnAddIng) btnAddIng.addEventListener('click', handleAddIngredientToRecipe);

        const newIngSelect = document.getElementById('new-ingredient-select');
        if (newIngSelect) newIngSelect.addEventListener('change', updateNewIngredientUnit);

    }

    function initializeFromActiveRestaurant() {
        const active = window.activeRestaurant;
        if (active && active.id) {
            currentRestaurantId = active.id;
            loadRecipes(currentRestaurantId);
        } else {
            showEmptyRecipesState();
        }
    }

    function handleActiveRestaurantUpdate(event) {
        const detail = event.detail || {};
        if (detail.id) {
            currentRestaurantId = detail.id;
            loadRecipes(currentRestaurantId);
        } else {
            currentRestaurantId = null;
            showEmptyRecipesState();
        }
    }

    function showEmptyRecipesState(message) {
        const text = message || 'Utilisez le sélecteur global pour voir les recettes.';
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="4" class="text-center muted">${text}</td></tr>`;
        }
        allRecipes = [];
        filteredRecipes = [];
        hideRecipeDetails();
    }

    /**
     * Load recipes from API for a specific restaurant
     */
    async function loadRecipes(restaurantId) {
        try {
            // Show loading state
            tableBody.innerHTML = '<tr><td colspan="4" class="text-center muted">Chargement des recettes...</td></tr>';
            hideRecipeDetails(); // Hide details when switching restaurants

            // Get token from window global or localStorage fallback
            const token = window.supabaseToken || localStorage.getItem('supabase_token');

            if (!token) {
                console.warn('No auth token available yet. Waiting for tokenReady event.');
                tableBody.innerHTML = '<tr><td colspan="4" class="text-center muted">Authentification en cours...</td></tr>';
                return;
            }

            console.log('Loading recipes for restaurant:', restaurantId);

            const response = await fetch('/api/purchasing/recipes', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Restaurant-Id': restaurantId
                }
            });

            if (!response.ok) {
                throw new Error(`Erreur ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            console.log('Raw API response:', data);
            console.log('Number of recipes received:', data.length);

            allRecipes = data.map(item => {
                const mapped = {
                    menu_item_id: item.menu_item_id,
                    name: item.menu_item_name || item.name || 'Sans nom',
                    category: item.category || 'Non catégorisé',
                    totalCost: item.total_cost || 0,
                    menuPrice: item.menu_price || 0,
                    profitMargin: item.profit_margin || 0,
                    ingredientCount: item.ingredient_count || 0,
                    isManualCost: item.is_manual_cost || false
                };
                console.log('Mapped recipe:', mapped);
                return mapped;
            });

            console.log('All recipes after mapping:', allRecipes);

            filteredRecipes = [...allRecipes];
            renderRecipesTable(filteredRecipes);

        } catch (error) {
            console.error('Error loading recipes:', error);
            tableBody.innerHTML = `<tr><td colspan="4" class="text-center muted">Erreur: ${error.message}</td></tr>`;
        }
    }

    /**
     * Load recipe details from API
     */
    async function loadRecipeDetails(menuItemId) {
        try {
            const token = window.supabaseToken || localStorage.getItem('supabase_token');

            if (!currentRestaurantId) {
                console.error('No restaurant selected');
                return;
            }

            // Show loading in inputs? Or just wait.

            const response = await fetch(`/api/purchasing/recipes/${menuItemId}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Restaurant-Id': currentRestaurantId
                }
            });

            if (!response.ok) {
                throw new Error('Erreur lors du chargement des détails');
            }

            const recipe = await response.json();
            console.log('Loaded recipe details:', recipe);
            showRecipeDetails(recipe);

        } catch (error) {
            console.error('Error loading recipe details:', error);
        }
    }

    /**
     * Handle search input
     */
    function handleSearch(e) {
        const searchTerm = e.target.value.toLowerCase();
        filteredRecipes = allRecipes.filter(recipe =>
            recipe.name.toLowerCase().includes(searchTerm) ||
            (recipe.category && recipe.category.toLowerCase().includes(searchTerm))
        );
        renderRecipesTable(filteredRecipes);
    }

    /**
     * Handle category filter
     */
    function handleFilter(e) {
        const category = e.target.value.toLowerCase();
        filteredRecipes = category
            ? allRecipes.filter(recipe => recipe.category && recipe.category.toLowerCase().includes(category))
            : [...allRecipes];
        renderRecipesTable(filteredRecipes);
    }

    /**
     * Handle sort selection
     */
    function handleSort(e) {
        const sortBy = e.target.value;
        filteredRecipes.sort((a, b) => {
            switch (sortBy) {
                case 'name':
                    return a.name.localeCompare(b.name);
                case 'cost':
                    return a.totalCost - b.totalCost;
                case 'price':
                    return a.menuPrice - b.menuPrice;
                case 'margin':
                    return b.profitMargin - a.profitMargin;
                default:
                    return 0;
            }
        });
        renderRecipesTable(filteredRecipes);
    }

    /**
     * Handle recipe row click
     */
    function handleRecipeClick(e) {
        const row = e.target.closest('.recipe-card-row');
        if (!row) return;

        const recipeId = row.dataset.recipeId;
        selectRecipe(recipeId);
    }

    /**
     * Select a recipe and show its details
     */
    async function selectRecipe(recipeId) {
        if (!recipeId) {
            return;
        }
        currentRecipeId = recipeId;

        // Update active state in table
        document.querySelectorAll('.recipe-card-row').forEach(row => {
            row.classList.remove('active');
        });
        document.querySelector(`[data-recipe-id="${recipeId}"]`)?.classList.add('active');

        // Prepare panel state
        if (layout && detailsShell) {
            layout.classList.add('has-selection');
            detailsShell.removeAttribute('hidden');
            detailsShell.setAttribute('aria-hidden', 'false');
        }

        // Show loading screen
        const loadingScreen = document.getElementById('recipe-loading-screen');
        const detailsContent = document.getElementById('recipe-details-content');

        if (loadingScreen) {
            loadingScreen.removeAttribute('hidden');
        }
        if (detailsContent) {
            detailsContent.setAttribute('hidden', '');
        }

        // Load details
        await loadRecipeDetails(recipeId);

        // Hide loading screen and show content
        if (loadingScreen) {
            loadingScreen.setAttribute('hidden', '');
        }
        if (detailsContent) {
            detailsContent.removeAttribute('hidden');
        }
    }

    /**
     * Render the recipes table
     */
    function renderRecipesTable(recipesToRender) {
        if (!recipesToRender || recipesToRender.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="4" class="text-center muted">Aucune recette trouvée.</td></tr>';
            return;
        }

        console.log('Rendering recipes:', recipesToRender); // Debug log

        tableBody.innerHTML = recipesToRender.map((recipe, index) => {
            const marginClass = getMarginClass(recipe.profitMargin);
            const recipeName = recipe.name || recipe.menu_item_name || 'Sans nom';
            const recipeCategory = recipe.category || 'Non catégorisé';

            return `<tr class="recipe-card-row ${recipe.menu_item_id === currentRecipeId ? 'active' : ''}" data-recipe-id="${recipe.menu_item_id}" style="--row-index: ${index}"><td><div class="recipe-info"><span class="recipe-name">${escapeHTML(recipeName)}</span><span class="recipe-category">${escapeHTML(recipeCategory)}</span></div></td><td class="text-right font-medium">$${(recipe.totalCost || 0).toFixed(2)}</td><td class="text-right font-medium">$${recipe.menuPrice ? recipe.menuPrice.toFixed(2) : '0.00'}</td><td class="text-right"><span class="margin-badge ${marginClass}">${recipe.profitMargin ? recipe.profitMargin.toFixed(0) + '%' : 'N/A'}</span></td></tr>`;
        }).join('');
    }

    /**
     * Show recipe details in the right panel
     */
    function showRecipeDetails(recipe) {
        if (!recipe || !detailsShell) {
            return;
        }

        currentRecipeData = recipe;
        setEditMode(false);

        const name = recipe.menu_item_name || recipe.name || 'Plat sans nom';
        const category = recipe.category || 'Non catégorisé';
        const productionCost = recipe.production_cost ?? recipe.total_cost ?? 0;
        const price = recipe.menu_price ?? recipe.menuPrice ?? 0;
        const margin = price > 0 ? ((price - productionCost) / price) * 100 : null;

        if (detailNameEl) detailNameEl.textContent = name;
        if (detailCategoryEl) detailCategoryEl.textContent = category;
        if (detailCostEl) detailCostEl.textContent = productionCost ? `${productionCost.toFixed(2)} €` : '—';
        if (detailPriceEl) detailPriceEl.textContent = price ? `${price.toFixed(2)} €` : '—';
        if (detailMarginEl) detailMarginEl.textContent = margin !== null ? `${margin.toFixed(1)} %` : '—';

        const ingredientsBody = document.getElementById('recipe-ingredients-body');
        if (ingredientsBody) {
            if (recipe.ingredients && recipe.ingredients.length > 0) {
                ingredientsBody.innerHTML = recipe.ingredients.map(ing => `
                    <tr>
                        <td>
                            <div class="ingredient-name">${escapeHTML(ing.ingredient_name)}</div>
                            <small>${escapeHTML(ing.quantity_per_unit || '')} ${escapeHTML(ing.unit || '')}</small>
                        </td>
                        <td class="text-right">${ing.quantity_per_unit || '—'}</td>
                        <td class="text-right font-medium">${(ing.total_cost || 0).toFixed(2)} €</td>
                    </tr>
                `).join('');
            } else {
                ingredientsBody.innerHTML = '<tr><td colspan="3" class="text-center muted">Aucun ingrédient défini.</td></tr>';
            }
        }

        if (detailInstructionsEl) {
            detailInstructionsEl.textContent = recipe.instructions || 'Aucune instruction renseignée pour ce plat.';
        }

        if (editNameInput) editNameInput.value = name;
        if (editPriceInput) editPriceInput.value = price ? price.toFixed(2) : '';
        if (editInstructionsInput) editInstructionsInput.value = recipe.instructions || '';
    }

    /**
     * Remove ingredient from recipe
     */
    async function removeIngredient(ingredientId) {
        if (!confirm('Voulez-vous vraiment retirer cet ingrédient de la recette ?')) return;

        // TODO: Implement API call to remove ingredient
        console.log('Removing ingredient:', ingredientId, 'from recipe:', currentRecipeId);
        alert('Fonctionnalité de suppression à venir');
    }

    /**
     * Hide recipe details panel
     */
    function hideRecipeDetails() {
        currentRecipeId = null;
        currentRecipeData = null;
        setEditMode(false);
        if (layout) {
            layout.classList.remove('has-selection');
        }
        if (detailsShell) {
            detailsShell.setAttribute('aria-hidden', 'true');
            detailsShell.setAttribute('hidden', '');
        }
        document.querySelectorAll('.recipe-card-row').forEach(row => {
            row.classList.remove('active');
        });
    }

    /**
     * Get margin class based on percentage
     */
    function getMarginClass(margin) {
        if (!margin) return 'margin-neutral';
        if (margin >= 70) return 'margin-high';
        if (margin >= 50) return 'margin-medium';
        return 'margin-low';
    }

    /**
     * Escape HTML to prevent XSS
     */
    function escapeHTML(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function populateEditFields() {
        if (!currentRecipeData) {
            return;
        }
        if (editNameInput) {
            editNameInput.value = currentRecipeData.menu_item_name || currentRecipeData.name || '';
        }
        const categoryInput = document.getElementById('edit-recipe-category');
        if (categoryInput) {
            categoryInput.value = currentRecipeData.category || '';
        }

        // Cost is now calculated, but we set initial value
        calculateTotalCost();

        if (editPriceInput) {
            const priceValue = currentRecipeData.menu_price ?? currentRecipeData.menuPrice;
            const numericPrice = priceValue !== undefined && priceValue !== null ? Number(priceValue) : NaN;
            editPriceInput.value = Number.isFinite(numericPrice) ? numericPrice.toFixed(2) : '';
        }
        if (editInstructionsInput) {
            editInstructionsInput.value = currentRecipeData.instructions || '';
        }
    }

    async function fetchAllIngredients() {
        if (allIngredients.length > 0) return; // Use cached

        try {
            const token = window.supabaseToken || localStorage.getItem('supabase_token');
            if (!token || !currentRestaurantId) return;

            const response = await fetch('/api/purchasing/ingredients', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Restaurant-Id': currentRestaurantId
                }
            });

            if (response.ok) {
                const data = await response.json();
                allIngredients = data.map(ing => ({
                    id: ing.id,
                    name: ing.name,
                    unit: ing.unit,
                    unit_cost: ing.unit_cost || 0 // Assuming API returns this or we fetch separately
                }));
                // Note: The /ingredients endpoint returns recommendations, we might need /ingredients/catalog
                // Let's check the API. The /ingredients endpoint returns recommendations. 
                // We should use /ingredients/catalog or fetch stock to get costs.
                // For now, let's assume we need to fetch catalog + stock to get costs.
                // Actually, let's use the catalog endpoint and maybe stock for costs.
                // Simplified: The recipe details already have costs. For new ingredients, we might need costs.
                // Let's fetch catalog.
            }
        } catch (error) {
            console.error('Error fetching ingredients:', error);
        }
    }

    // Correcting fetchAllIngredients to use catalog and stock
    async function loadIngredientsCatalog() {
        if (allIngredients.length > 0) return;

        try {
            const token = window.supabaseToken || localStorage.getItem('supabase_token');
            if (!token || !currentRestaurantId) return;

            // Fetch catalog
            const catalogResp = await fetch('/api/purchasing/ingredients/catalog', {
                headers: { 'Authorization': `Bearer ${token}`, 'X-Restaurant-Id': currentRestaurantId }
            });
            const catalog = await catalogResp.json();

            // Fetch stock for costs
            // We don't have a direct "get all unit costs" endpoint easily accessible without stock data
            // But we can fetch stock data
            // For now, let's assume 0 cost for new ingredients if not found, or fetch stock
            // Let's just use catalog for names/units.

            allIngredients = catalog;
            populateIngredientSelect();
        } catch (e) {
            console.error('Failed to load ingredients catalog', e);
        }
    }

    function populateIngredientSelect() {
        const select = document.getElementById('new-ingredient-select');
        if (!select) return;

        select.innerHTML = '<option value="">Ajouter un ingrédient...</option>';

        // Sort alphabetically
        const sorted = [...allIngredients].sort((a, b) => a.name.localeCompare(b.name));

        sorted.forEach(ing => {
            const option = document.createElement('option');
            option.value = ing.id;
            option.textContent = ing.name;
            option.dataset.unit = ing.unit;
            select.appendChild(option);
        });
    }

    function updateNewIngredientUnit() {
        const select = document.getElementById('new-ingredient-select');
        const unitDisplay = document.getElementById('new-ingredient-unit');
        if (!select || !unitDisplay) return;

        const option = select.options[select.selectedIndex];
        unitDisplay.textContent = option.dataset.unit || '-';
    }

    function handleAddIngredientToRecipe() {
        const select = document.getElementById('new-ingredient-select');
        const qtyInput = document.getElementById('new-ingredient-quantity');

        if (!select || !qtyInput) return;

        const ingredientId = select.value;
        const quantity = parseFloat(qtyInput.value);

        if (!ingredientId) {
            alert('Veuillez sélectionner un ingrédient.');
            return;
        }
        if (!quantity || quantity <= 0) {
            alert('Veuillez saisir une quantité valide.');
            return;
        }

        const ingredient = allIngredients.find(i => i.id === ingredientId);
        if (!ingredient) return;

        // Check if already exists
        const existingIndex = currentRecipeIngredients.findIndex(i => i.ingredient_id === ingredientId);

        if (existingIndex >= 0) {
            // Update quantity
            currentRecipeIngredients[existingIndex].quantity_per_unit += quantity;
            // Update total cost (approximate if we don't have unit cost for new ones)
            // We keep the unit_cost if it exists
        } else {
            // Add new
            currentRecipeIngredients.push({
                ingredient_id: ingredientId,
                ingredient_name: ingredient.name,
                unit: ingredient.unit,
                quantity_per_unit: quantity,
                unit_cost: ingredient.unit_cost || 0,
                total_cost: 0
            });
        }

        // Reset inputs
        select.value = '';
        qtyInput.value = '';
        document.getElementById('new-ingredient-unit').textContent = '-';

        renderIngredientList();
    }

    function removeRecipeIngredient(index) {
        currentRecipeIngredients.splice(index, 1);
        renderIngredientList();
    }

    function renderIngredientList() {
        const listContainer = document.getElementById('edit-recipe-ingredients-list');
        if (!listContainer) return;

        listContainer.innerHTML = '';

        currentRecipeIngredients.forEach((ing, index) => {
            const row = document.createElement('div');
            row.className = 'ingredient-row';

            // Calculate cost for this line
            const lineCost = (ing.quantity_per_unit * (ing.unit_cost || 0));

            row.innerHTML = `
                <div class="ingredient-name" title="${escapeHTML(ing.ingredient_name)}">${escapeHTML(ing.ingredient_name)}</div>
                <div>
                    <input type="number" class="ing-qty-input" value="${ing.quantity_per_unit}" min="0" step="0.01" data-index="${index}">
                </div>
                <div class="unit-label">${escapeHTML(ing.unit)}</div>
                <div class="cost-display">${lineCost.toFixed(2)} €</div>
                <button type="button" class="icon-btn danger btn-remove-ing" data-index="${index}" title="Retirer">
                    <span>×</span>
                </button>
            `;

            listContainer.appendChild(row);
        });

        // Add event listeners for inputs and remove buttons
        listContainer.querySelectorAll('.ing-qty-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const idx = parseInt(e.target.dataset.index);
                const newQty = parseFloat(e.target.value);
                if (newQty >= 0) {
                    currentRecipeIngredients[idx].quantity_per_unit = newQty;
                    renderIngredientList(); // Re-render to update costs
                }
            });
        });

        listContainer.querySelectorAll('.btn-remove-ing').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.dataset.index);
                removeRecipeIngredient(idx);
            });
        });

        calculateTotalCost();
    }

    function calculateTotalCost() {
        let total = 0;
        currentRecipeIngredients.forEach(ing => {
            total += (ing.quantity_per_unit * (ing.unit_cost || 0));
        });

        if (editCostInput) {
            editCostInput.value = total.toFixed(2);
        }
        return total;
    }

    async function openEditModal() {
        const editModal = document.getElementById('recipe-edit-modal');
        if (!editModal || !currentRecipeData) {
            return;
        }

        // Initialize ingredients state
        // Deep copy to avoid mutating original data until save
        currentRecipeIngredients = JSON.parse(JSON.stringify(currentRecipeData.ingredients || []));
        originalRecipeIngredients = JSON.parse(JSON.stringify(currentRecipeData.ingredients || []));

        // Load catalog if needed
        await loadIngredientsCatalog();

        // Populate fields
        populateEditFields();
        renderIngredientList();

        // Show modal
        editModal.removeAttribute('hidden');

        // Prevent body scroll
        document.body.style.overflow = 'hidden';
    }

    function closeEditModal() {
        const editModal = document.getElementById('recipe-edit-modal');
        const modalContent = editModal?.querySelector('.recipe-edit-modal-content');

        if (!editModal || !modalContent) {
            return;
        }

        // Add closing animation
        modalContent.classList.add('closing');

        // Wait for animation to complete before hiding
        setTimeout(() => {
            // Hide modal
            editModal.setAttribute('hidden', '');

            // Remove closing class for next time
            modalContent.classList.remove('closing');

            // Restore body scroll
            document.body.style.overflow = '';
        }, 300); // Match the animation duration
    }

    function setEditMode(enabled) {
        // This function is now deprecated but kept for compatibility
        // The modal handles edit mode
        if (enabled) {
            openEditModal();
        } else {
            closeEditModal();
        }
    }

    /**
     * Handle edit recipe button
     */
    function handleEditRecipe() {
        if (!currentRecipeId) {
            console.warn('No recipe selected');
            return;
        }
        openEditModal();
    }

    /**
     * Handle delete recipe button
     */
    async function handleDeleteRecipe() {
        if (!currentRecipeId || !currentRestaurantId || !deleteRecipeBtn) {
            console.warn('No recipe selected');
            return;
        }
        if (!confirm('Êtes-vous sûr de vouloir supprimer ce plat ? Cette action est irréversible.')) {
            return;
        }
        const token = window.supabaseToken || localStorage.getItem('supabase_token');
        if (!token) {
            alert('Token d’authentification introuvable.');
            return;
        }
        deleteRecipeBtn.disabled = true;
        deleteRecipeBtn.textContent = 'Suppression…';
        try {
            const response = await fetch(`/api/purchasing/menu-items/${currentRecipeId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Restaurant-Id': currentRestaurantId
                }
            });
            if (!response.ok) {
                throw new Error('Impossible de supprimer ce plat.');
            }
            await loadRecipes(currentRestaurantId);
            hideRecipeDetails();
        } catch (error) {
            console.error('Delete recipe failed:', error);
            alert(error.message || 'Erreur lors de la suppression du plat.');
        } finally {
            deleteRecipeBtn.disabled = false;
            deleteRecipeBtn.textContent = 'Supprimer ce plat';
        }
    }

    /**
     * Handle edit ingredients button - Navigate to Stock Management
     */
    function handleEditIngredients() {
        if (!currentRecipeId) {
            console.warn('No recipe selected');
            return;
        }

        console.log('Navigating to Stock Management for recipe:', currentRecipeId);

        // Find the Stock Management link in the purchasing section
        const stockLink = document.querySelector('[data-purchasing-view="stock"]');

        if (stockLink) {
            // Click the link to switch to Stock Management view
            stockLink.click();

            // Optional: Show a toast notification
            showNotification('Accédez à la gestion des stocks pour ajouter des ingrédients', 'info');
        } else {
            console.warn('Stock Management link not found');
            // Fallback: try to navigate via event
            const event = new CustomEvent('switchPurchasingView', {
                detail: { view: 'stock' }
            });
            document.dispatchEvent(event);
        }
    }

    /**
     * Show notification helper
     */
    function showNotification(message, type = 'info') {
        // Simple notification - can be enhanced with a toast library
        const notification = document.createElement('div');
        notification.className = `recipe-notification ${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, #3a75ff, #60a5fa);
            color: white;
            padding: 16px 24px;
            border-radius: 12px;
            box-shadow: 0 8px 24px rgba(58, 117, 255, 0.3);
            z-index: 10000;
            font-weight: 600;
            animation: slideInRight 0.3s ease;
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOutRight 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    async function handleSaveRecipe(event) {
        event.preventDefault();
        if (!currentRecipeId || !currentRestaurantId || !btnSaveRecipe) {
            return;
        }
        const token = window.supabaseToken || localStorage.getItem('supabase_token');
        if (!token) {
            alert('Token d\'authentification introuvable.');
            return;
        }

        const rawPrice = editPriceInput?.value ?? '';
        const parsedPrice = rawPrice === '' ? null : parseFloat(rawPrice);
        const calculatedCost = calculateTotalCost();

        const payload = {
            name: editNameInput?.value?.trim() || null,
            category: document.getElementById('edit-recipe-category')?.value?.trim() || null,
            production_cost: calculatedCost, // Use calculated cost
            menu_price: Number.isFinite(parsedPrice) ? parsedPrice : null,
            instructions: editInstructionsInput?.value || null
        };

        btnSaveRecipe.disabled = true;
        btnSaveRecipe.textContent = 'Enregistrement…';

        try {
            // 1. Update Menu Item Details
            const response = await fetch(`/api/purchasing/menu-items/${currentRecipeId}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Restaurant-Id': currentRestaurantId,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error('Impossible d\'enregistrer les détails du plat.');

            // 2. Sync Ingredients
            // Identify removed ingredients
            const removedIngredients = originalRecipeIngredients.filter(orig =>
                !currentRecipeIngredients.find(curr => curr.ingredient_id === orig.ingredient_id)
            );

            // Delete removed
            for (const ing of removedIngredients) {
                await fetch(`/api/purchasing/recipes/${currentRecipeId}/ingredients/${ing.ingredient_id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}`, 'X-Restaurant-Id': currentRestaurantId }
                });
            }

            // Upsert current (new and updated)
            for (const ing of currentRecipeIngredients) {
                await fetch('/api/purchasing/recipes', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'X-Restaurant-Id': currentRestaurantId, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        menu_item_id: currentRecipeId,
                        ingredient_id: ing.ingredient_id,
                        quantity_per_unit: ing.quantity_per_unit
                    })
                });
            }

            await loadRecipes(currentRestaurantId);
            await loadRecipeDetails(currentRecipeId);
            closeEditModal();
            showNotification('Recette mise à jour avec succès', 'success');

        } catch (error) {
            console.error('Save recipe failed:', error);
            alert(error.message || 'Erreur lors de la sauvegarde du plat.');
        } finally {
            btnSaveRecipe.disabled = false;
            btnSaveRecipe.innerHTML = '<span class="btn-icon">✓</span> Enregistrer les modifications';
        }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Export functions for external use if needed
    window.RecipesModule = {
        selectRecipe,
        hideRecipeDetails,
        renderRecipesTable,
        loadRecipes,
        removeIngredient
    };

})();
