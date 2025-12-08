/**
 * MenuEditor - Visual menu editor component
 * Provides an intuitive interface for editing restaurant menus
 */

class MenuEditor {
    constructor(container, textareaElement) {
        this.container = container;
        this.textarea = textareaElement;
        this.mode = 'visual'; // 'visual' or 'json'
        this.menuData = { categories: [] };
        this.draggedCategoryIndex = null;
        this.draggedItemIndex = null;
        this.draggedCategoryContainer = null;

        this.init();
    }

    init() {
        // Load initial data from textarea
        this.syncFromJSON();

        // Setup mode toggle
        this.setupModeToggle();

        // Render initial view
        this.render();
    }

    setupModeToggle() {
        const visualBtn = this.container.querySelector('[data-mode="visual"]');
        const jsonBtn = this.container.querySelector('[data-mode="json"]');

        if (visualBtn) {
            visualBtn.addEventListener('click', () => this.setMode('visual'));
        }
        if (jsonBtn) {
            jsonBtn.addEventListener('click', () => this.setMode('json'));
        }
    }

    setMode(mode) {
        this.mode = mode;

        const visualEditor = this.container.querySelector('[data-role="menu-visual-editor"]');
        const jsonEditor = this.container.querySelector('[data-role="menu-json-editor"]');
        const visualBtn = this.container.querySelector('[data-mode="visual"]');
        const jsonBtn = this.container.querySelector('[data-mode="json"]');

        if (mode === 'visual') {
            if (visualEditor) visualEditor.classList.remove('hidden');
            if (jsonEditor) jsonEditor.setAttribute('hidden', '');
            if (visualBtn) visualBtn.classList.add('active');
            if (jsonBtn) jsonBtn.classList.remove('active');

            // Sync from JSON before showing visual
            this.syncFromJSON();
            this.render();
        } else {
            if (visualEditor) visualEditor.classList.add('hidden');
            if (jsonEditor) jsonEditor.removeAttribute('hidden');
            if (visualBtn) visualBtn.classList.remove('active');
            if (jsonBtn) jsonBtn.classList.add('active');

            // Sync to JSON before showing
            this.syncToJSON();
        }
    }

    syncFromJSON() {
        try {
            const jsonText = this.textarea.value.trim();
            if (!jsonText) {
                this.menuData = { categories: [] };
                return;
            }

            const parsed = JSON.parse(jsonText);
            this.menuData = this.normalizeMenuData(parsed);
        } catch (error) {
            console.warn('Failed to parse JSON, using empty menu:', error);
            this.menuData = { categories: [] };
        }
    }

    syncToJSON() {
        try {
            const jsonText = JSON.stringify(this.menuData, null, 2);
            this.textarea.value = jsonText;
        } catch (error) {
            console.error('Failed to stringify menu data:', error);
        }
    }

    normalizeMenuData(data) {
        if (!data || typeof data !== 'object') {
            return { categories: [] };
        }

        const categories = Array.isArray(data.categories) ? data.categories : [];
        return {
            categories: categories.map(cat => ({
                name: cat.name || '',
                items: Array.isArray(cat.items) ? cat.items.map(item => ({
                    name: item.name || '',
                    price: item.price !== undefined ? item.price : '',
                    description: item.description || '',
                    tags: Array.isArray(item.tags) ? item.tags : [],
                    contains: Array.isArray(item.contains) ? item.contains : [],
                    popularity: item.popularity || null
                })) : []
            })),
            dietaryGuide: data.dietaryGuide || []
        };
    }

    render() {
        const visualEditor = this.container.querySelector('[data-role="menu-visual-editor"]');
        if (!visualEditor) return;

        visualEditor.innerHTML = '';

        if (!this.menuData.categories || this.menuData.categories.length === 0) {
            visualEditor.innerHTML = this.renderEmptyState();
        } else {
            this.menuData.categories.forEach((category, index) => {
                const categoryCard = this.renderCategory(category, index);
                visualEditor.appendChild(categoryCard);
            });
        }

        // Add "Add Category" button
        const addCategoryBtn = document.createElement('button');
        addCategoryBtn.type = 'button';
        addCategoryBtn.className = 'add-category-btn';
        addCategoryBtn.textContent = '+ Ajouter une catégorie';
        addCategoryBtn.addEventListener('click', () => this.addCategory());
        visualEditor.appendChild(addCategoryBtn);
    }

