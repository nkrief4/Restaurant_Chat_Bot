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

    // DOM Elements
    const searchInput = document.getElementById('recipes-search');
    const categoryFilter = document.getElementById('recipes-category-filter');
    const sortSelect = document.getElementById('recipes-sort');
    const tableBody = document.getElementById('recipes-table-body');

    // Details Panel Elements
    const layout = document.getElementById('recipes-layout');
    const detailsShell = document.getElementById('recipe-details-shell');
    const btnCloseDetails = document.getElementById('btn-close-details');
    const detailNameEl = document.getElementById('recipe-detail-name');
    const detailCategoryEl = document.getElementById('recipe-detail-category');
    const detailCostEl = document.getElementById('recipe-detail-cost');
    const detailPriceEl = document.getElementById('recipe-detail-price');
    const detailMarginEl = document.getElementById('recipe-detail-margin');
    const detailInstructionsEl = document.getElementById('recipe-instructions');
    const editRecipeBtn = document.getElementById('btn-edit-recipe');
    const collapseDetailsBtn = document.getElementById('btn-collapse-details');
    const duplicateRecipeBtn = document.getElementById('btn-duplicate-recipe');
    const deleteRecipeBtn = document.getElementById('btn-delete-recipe');
    const editIngredientsBtn = document.getElementById('btn-edit-ingredients');

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
        if (btnCloseDetails) btnCloseDetails.addEventListener('click', hideRecipeDetails);
        if (collapseDetailsBtn) collapseDetailsBtn.addEventListener('click', hideRecipeDetails);
        if (editRecipeBtn) {
            editRecipeBtn.addEventListener('click', () => {
                alert('La modification de plat arrive bientôt.');
            });
        }
        if (duplicateRecipeBtn) {
            duplicateRecipeBtn.addEventListener('click', () => {
                alert('La duplication de plat arrive bientôt.');
            });
        }
        if (deleteRecipeBtn) {
            deleteRecipeBtn.addEventListener('click', () => {
                alert('La suppression de plat arrive bientôt.');
            });
        }
        if (editIngredientsBtn) {
            editIngredientsBtn.addEventListener('click', () => {
                alert('La gestion des ingrédients arrive bientôt.');
            });
        }

        // Add ingredient button redirection
        const btnAddIngredient = document.getElementById('btn-add-recipe-ingredient');
        if (btnAddIngredient) {
            btnAddIngredient.addEventListener('click', (e) => {
                e.preventDefault();
                // Find and click the Stock Management link in the sidebar
                const stockLink = document.querySelector('[data-purchasing-view="stock"]');
                if (stockLink) {
                    stockLink.click();
                } else {
                    console.warn('Lien vers la gestion des stocks introuvable');
                    // Fallback: try to trigger via dashboard event or hash
                    window.location.hash = '#purchasing';
                    // We might need a way to switch tab if hash doesn't do it deep enough
                }
            });
        }

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

        // Load details
        await loadRecipeDetails(recipeId);
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
            if (recipe.instructions) {
                detailInstructionsEl.textContent = recipe.instructions;
            } else {
                detailInstructionsEl.textContent = 'Aucune instruction renseignée pour ce plat.';
            }
        }
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
