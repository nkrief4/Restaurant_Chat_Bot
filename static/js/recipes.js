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
    const detailsEmpty = document.getElementById('recipe-details-empty');
    const detailsContent = document.getElementById('recipe-details-content');

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
            console.log('Recipes Module received restaurantsLoaded event');
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
        if (restaurantSelect) {
            restaurantSelect.addEventListener('change', handleRestaurantChange);
        }

        if (searchInput) {
            searchInput.addEventListener('input', handleSearch);
        }

        if (categoryFilter) {
            categoryFilter.addEventListener('change', handleFilter);
        }

        if (sortSelect) {
            sortSelect.addEventListener('change', handleSort);
        }

        if (tableBody) {
            tableBody.addEventListener('click', handleRecipeClick);
        }
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
            tableBody.innerHTML = '<tr><td colspan="5" class="text-center muted">Sélectionnez un restaurant pour voir les recettes.</td></tr>';
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
            tableBody.innerHTML = '<tr><td colspan="5" class="text-center muted">Chargement des recettes...</td></tr>';
            hideRecipeDetails(); // Hide details when switching restaurants

            // Get token from window global or localStorage fallback
            const token = window.supabaseToken || localStorage.getItem('supabase_token');

            if (!token) {
                console.warn('No auth token available yet. Waiting for tokenReady event.');
                tableBody.innerHTML = '<tr><td colspan="5" class="text-center muted">Authentification en cours...</td></tr>';
                return;
            }

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
            console.log('Loaded recipes for restaurant ' + restaurantId, data);

            allRecipes = data.map(item => ({
                menu_item_id: item.menu_item_id,
                name: item.menu_item_name || 'Sans nom',
                category: item.category || 'Non catégorisé',
                totalCost: item.total_cost || 0,
                menuPrice: item.menu_price || 0,
                profitMargin: item.profit_margin || 0,
                ingredientCount: item.ingredient_count || 0
            }));

            filteredRecipes = [...allRecipes];
            renderRecipesTable(filteredRecipes);

        } catch (error) {
            console.error('Error loading recipes:', error);
            tableBody.innerHTML = `<tr><td colspan="5" class="text-center muted">Erreur: ${error.message}</td></tr>`;
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

        // Load and show recipe details from API
        await loadRecipeDetails(recipeId);
    }

    /**
     * Render the recipes table
     */
    function renderRecipesTable(recipesToRender) {
        if (!recipesToRender || recipesToRender.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="5" class="text-center muted">Aucune recette trouvée pour ce restaurant.</td></tr>';
            return;
        }

        tableBody.innerHTML = recipesToRender.map(recipe => {
            const marginClass = getMarginClass(recipe.profitMargin);
            return `
            <tr class="recipe-card-row ${recipe.menu_item_id === currentRecipeId ? 'active' : ''}" data-recipe-id="${recipe.menu_item_id}">
                <td>
                    <div class="recipe-info">
                        <span class="recipe-name">${escapeHTML(recipe.name)}</span>
                        <span class="recipe-category">${escapeHTML(recipe.category)}</span>
                    </div>
                </td>
                <td class="text-right font-medium">$${recipe.totalCost.toFixed(2)}</td>
                <td class="text-right font-medium">$${recipe.menuPrice ? recipe.menuPrice.toFixed(2) : '0.00'}</td>
                <td class="text-right">
                    <span class="margin-badge ${marginClass}">
                        ${recipe.profitMargin ? recipe.profitMargin.toFixed(0) + '%' : 'N/A'}
                    </span>
                </td>
            </tr>
        `;
        }).join('');
    }

    /**
     * Show recipe details in the right panel
     */
    function showRecipeDetails(recipe) {
        if (!detailsEmpty || !detailsContent) return;

        // Hide empty state, show content
        detailsEmpty.style.display = 'none';
        detailsContent.hidden = false;

        // Update title and category
        document.getElementById('recipe-detail-title').textContent = recipe.menu_item_name || '';
        document.getElementById('recipe-detail-category').textContent = recipe.category || 'Non catégorisé';

        // Update KPIs
        document.getElementById('recipe-detail-cost').textContent = `$${(recipe.total_cost || 0).toFixed(2)}`;
        document.getElementById('recipe-detail-price').textContent = recipe.menu_price ? `$${recipe.menu_price.toFixed(2)}` : 'N/A';

        const marginElement = document.getElementById('recipe-detail-margin');
        if (marginElement) {
            marginElement.textContent = recipe.profit_margin ? `${recipe.profit_margin.toFixed(0)}%` : 'N/A';
            // Update color class
            marginElement.className = 'kpi-value kpi-profit ' + getMarginClass(recipe.profit_margin);
        }

        // Update ingredients table  
        const ingredientsBody = document.getElementById('recipe-ingredients-body');
        if (ingredientsBody) {
            if (recipe.ingredients && recipe.ingredients.length > 0) {
                ingredientsBody.innerHTML = recipe.ingredients.map(ing => `
                    <tr>
                        <td>
                            <div class="ingredient-name">${escapeHTML(ing.ingredient_name)}</div>
                        </td>
                        <td class="text-right">${ing.quantity_per_unit} ${escapeHTML(ing.unit || '')}</td>
                        <td class="text-right font-medium">$${(ing.total_cost || 0).toFixed(2)}</td>
                    </tr>
                `).join('');
            } else {
                ingredientsBody.innerHTML = '<tr><td colspan="3" class="text-center muted">Aucun ingrédient défini</td></tr>';
            }
        }

        // Update instructions
        const instructionsList = document.getElementById('recipe-instructions-list');
        if (instructionsList) {
            if (recipe.instructions) {
                const instructions = recipe.instructions.split('\n').filter(i => i.trim());
                instructionsList.innerHTML = instructions.map(instruction => `
                    <li>${escapeHTML(instruction)}</li>
                `).join('');
            } else {
                instructionsList.innerHTML = '<li class="muted">Aucune instruction disponible</li>';
            }
        }

        // Smooth scroll to top of details panel
        detailsContent.scrollTop = 0;
    }

    /**
     * Hide recipe details panel
     */
    function hideRecipeDetails() {
        if (!detailsEmpty || !detailsContent) return;

        detailsEmpty.style.display = 'flex';
        detailsContent.hidden = true;
        currentRecipeId = null;

        // Remove active state from all rows
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
        loadRecipes
    };

})();