    renderEmptyState() {
        return `
      <div class="menu-editor-empty">
        <div class="empty-icon">🍽️</div>
        <h4>Votre menu est vide</h4>
        <p>Commencez par créer une catégorie (Entrées, Plats, Desserts...)</p>
        <p class="empty-hint">💡 <strong>Astuce :</strong> Vous pouvez aussi uploader une image de menu pour l'analyser automatiquement !</p>
      </div>
    `;
    }

    renderCategory(category, categoryIndex) {
        const card = document.createElement('div');
        card.className = 'menu-category-card';
        card.draggable = true;
        card.dataset.categoryIndex = categoryIndex;

        // Category header
        const header = document.createElement('div');
        header.className = 'category-header';

        const iconPicker = document.createElement('div');
        iconPicker.className = 'category-icon-picker';
        iconPicker.title = 'Cliquer pour changer l\'icône';
        const icon = document.createElement('span');
        icon.className = 'category-icon';
        icon.textContent = this.getCategoryIcon(categoryIndex);
        iconPicker.appendChild(icon);
        iconPicker.addEventListener('click', () => this.changeCategoryIcon(categoryIndex));

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'category-name-input';
        nameInput.value = category.name || '';
        nameInput.placeholder = 'Ex: Entrées, Plats, Desserts...';
        nameInput.title = 'Cliquez pour modifier le nom de la catégorie';
        nameInput.addEventListener('input', (e) => {
            this.menuData.categories[categoryIndex].name = e.target.value;
            this.syncToJSON();
        });

        const actions = document.createElement('div');
        actions.className = 'category-actions';

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'icon-btn';
        removeBtn.innerHTML = '×';
        removeBtn.title = 'Supprimer la catégorie';
        removeBtn.addEventListener('click', () => this.removeCategory(categoryIndex));

        const dragHandle = document.createElement('div');
        dragHandle.className = 'drag-handle';
        dragHandle.innerHTML = '⋮⋮';
        dragHandle.title = 'Glisser pour réorganiser';

        actions.appendChild(removeBtn);
        actions.appendChild(dragHandle);

        header.appendChild(iconPicker);
        header.appendChild(nameInput);
        header.appendChild(actions);

        // Category items
        const itemsContainer = document.createElement('div');
        itemsContainer.className = 'category-items';

        if (category.items && category.items.length > 0) {
            category.items.forEach((item, itemIndex) => {
                const itemRow = this.renderItem(item, categoryIndex, itemIndex);
                itemsContainer.appendChild(itemRow);
            });
        }

        // Add item button
        const addItemBtn = document.createElement('button');
        addItemBtn.type = 'button';
        addItemBtn.className = 'add-item-btn';
        addItemBtn.textContent = '+ Ajouter un item';
        addItemBtn.addEventListener('click', () => this.addItem(categoryIndex));

        // Drag and drop for categories
        card.addEventListener('dragstart', (e) => this.handleCategoryDragStart(e, categoryIndex));
        card.addEventListener('dragend', () => this.handleCategoryDragEnd());
        card.addEventListener('dragover', (e) => this.handleCategoryDragOver(e));
        card.addEventListener('drop', (e) => this.handleCategoryDrop(e, categoryIndex));

        card.appendChild(header);
        card.appendChild(itemsContainer);
        card.appendChild(addItemBtn);

        return card;
    }

