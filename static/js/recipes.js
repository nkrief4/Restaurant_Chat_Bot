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
    const restaurantSelect = document.getElementById('recipes-restaurant-select');
    const searchInput = document.getElementById('recipes-search');
    const categoryFilter = document.getElementById('recipes-category-filter');
    const sortSelect = document.getElementById('recipes-sort');
    const tableBody = document.getElementById('recipes-table-body');

    // Details Panel Elements
    const detailsPanel = document.getElementById('recipe-details-panel');
    const detailsContent = document.getElementById('recipe-details-content');
    const btnCloseDetails = document.getElementById('btn-close-details');

    // Edit Form Elements
    const editNameInput = document.getElementById('edit-recipe-name');
    const editCostInput = document.getElementById('edit-recipe-cost');
    const editPriceInput = document.getElementById('edit-recipe-price');
    const calcCostDisplay = document.getElementById('calc-cost-display');
    const btnUseCalcCost = document.getElementById('btn-use-calc-cost');
    const marginValueDisplay = document.getElementById('edit-margin-value');
    const marginBox = document.getElementById('margin-display-box');
    const btnSaveRecipe = document.getElementById('btn-save-recipe');

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

        // Load restaurants into dropdown
        loadRestaurants();

        // Listen for restaurants loaded event from dashboard.js
        document.addEventListener('restaurantsLoaded', function (e) {
            loadRestaurants();
        });

        // Set up event listeners
        setupEventListeners();
    }

    /**
     * Load restaurants into the dropdown
     */
    function loadRestaurants() {
        console.log('Loading restaurants...', window.restaurantData);

        if (window.restaurantData && window.restaurantData.length > 0) {
            restaurantSelect.innerHTML = '<option value="">Sélectionner un restaurant</option>';

            window.restaurantData.forEach(restaurant => {
                const option = document.createElement('option');
                option.value = restaurant.id;
                option.textContent = restaurant.name;
                restaurantSelect.appendChild(option);
            });

            console.log('Restaurant select populated with ' + window.restaurantData.length + ' options');

        } else {
            console.warn('No restaurant data found in window.restaurantData');
            restaurantSelect.innerHTML = '<option value="">Aucun restaurant trouvé</option>';
        }
    }

    /**
     * Set up event listeners
     */
    function setupEventListeners() {
        if (restaurantSelect) restaurantSelect.addEventListener('change', handleRestaurantChange);
        if (searchInput) searchInput.addEventListener('input', handleSearch);
        if (categoryFilter) categoryFilter.addEventListener('change', handleFilter);
        if (sortSelect) sortSelect.addEventListener('change', handleSort);
        if (tableBody) tableBody.addEventListener('click', handleRecipeClick);

        // Panel controls
        if (btnCloseDetails) btnCloseDetails.addEventListener('click', hideRecipeDetails);

        // Edit form controls
        if (editCostInput) editCostInput.addEventListener('input', updateMarginDisplay);
        if (editPriceInput) editPriceInput.addEventListener('input', updateMarginDisplay);
        if (btnUseCalcCost) btnUseCalcCost.addEventListener('click', useCalculatedCost);

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

        if (btnSaveRecipe) btnSaveRecipe.addEventListener('click', saveRecipeChanges);
    }

    /**
     * Handle restaurant selection change
     */
    async function handleRestaurantChange(e) {
        currentRestaurantId = e.target.value;

        if (currentRestaurantId) {
            localStorage.setItem('current_restaurant_id', currentRestaurantId);
            await loadRecipes(currentRestaurantId);
        } else {
            // Clear table if no restaurant selected
            tableBody.innerHTML = '<tr><td colspan="4" class="text-center muted">Sélectionnez un restaurant pour voir les recettes.</td></tr>';
            hideRecipeDetails();
            allRecipes = [];
            filteredRecipes = [];
        }
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
        currentRecipeId = recipeId;

        // Update active state in table
        document.querySelectorAll('.recipe-card-row').forEach(row => {
            row.classList.remove('active');
        });
        document.querySelector(`[data-recipe-id="${recipeId}"]`)?.classList.add('active');

        // Open panel
        if (detailsPanel) detailsPanel.classList.add('is-open');

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
        if (!detailsContent) return;

        // Populate Edit Form
        if (editNameInput) editNameInput.value = recipe.menu_item_name || '';
        if (editPriceInput) editPriceInput.value = recipe.menu_price || '';

        // Populate Instructions
        const instructionsInput = document.getElementById('edit-recipe-instructions');
        if (instructionsInput) {
            instructionsInput.value = recipe.instructions || '';
        }

        // Cost handling
        let calculatedCost = 0;
        if (recipe.ingredients) {
            calculatedCost = recipe.ingredients.reduce((sum, ing) => sum + (ing.total_cost || 0), 0);
        }

        // Store calculated cost for "Use Calculated" button
        if (btnUseCalcCost) btnUseCalcCost.dataset.cost = calculatedCost.toFixed(2);
        if (calcCostDisplay) calcCostDisplay.textContent = `${calculatedCost.toFixed(2)} €`;

        if (editCostInput) {
            // Check if production_cost is strictly not null (it can be 0)
            if (recipe.production_cost !== null && recipe.production_cost !== undefined) {
                editCostInput.value = recipe.production_cost;
            } else {
                editCostInput.value = calculatedCost.toFixed(2);
            }
        }

        updateMarginDisplay();

        // Update ingredients table  
        const ingredientsBody = document.getElementById('recipe-ingredients-body');
        if (ingredientsBody) {
            if (recipe.ingredients && recipe.ingredients.length > 0) {
                ingredientsBody.innerHTML = recipe.ingredients.map(ing => `
                    <tr>
                        <td>
                            <div class="ingredient-name">${escapeHTML(ing.ingredient_name)}</div>
                            <small class="muted">${ing.quantity_per_unit} ${escapeHTML(ing.unit || '')}</small>
                        </td>
                        <td class="text-right">${ing.quantity_per_unit}</td>
                        <td class="text-right font-medium">$${(ing.total_cost || 0).toFixed(2)}</td>
                        <td class="text-right">
                            <button type="button" class="ghost-btn tiny text-danger" 
                                onclick="window.RecipesModule.removeIngredient('${ing.ingredient_id}')"
                                title="Supprimer">×</button>
                        </td>
                    </tr>
                `).join('');
            } else {
                ingredientsBody.innerHTML = '<tr><td colspan="4" class="text-center muted">Aucun ingrédient défini</td></tr>';
            }
        }
    }

    /**
     * Save recipe changes
     */
    async function saveRecipeChanges(e) {
        e.preventDefault();

        if (!currentRecipeId) {
            console.error('No recipe selected');
            return;
        }

        try {
            const token = window.supabaseToken || localStorage.getItem('supabase_token');
            const instructionsInput = document.getElementById('edit-recipe-instructions');

            // Helper to parse float safely
            const parseCost = (val) => {
                if (!val || val === '') return null;
                const parsed = parseFloat(val);
                return isNaN(parsed) ? null : parsed;
            };

            const payload = {
                name: editNameInput?.value,
                production_cost: parseCost(editCostInput?.value),
                menu_price: parseCost(editPriceInput?.value),
                instructions: instructionsInput?.value || null
            };

            console.log('Saving recipe:', currentRecipeId, payload);

            const response = await fetch(`/api/purchasing/menu-items/${currentRecipeId}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Restaurant-Id': currentRestaurantId,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error('Erreur lors de la sauvegarde');
            }

            // Reload recipes to reflect changes
            await loadRecipes(currentRestaurantId);
            // Reload details to confirm saved data
            await loadRecipeDetails(currentRecipeId);

            // Show success feedback
            if (btnSaveRecipe) {
                const originalText = btnSaveRecipe.textContent;
                btnSaveRecipe.textContent = '✓ Enregistré !';
                btnSaveRecipe.style.background = '#10b981';
                btnSaveRecipe.style.color = 'white';
                setTimeout(() => {
                    btnSaveRecipe.textContent = originalText;
                    btnSaveRecipe.style.background = '';
                    btnSaveRecipe.style.color = '';
                }, 2000);
            }

        } catch (error) {
            console.error('Error saving recipe:', error);
            alert('Erreur lors de la sauvegarde : ' + error.message);
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
        if (detailsPanel) detailsPanel.classList.remove('is-open');
        document.querySelectorAll('.recipe-card-row').forEach(row => {
            row.classList.remove('active');
        });
    }

    /**
     * Update the margin display based on current cost and price inputs
     */
    function updateMarginDisplay() {
        const cost = parseFloat(editCostInput?.value) || 0;
        const price = parseFloat(editPriceInput?.value) || 0;

        if (!marginValueDisplay || !marginBox) return;

        if (price > 0 && cost >= 0) {
            const margin = ((price - cost) / price) * 100;
            marginValueDisplay.textContent = margin.toFixed(1) + '%';

            // Update box styling based on margin
            marginBox.classList.remove('high', 'medium', 'low');
            if (margin >= 70) {
                marginBox.classList.add('high');
            } else if (margin >= 50) {
                marginBox.classList.add('medium');
            } else {
                marginBox.classList.add('low');
            }
        } else {
            marginValueDisplay.textContent = '- %';
            marginBox.classList.remove('high', 'medium', 'low');
        }
    }

    /**
     * Use the calculated cost from ingredients
     */
    function useCalculatedCost() {
        if (!btnUseCalcCost || !editCostInput) return;

        const calculatedCost = btnUseCalcCost.dataset.cost;
        if (calculatedCost) {
            editCostInput.value = calculatedCost;
            updateMarginDisplay();
        }
    }

    /**
     * Save recipe changes
     */
    async function saveRecipeChanges(e) {
        e.preventDefault();

        if (!currentRecipeId) {
            console.error('No recipe selected');
            return;
        }

        try {
            const token = window.supabaseToken || localStorage.getItem('supabase_token');

            const payload = {
                name: editNameInput?.value,
                production_cost: parseFloat(editCostInput?.value) || null,
                menu_price: parseFloat(editPriceInput?.value) || null
            };

            console.log('Saving recipe:', currentRecipeId, payload);

            const response = await fetch(`/api/purchasing/menu-items/${currentRecipeId}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-Restaurant-Id': currentRestaurantId,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error('Erreur lors de la sauvegarde');
            }

            // Reload recipes to reflect changes
            await loadRecipes(currentRestaurantId);

            // Show success feedback
            if (btnSaveRecipe) {
                const originalText = btnSaveRecipe.textContent;
                btnSaveRecipe.textContent = '✓ Enregistré !';
                btnSaveRecipe.style.background = '#10b981';
                setTimeout(() => {
                    btnSaveRecipe.textContent = originalText;
                    btnSaveRecipe.style.background = '';
                }, 2000);
            }

        } catch (error) {
            console.error('Error saving recipe:', error);
            alert('Erreur lors de la sauvegarde : ' + error.message);
        }
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