    renderItem(item, categoryIndex, itemIndex) {
        const row = document.createElement('div');
        row.className = 'menu-item-row';
        row.draggable = true;
        row.dataset.itemIndex = itemIndex;

        const dragHandle = document.createElement('div');
        dragHandle.className = 'item-drag-handle';
        dragHandle.innerHTML = '⋮';

        const content = document.createElement('div');
        content.className = 'item-content';

        // Main row: Name and Price
        const mainRow = document.createElement('div');
        mainRow.className = 'item-main-row';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'item-name';
        nameInput.value = item.name || '';
        nameInput.placeholder = 'Ex: Salade César, Steak frites...';
        nameInput.title = 'Nom du plat';
        nameInput.addEventListener('input', (e) => {
            this.menuData.categories[categoryIndex].items[itemIndex].name = e.target.value;
            this.syncToJSON();
        });

        const priceInput = document.createElement('input');
        priceInput.type = 'text';
        priceInput.className = 'item-price';
        priceInput.value = item.price !== undefined && item.price !== '' ? item.price + ' €' : '';
        priceInput.placeholder = 'Ex: 12.50 €';
        priceInput.title = 'Prix du plat';
        priceInput.addEventListener('input', (e) => {
            const value = e.target.value.replace(/[^\d.,]/g, '');
            this.menuData.categories[categoryIndex].items[itemIndex].price = value;
            this.syncToJSON();
        });
        priceInput.addEventListener('blur', (e) => {
            const value = e.target.value.replace(/[^\d.,]/g, '');
            e.target.value = value ? value + ' €' : '';
        });

        mainRow.appendChild(nameInput);
        mainRow.appendChild(priceInput);

        // Description
        const descInput = document.createElement('input');
        descInput.type = 'text';
        descInput.className = 'item-description';
        descInput.value = item.description || '';
        descInput.placeholder = 'Ex: Laitue, poulet grillé, parmesan, croûtons...';
        descInput.title = 'Description du plat (optionnel)';
        descInput.addEventListener('input', (e) => {
            this.menuData.categories[categoryIndex].items[itemIndex].description = e.target.value;
            this.syncToJSON();
        });

        // Custom Tags with Bubbles
        const tagsContainer = document.createElement('div');
        tagsContainer.className = 'item-tags-section';

        const tagsLabel = document.createElement('label');
        tagsLabel.className = 'item-field-label';
        tagsLabel.textContent = '🏷️ Tags :';

        const tagsBubbleContainer = document.createElement('div');
        tagsBubbleContainer.className = 'tags-bubble-container';

        // Display existing tags as bubbles
        const existingTags = item.tags || [];
        existingTags.forEach(tag => {
            const bubble = this.createTagBubble(tag, categoryIndex, itemIndex, 'tags');
            tagsBubbleContainer.appendChild(bubble);
        });

        // Input for new tags
        const tagsInput = document.createElement('input');
        tagsInput.type = 'text';
        tagsInput.className = 'tags-input';
        tagsInput.placeholder = 'Ajouter un tag...';
        tagsInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && tagsInput.value.trim()) {
                e.preventDefault();
                const newTag = tagsInput.value.trim();
                if (!this.menuData.categories[categoryIndex].items[itemIndex].tags.includes(newTag)) {
                    this.menuData.categories[categoryIndex].items[itemIndex].tags.push(newTag);
                    this.syncToJSON();
                    this.render();
                }
                tagsInput.value = '';
            }
        });
        tagsInput.addEventListener('blur', () => {
            if (tagsInput.value.trim()) {
                const newTag = tagsInput.value.trim();
                if (!this.menuData.categories[categoryIndex].items[itemIndex].tags.includes(newTag)) {
                    this.menuData.categories[categoryIndex].items[itemIndex].tags.push(newTag);
                    this.syncToJSON();
                    this.render();
                }
                tagsInput.value = '';
            }
        });

        tagsBubbleContainer.appendChild(tagsInput);

        // Suggestions for tags
        const tagsSuggestions = document.createElement('div');
        tagsSuggestions.className = 'tags-suggestions';

        const tagSuggestionsList = [
            'végétarien',
            'végétalien',
            'vegan',
            'sans gluten',
            'sans lactose',
            'casher',
            'halal',
            'sans porc',
            'sans alcool',
            'bio',
            'local',
            'fait maison',
            'épicé',
            'sans crustacés',
            'sans fruits de mer'
        ];

        tagSuggestionsList.forEach(suggestion => {
            const suggestionBtn = document.createElement('button');
            suggestionBtn.type = 'button';
            suggestionBtn.className = 'suggestion-btn';
            suggestionBtn.textContent = suggestion;

            // Check if already selected
            if (existingTags.includes(suggestion)) {
                suggestionBtn.classList.add('selected');
            }

            suggestionBtn.addEventListener('click', () => {
                const currentTags = this.menuData.categories[categoryIndex].items[itemIndex].tags || [];
                const index = currentTags.indexOf(suggestion);

                if (index > -1) {
                    // Remove tag
                    currentTags.splice(index, 1);
                } else {
                    // Add tag
                    currentTags.push(suggestion);
                }

                this.menuData.categories[categoryIndex].items[itemIndex].tags = currentTags;
                this.syncToJSON();
                this.render();
            });

            tagsSuggestions.appendChild(suggestionBtn);
        });

        tagsContainer.appendChild(tagsLabel);
        tagsContainer.appendChild(tagsBubbleContainer);
        tagsContainer.appendChild(tagsSuggestions);

        // Allergens/Contains with Bubbles
        const containsContainer = document.createElement('div');
        containsContainer.className = 'item-contains-section';

        const containsLabel = document.createElement('label');
        containsLabel.className = 'item-field-label';
        containsLabel.textContent = '⚠️ Contient :';

        const containsBubbleContainer = document.createElement('div');
        containsBubbleContainer.className = 'tags-bubble-container';

        // Display existing allergens as bubbles
        const existingContains = item.contains || [];
        existingContains.forEach(allergen => {
            const bubble = this.createTagBubble(allergen, categoryIndex, itemIndex, 'contains');
            containsBubbleContainer.appendChild(bubble);
        });

        // Input for new allergens
        const containsInput = document.createElement('input');
        containsInput.type = 'text';
        containsInput.className = 'tags-input';
        containsInput.placeholder = 'Ajouter un allergène...';
        containsInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && containsInput.value.trim()) {
                e.preventDefault();
                const newAllergen = containsInput.value.trim();
                if (!this.menuData.categories[categoryIndex].items[itemIndex].contains.includes(newAllergen)) {
                    this.menuData.categories[categoryIndex].items[itemIndex].contains.push(newAllergen);
                    this.syncToJSON();
                    this.render();
                }
                containsInput.value = '';
            }
        });
        containsInput.addEventListener('blur', () => {
            if (containsInput.value.trim()) {
                const newAllergen = containsInput.value.trim();
                if (!this.menuData.categories[categoryIndex].items[itemIndex].contains.includes(newAllergen)) {
                    this.menuData.categories[categoryIndex].items[itemIndex].contains.push(newAllergen);
                    this.syncToJSON();
                    this.render();
                }
                containsInput.value = '';
            }
        });

        containsBubbleContainer.appendChild(containsInput);

        // Suggestions for allergens
        const containsSuggestions = document.createElement('div');
        containsSuggestions.className = 'tags-suggestions';

        const allergenSuggestionsList = [
            'gluten',
            'lactose',
            'lait',
            'œufs',
            'arachides',
            'cacahuètes',
            'fruits à coque',
            'soja',
            'poisson',
            'crustacés',
            'mollusques',
            'céleri',
            'moutarde',
            'sésame',
            'sulfites',
            'lupin'
        ];

        allergenSuggestionsList.forEach(suggestion => {
            const suggestionBtn = document.createElement('button');
            suggestionBtn.type = 'button';
            suggestionBtn.className = 'suggestion-btn allergen';
            suggestionBtn.textContent = suggestion;

            // Check if already selected
            if (existingContains.includes(suggestion)) {
                suggestionBtn.classList.add('selected');
            }

            suggestionBtn.addEventListener('click', () => {
                const currentContains = this.menuData.categories[categoryIndex].items[itemIndex].contains || [];
                const index = currentContains.indexOf(suggestion);

                if (index > -1) {
                    // Remove allergen
                    currentContains.splice(index, 1);
                } else {
                    // Add allergen
                    currentContains.push(suggestion);
                }

                this.menuData.categories[categoryIndex].items[itemIndex].contains = currentContains;
                this.syncToJSON();
                this.render();
            });

            containsSuggestions.appendChild(suggestionBtn);
        });

        containsContainer.appendChild(containsLabel);
        containsContainer.appendChild(containsBubbleContainer);
        containsContainer.appendChild(containsSuggestions);

        // Popularity Ranking
        const popularityContainer = document.createElement('div');
        popularityContainer.className = 'item-popularity-container';

        const popularityLabel = document.createElement('label');
        popularityLabel.className = 'item-field-label';
        popularityLabel.textContent = '⭐ Popularité :';

        const popularitySelect = document.createElement('select');
        popularitySelect.className = 'item-popularity-select';
        popularitySelect.title = 'Note de popularité du plat';

        const currentRank = item.popularity?.rank_in_category || '';

        const options = [
            { value: '', label: 'Non classé' },
            { value: '1', label: '⭐⭐⭐ Top 1' },
            { value: '2', label: '⭐⭐ Top 2' },
            { value: '3', label: '⭐ Top 3' },
            { value: '4', label: 'Classique' }
        ];

        options.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            if (opt.value === String(currentRank)) {
                option.selected = true;
            }
            popularitySelect.appendChild(option);
        });

        popularitySelect.addEventListener('change', (e) => {
            const rank = e.target.value;
            if (rank) {
                const totalItems = this.menuData.categories[categoryIndex].items.length;
                this.menuData.categories[categoryIndex].items[itemIndex].popularity = {
                    source: 'manual_rank',
                    rank_in_category: parseInt(rank, 10),
                    total_in_category: totalItems
                };
            } else {
                this.menuData.categories[categoryIndex].items[itemIndex].popularity = null;
            }
            this.syncToJSON();
        });

        popularityContainer.appendChild(popularityLabel);
        popularityContainer.appendChild(popularitySelect);

        // Assemble content
        content.appendChild(mainRow);
        content.appendChild(descInput);
        content.appendChild(tagsContainer);
        content.appendChild(containsContainer);
        content.appendChild(popularityContainer);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'icon-btn remove-item-btn';
        removeBtn.innerHTML = '×';
        removeBtn.title = 'Supprimer l\'item';
        removeBtn.addEventListener('click', () => this.removeItem(categoryIndex, itemIndex));

        // Drag and drop for items
        row.addEventListener('dragstart', (e) => this.handleItemDragStart(e, categoryIndex, itemIndex));
        row.addEventListener('dragend', () => this.handleItemDragEnd());
        row.addEventListener('dragover', (e) => this.handleItemDragOver(e));
        row.addEventListener('drop', (e) => this.handleItemDrop(e, categoryIndex, itemIndex));

        row.appendChild(dragHandle);
        row.appendChild(content);
        row.appendChild(removeBtn);

        return row;
    }

    getCategoryIcon(index) {
        const icons = ['🍽️', '🥗', '🥩', '🍰', '🍷', '☕', '🍕', '🍜', '🍱', '🥘'];
        return icons[index % icons.length];
    }

    changeCategoryIcon(categoryIndex) {
        // For now, just cycle through icons
        // In the future, could show a picker modal
        const icons = ['🍽️', '🥗', '🥩', '🍰', '🍷', '☕', '🍕', '🍜', '🍱', '🥘', '🍔', '🌮', '🍣', '🥙'];
        const currentIcon = this.getCategoryIcon(categoryIndex);
        const currentIndex = icons.indexOf(currentIcon);
        const nextIndex = (currentIndex + 1) % icons.length;

        // Update the icon in the DOM
        const card = this.container.querySelector(`[data-category-index="${categoryIndex}"]`);
        if (card) {
            const iconEl = card.querySelector('.category-icon');
            if (iconEl) {
                iconEl.textContent = icons[nextIndex];
            }
        }
    }

    addCategory() {
        this.menuData.categories.push({
            name: '',
            items: []
        });
        this.syncToJSON();
        this.render();

        // Focus on the new category name input
        setTimeout(() => {
            const lastCard = this.container.querySelectorAll('.menu-category-card');
            if (lastCard.length > 0) {
                const nameInput = lastCard[lastCard.length - 1].querySelector('.category-name-input');
                if (nameInput) nameInput.focus();
            }
        }, 100);
    }

    createTagBubble(text, categoryIndex, itemIndex, type) {
        const bubble = document.createElement('div');
        bubble.className = 'tag-bubble';

        const bubbleText = document.createElement('span');
        bubbleText.textContent = text;

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'tag-bubble-remove';
        removeBtn.innerHTML = '×';
        removeBtn.title = 'Supprimer';
        removeBtn.addEventListener('click', () => {
            const array = this.menuData.categories[categoryIndex].items[itemIndex][type];
            const index = array.indexOf(text);
            if (index > -1) {
                array.splice(index, 1);
                this.syncToJSON();
                this.render();
            }
        });

        bubble.appendChild(bubbleText);
        bubble.appendChild(removeBtn);

        return bubble;
    }

    removeCategory(categoryIndex) {
        if (confirm('Êtes-vous sûr de vouloir supprimer cette catégorie ?')) {
            this.menuData.categories.splice(categoryIndex, 1);
            this.syncToJSON();
            this.render();
        }
    }

    addItem(categoryIndex) {
        if (!this.menuData.categories[categoryIndex].items) {
            this.menuData.categories[categoryIndex].items = [];
        }

        this.menuData.categories[categoryIndex].items.push({
            name: '',
            price: '',
            description: '',
            tags: [],
            contains: [],
            popularity: null
        });

        this.syncToJSON();
        this.render();

        // Focus on the new item name input
        setTimeout(() => {
            const card = this.container.querySelector(`[data-category-index="${categoryIndex}"]`);
            if (card) {
                const items = card.querySelectorAll('.menu-item-row');
                if (items.length > 0) {
                    const nameInput = items[items.length - 1].querySelector('.item-name');
                    if (nameInput) nameInput.focus();
                }
            }
        }, 100);
    }

    removeItem(categoryIndex, itemIndex) {
        this.menuData.categories[categoryIndex].items.splice(itemIndex, 1);
        this.syncToJSON();
        this.render();
    }

    // Drag and drop handlers for categories
    handleCategoryDragStart(e, categoryIndex) {
        this.draggedCategoryIndex = categoryIndex;
        e.currentTarget.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
    }

    handleCategoryDragEnd() {
        const cards = this.container.querySelectorAll('.menu-category-card');
        cards.forEach(card => {
            card.classList.remove('is-dragging', 'drop-target');
        });
        this.draggedCategoryIndex = null;
    }

    handleCategoryDragOver(e) {
        if (this.draggedCategoryIndex === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        e.currentTarget.classList.add('drop-target');
    }

    handleCategoryDrop(e, targetIndex) {
        e.preventDefault();
        e.currentTarget.classList.remove('drop-target');

        if (this.draggedCategoryIndex === null || this.draggedCategoryIndex === targetIndex) return;

        const [movedCategory] = this.menuData.categories.splice(this.draggedCategoryIndex, 1);
        this.menuData.categories.splice(targetIndex, 0, movedCategory);

        this.syncToJSON();
        this.render();
    }

    // Drag and drop handlers for items
    handleItemDragStart(e, categoryIndex, itemIndex) {
        this.draggedItemIndex = itemIndex;
        this.draggedCategoryContainer = categoryIndex;
        e.currentTarget.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.stopPropagation();
    }

    handleItemDragEnd() {
        const items = this.container.querySelectorAll('.menu-item-row');
        items.forEach(item => {
            item.classList.remove('is-dragging', 'drop-target');
        });
        this.draggedItemIndex = null;
        this.draggedCategoryContainer = null;
    }

    handleItemDragOver(e) {
        if (this.draggedItemIndex === null) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        e.currentTarget.classList.add('drop-target');
    }

    handleItemDrop(e, categoryIndex, targetIndex) {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.classList.remove('drop-target');

        if (this.draggedItemIndex === null || this.draggedCategoryContainer !== categoryIndex) return;
        if (this.draggedItemIndex === targetIndex) return;

        const items = this.menuData.categories[categoryIndex].items;
        const [movedItem] = items.splice(this.draggedItemIndex, 1);
        items.splice(targetIndex, 0, movedItem);

        this.syncToJSON();
        this.render();
    }
}

// Export for use in dashboard.js
if (typeof window !== 'undefined') {
    window.MenuEditor = MenuEditor;
}
