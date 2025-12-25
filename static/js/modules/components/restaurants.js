// Cache buster: v2
import { state } from "../core/state.js";
import { forEachNode } from "../utils/dom.js";
import { getAccessToken } from "../core/auth.js";
import { openQrModal } from "./chatbot.js";

// --- Tab Management ---

const restaurantTabsRuntime = {
    container: null,
    buttons: [],
    panels: [],
    indicator: null,
    panelsWrapper: null,
    resizeObserver: null,
};

export function setupRestaurantTabs() {
    const container = document.querySelector("[data-restaurant-tabs]");
    if (!container) {
        return;
    }
    restaurantTabsRuntime.container = container;
    restaurantTabsRuntime.buttons = Array.from(container.querySelectorAll("[data-restaurant-tab]")) || [];
    restaurantTabsRuntime.panels = Array.from(container.querySelectorAll("[data-tab-panel]")) || [];
    restaurantTabsRuntime.indicator = container.querySelector("[data-tab-indicator]");
    restaurantTabsRuntime.panelsWrapper = container.querySelector(".restaurant-panels");

    restaurantTabsRuntime.buttons.forEach((button, index) => {
        button.addEventListener("click", () => {
            const target = button.dataset ? button.dataset.restaurantTab : null;
            setRestaurantManagementTab(target || "create", { focus: true });
        });
        button.addEventListener("keydown", (event) => {
            if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
                return;
            }
            event.preventDefault();
            const direction = event.key === "ArrowRight" ? 1 : -1;
            const total = restaurantTabsRuntime.buttons.length;
            if (!total) {
                return;
            }
            const nextIndex = (index + direction + total) % total;
            const nextButton = restaurantTabsRuntime.buttons[nextIndex];
            if (nextButton) {
                const target = nextButton.dataset ? nextButton.dataset.restaurantTab : null;
                setRestaurantManagementTab(target || "create", { focus: true });
            }
        });
    });

    if (typeof ResizeObserver !== "undefined" && restaurantTabsRuntime.container) {
        restaurantTabsRuntime.resizeObserver = new ResizeObserver(() => {
            const activeButton = restaurantTabsRuntime.buttons.find((button) => {
                return (button.dataset ? button.dataset.restaurantTab : null) === state.restaurantForms.activeTab;
            });
            if (activeButton) {
                moveRestaurantTabIndicator(activeButton, { immediate: true });
            }
        });
        restaurantTabsRuntime.resizeObserver.observe(restaurantTabsRuntime.container);
    } else {
        window.addEventListener("resize", () => {
            const activeButton = restaurantTabsRuntime.buttons.find((button) => {
                return (button.dataset ? button.dataset.restaurantTab : null) === state.restaurantForms.activeTab;
            });
            if (activeButton) {
                moveRestaurantTabIndicator(activeButton, { immediate: true });
            }
        });
    }

    // Read initial tab from HTML or default to edit
    const initialTab = restaurantTabsRuntime.panelsWrapper?.dataset?.activeTab || "edit";
    setRestaurantManagementTab(state.restaurantForms.activeTab || initialTab, { immediate: true });
}

export function setRestaurantManagementTab(tabName, options = {}) {
    const requested = tabName === "edit" ? "edit" : "create";
    state.restaurantForms.activeTab = requested;
    if (!restaurantTabsRuntime.panelsWrapper) {
        return requested;
    }
    restaurantTabsRuntime.panelsWrapper.dataset.activeTab = requested;
    restaurantTabsRuntime.panels.forEach((panel) => {
        const isActive = panel.dataset ? panel.dataset.tabPanel === requested : false;
        panel.setAttribute("aria-hidden", isActive ? "false" : "true");
    });
    restaurantTabsRuntime.buttons.forEach((button) => {
        const value = button.dataset ? button.dataset.restaurantTab : null;
        const isActive = value === requested;
        button.classList.toggle("is-active", Boolean(isActive));
        button.setAttribute("aria-selected", isActive ? "true" : "false");
        button.setAttribute("tabindex", isActive ? "0" : "-1");
        if (isActive) {
            if (options.focus) {
                button.focus();
            }
            moveRestaurantTabIndicator(button, options);
        }
    });

    // Sync edit form with global selection if switching to edit tab
    if (requested === "edit") {
        const globalId = state.overview.restaurantId;
        if (globalId) {
            startEditRestaurant(globalId);
        } else {
            const form = document.getElementById("restaurant-edit-form");
            resetRestaurantForm(form);
        }
    }

    return requested;
}

function moveRestaurantTabIndicator(targetButton, options = {}) {
    if (!targetButton || !restaurantTabsRuntime.indicator) {
        return;
    }
    const { immediate = false } = options;
    const indicator = restaurantTabsRuntime.indicator;
    const tabList = targetButton.parentElement;
    const styles = tabList ? window.getComputedStyle(tabList) : null;
    const paddingLeft = styles ? parseFloat(styles.paddingLeft) || 0 : 0;
    const offset = targetButton.offsetLeft - paddingLeft;
    if (immediate) {
        indicator.style.transition = "none";
    }
    indicator.style.width = `${targetButton.offsetWidth}px`;
    indicator.style.transform = `translateX(${offset}px)`;
    if (immediate) {
        indicator.getBoundingClientRect();
        indicator.style.transition = "";
    }
}

export function goToRestaurantManagement(tabName = "create", options = {}) {
    document.dispatchEvent(new CustomEvent('navigate', { detail: { section: "manage-restaurants" } }));
    setRestaurantManagementTab(tabName, { focus: options.focus !== false });
}

// --- Form Management ---

export function bindFormEvents() {
    const forms = document.querySelectorAll(".restaurant-form");
    if (!forms || !forms.length) {
        return;
    }

    // Gestion de la sélection d'un restaurant dans le formulaire d'édition
    const restaurantSelector = document.getElementById("edit-restaurant-select");
    const editForm = document.getElementById("restaurant-edit-form");

    function updateFormFieldsState(restaurantId) {
        if (!editForm) return;

        const formModeMessage = editForm.closest('.restaurant-panel')?.querySelector('.panel-intro .form-mode');

        if (restaurantId) {
            editForm.classList.add('restaurant-selected');
            editForm.classList.remove('is-idle');
            if (formModeMessage) formModeMessage.style.display = 'none';
        } else {
            editForm.classList.remove('restaurant-selected');
            editForm.classList.add('is-idle');
            if (formModeMessage) formModeMessage.style.display = '';
        }
    }

    if (restaurantSelector) {
        // Mettre à jour l'état initial
        updateFormFieldsState(restaurantSelector.value);

        restaurantSelector.addEventListener("change", async (event) => {
            const restaurantId = event.target.value;
            if (restaurantId) {
                // Trouver le restaurant sélectionné
                const restaurant = state.restaurants.find(r => String(r.id) === restaurantId);
                if (restaurant) {
                    // Mettre à jour le formulaire avec les données du restaurant
                    const nameInput = editForm?.querySelector("[name='display_name']");
                    const slugInput = editForm?.querySelector("[name='slug']");
                    const menuInput = editForm?.querySelector("[name='menu_document']");
                    const modeLabel = editForm?.querySelector("[data-role='form-mode']");

                    if (nameInput) nameInput.value = restaurant.display_name || "";
                    if (slugInput) slugInput.value = restaurant.slug || "";
                    if (menuInput) menuInput.value = stringifyMenu(restaurant.menu_document || {});
                    if (modeLabel) {
                        modeLabel.textContent = `Édition — ${restaurant.display_name || "Restaurant"}`;
                    }

                    // Sync MenuEditor if it exists
                    const editorWrapper = editForm?.querySelector("[data-role='menu-editor-wrapper']");
                    if (editorWrapper && editorWrapper.menuEditorInstance) {
                        editorWrapper.menuEditorInstance.syncFromJSON();
                        editorWrapper.menuEditorInstance.render();
                    }

                    // Mettre à jour l'état du formulaire
                    updateFormFieldsState(restaurantId);
                    state.editingId = restaurantId;
                }
            } else {
                if (editForm) {
                    resetRestaurantForm(editForm);
                    updateFormFieldsState(null);
                }
            }
        });
    }
    forEachNode(forms, (form) => {
        form.addEventListener("submit", handleRestaurantFormSubmit);
        const resetBtn = form.querySelector("[data-action='reset-form']");
        if (resetBtn) {
            resetBtn.addEventListener("click", (event) => {
                event.preventDefault();
                resetRestaurantForm(form);
            });
        }
        const uploadBtn = form.querySelector("[data-action='upload-menu']");
        if (uploadBtn) {
            uploadBtn.addEventListener("click", (event) => handleMenuUpload(event, form));
        }
    });
}

export function startEditRestaurant(id) {
    if (!id) {
        return;
    }
    const normalizedId = String(id);
    const record = state.restaurants.find((restaurant) => String(restaurant.id) === normalizedId);
    if (!record) {
        // showToast("Restaurant introuvable."); // Circular dep with ui.js? showToast is in ui.js?
        // We can dispatch an event for toast
        document.dispatchEvent(new CustomEvent('showToast', { detail: { message: "Restaurant introuvable." } }));
        return;
    }
    state.editingId = normalizedId;
    const form = document.getElementById("restaurant-edit-form");
    if (!form) {
        return;
    }
    form.classList.remove("is-idle");
    form.classList.add("restaurant-selected");
    const selector = document.getElementById("edit-restaurant-select");
    if (selector && selector.value !== normalizedId) {
        selector.value = normalizedId;
    }

    const nameInput = form.querySelector("[name='display_name']");
    const slugInput = form.querySelector("[name='slug']");
    const menuInput = form.querySelector("[name='menu_document']");
    const submitBtn = form.querySelector("[data-role='submit-btn']");
    const modeLabel = form.querySelector("[data-role='form-mode']");
    const messageEl = form.querySelector("[data-role='form-message']");

    if (nameInput) nameInput.value = record.display_name || "";
    if (slugInput) slugInput.value = record.slug || "";
    if (menuInput) {
        menuInput.value = stringifyMenu(record.menu_document);

        // Refresh the visual editor
        const editorWrapper = form.querySelector("[data-role='menu-editor-wrapper']");
        if (editorWrapper && editorWrapper.menuEditorInstance) {
            editorWrapper.menuEditorInstance.syncFromJSON();
            editorWrapper.menuEditorInstance.render();
        }
    }
    if (submitBtn) submitBtn.textContent = "Mettre à jour le restaurant";
    if (modeLabel) modeLabel.textContent = `Édition — ${record.display_name || "Restaurant"}`;
    if (messageEl) messageEl.textContent = "";
}

export function resetRestaurantForm(form) {
    if (!form) {
        return;
    }

    // Réinitialiser les champs du formulaire
    if (typeof form.reset === "function") {
        form.reset();
    }

    // Réinitialiser les messages d'état
    const messageEl = form.querySelector("[data-role='form-message']");
    if (messageEl) {
        messageEl.textContent = "";
    }

    // Réinitialiser le statut d'upload
    const uploadStatus = form.querySelector("[data-role='menu-upload-status']");
    if (uploadStatus) {
        uploadStatus.textContent = "";
    }

    // Réinitialiser le bouton de soumission
    const submitBtn = form.querySelector("[data-role='submit-btn']");
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = form.dataset.formType === "edit"
            ? "Mettre à jour le restaurant"
            : "Enregistrer le restaurant";
    }

    // Mettre à jour le libellé du mode
    const modeLabel = form.querySelector("[data-role='form-mode']");
    if (modeLabel) {
        modeLabel.textContent = form.dataset.formType === "edit"
            ? "Aucun restaurant sélectionné pour édition."
            : "Création d'un nouvel établissement.";
    }

    // Nettoyer l'aperçu du fichier s'il existe
    const previewInfo = form.querySelector("[data-role='preview-info']");
    const previewImage = form.querySelector("[data-role='preview-image']");
    if (previewInfo && previewInfo.dataset.defaultText) {
        previewInfo.textContent = previewInfo.dataset.defaultText;
    }
    if (previewImage) {
        previewImage.src = "";
        previewImage.style.display = "none";
    }

    // Gestion spécifique au formulaire d'édition
    if (form.dataset.formType === "edit") {
        state.editingId = null;
        form.classList.add("is-idle");
        form.classList.remove("restaurant-selected");
    }

    // Refresh the visual editor
    const editorWrapper = form.querySelector("[data-role='menu-editor-wrapper']");
    if (editorWrapper && editorWrapper.menuEditorInstance) {
        // Small delay to ensure form reset has propagated
        setTimeout(() => {
            editorWrapper.menuEditorInstance.syncFromJSON();
            editorWrapper.menuEditorInstance.render();
        }, 0);
    }
}

async function handleRestaurantFormSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitBtn = form.querySelector("[data-role='submit-btn']");
    const messageEl = form.querySelector("[data-role='form-message']");
    if (messageEl) {
        messageEl.textContent = "";
    }
    const formType = form.dataset.formType || "create";
    const isEdit = formType === "edit";
    if (isEdit && !state.editingId) {
        if (messageEl) {
            messageEl.textContent = "Sélectionnez un restaurant à éditer depuis la section Restaurants.";
        }
        return;
    }

    const { payload, error } = collectFormData(form);
    if (error) {
        if (messageEl) {
            messageEl.textContent = error;
        }
        return;
    }

    let originalText = "";
    if (submitBtn) {
        originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.classList.add('is-loading');
    }

    let success = false;

    try {
        const token = await getAccessToken();
        const endpoint = isEdit && state.editingId
            ? `/api/dashboard/restaurants/${state.editingId}`
            : "/api/dashboard/restaurants";
        const method = isEdit ? "PUT" : "POST";

        const response = await fetch(endpoint, {
            method,
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
        });

        const payloadResponse = await response.json().catch(() => ({}));
        if (!response.ok) {
            const detail = payloadResponse && payloadResponse.detail ? payloadResponse.detail : null;
            throw new Error(detail || "Impossible d'enregistrer ces informations.");
        }

        success = true;

        // Update local state immediately to reflect changes without waiting for refresh
        if (payloadResponse && payloadResponse.id) {
            if (isEdit) {
                const index = state.restaurants.findIndex(r => String(r.id) === String(payloadResponse.id));
                if (index !== -1) {
                    state.restaurants[index] = payloadResponse;
                }
            } else {
                state.restaurants.push(payloadResponse);
            }
        }

        document.dispatchEvent(new CustomEvent('showToast', { detail: { message: isEdit ? "Restaurant mis à jour." : "Restaurant créé." } }));
        document.dispatchEvent(new CustomEvent('dashboard:refresh'));

        if (isEdit && state.editingId) {
            startEditRestaurant(state.editingId);
        } else {
            resetRestaurantForm(form);
        }

        if (submitBtn) {
            submitBtn.classList.remove('is-loading');
            submitBtn.classList.add('is-success');
            submitBtn.textContent = "Sauvegardé !";

            setTimeout(() => {
                submitBtn.classList.remove('is-success');
                submitBtn.textContent = originalText;
                submitBtn.disabled = false;
            }, 2000);
        }
    } catch (error) {
        console.error("Restaurant form submission failed", error);
        if (messageEl) {
            messageEl.textContent = error.message || "Impossible d'enregistrer ces informations.";
        }
    } finally {
        if (!success && submitBtn) {
            submitBtn.disabled = false;
            submitBtn.classList.remove('is-loading');
        }
    }
}

function collectFormData(form) {
    const nameInput = form.querySelector("[name='display_name']");
    const slugInput = form.querySelector("[name='slug']");
    const menuInput = form.querySelector("[name='menu_document']");

    const displayName = nameInput && nameInput.value ? nameInput.value.trim() : "";
    const slug = slugInput && slugInput.value ? slugInput.value.trim() : "";
    const menuRaw = menuInput && menuInput.value ? menuInput.value.trim() : "";

    if (!displayName || !slug) {
        return { error: "Le nom et le slug sont obligatoires." };
    }

    let menuDocument = null;
    if (menuRaw) {
        try {
            menuDocument = JSON.parse(menuRaw);
        } catch (error) {
            return { error: "Le menu structuré doit être un JSON valide." };
        }
    }

    return {
        payload: {
            display_name: displayName,
            slug,
            menu_document: menuDocument,
        },
    };
}

function stringifyMenu(menuDocument) {
    const parsed = normalizeMenuDocument(menuDocument);
    if (!parsed) {
        return "";
    }
    try {
        return JSON.stringify(parsed, null, 2);
    } catch (error) {
        return "";
    }
}

function normalizeMenuDocument(menuDocument) {
    if (!menuDocument) {
        return null;
    }
    if (typeof menuDocument === "object") {
        return menuDocument;
    }
    try {
        return JSON.parse(menuDocument);
    } catch (error) {
        return null;
    }
}

export function countCategories(menuDocument) {
    const parsed = normalizeMenuDocument(menuDocument);
    if (!parsed || !Array.isArray(parsed.categories)) {
        return 0;
    }
    return parsed.categories.length;
}

function formatTimestamp(restaurant) {
    // Helper for renderRestaurants
    // Assuming this was used in renderRestaurants but I need to check where it came from.
    // It was used in line 3322.
    // I need to implement it or find it.
    // It wasn't in the snippets I read? Wait, I missed it?
    // Let's check line 3322 in previous view.
    // Yes, `const lastUpdate = formatTimestamp(restaurant);`
    // I need to find `formatTimestamp`.
    // It might be a utility.
    // I'll add a simple implementation or search for it.
    if (!restaurant || !restaurant.updated_at) return "—";
    return new Date(restaurant.updated_at).toLocaleDateString("fr-FR");
}

export function renderRestaurants() {
    const container = document.getElementById("restaurants-card-list");
    if (!container) {
        return;
    }

    const restaurants = Array.isArray(state.restaurants) ? state.restaurants : [];
    container.innerHTML = "";

    if (!restaurants.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.innerHTML =
            "<p class=\"muted\">Ajoutez un restaurant pour commencer à entraîner RestauBot.</p>";
        container.appendChild(empty);
        return;
    }

    const fragment = document.createDocumentFragment();
    restaurants.forEach((restaurant) => {
        const card = document.createElement("article");
        card.className = "restaurant-card";

        // Track mouse position for spotlight effect
        card.addEventListener("mousemove", (e) => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            card.style.setProperty("--mouse-x", `${x}px`);
            card.style.setProperty("--mouse-y", `${y}px`);
        });

        // Header
        const header = document.createElement("div");
        header.className = "restaurant-card-header";

        const title = document.createElement("h3");
        title.textContent = restaurant.display_name || "Sans nom";

        const status = document.createElement("span");
        status.className = "status-badge";
        status.textContent = restaurant.slug ? "Connecté" : "À configurer";
        if (!restaurant.slug) {
            status.classList.add("inactive");
        }

        header.append(title, status);

        // Restaurant info section
        const infoSection = document.createElement("div");
        infoSection.className = "restaurant-info";

        // Slug info
        const slugInfo = document.createElement("div");
        slugInfo.className = "info-item";
        slugInfo.innerHTML = `
      <div class="info-icon">🔗</div>
      <div class="info-content">
        <div class="info-label">Identifiant</div>
        <div class="info-value">${restaurant.slug || "Non défini"}</div>
      </div>
    `;

        // Menu sections count
        const categoriesCount = countCategories(restaurant.menu_document);
        const menuInfo = document.createElement("div");
        menuInfo.className = "info-item";
        menuInfo.innerHTML = `
      <div class="info-icon">📋</div>
      <div class="info-content">
        <div class="info-label">Menu</div>
        <div class="info-value">${categoriesCount ? `${categoriesCount} section${categoriesCount > 1 ? 's' : ''}` : "Non importé"}</div>
      </div>
    `;

        // Last update
        const lastUpdate = formatTimestamp(restaurant);
        const updateInfo = document.createElement("div");
        updateInfo.className = "info-item";
        updateInfo.innerHTML = `
      <div class="info-icon">📅</div>
      <div class="info-content">
        <div class="info-label">Dernière mise à jour</div>
        <div class="info-value">${lastUpdate && lastUpdate !== "—" ? lastUpdate : "Inconnue"}</div>
      </div>
    `;

        infoSection.append(slugInfo, menuInfo, updateInfo);

        // Actions
        const actions = document.createElement("div");
        actions.className = "restaurant-card-actions";

        const qrBtn = document.createElement("button");
        qrBtn.type = "button";
        qrBtn.className = "ghost-btn";
        qrBtn.innerHTML = "📱 QR Code";
        qrBtn.addEventListener("click", (event) => {
            event.preventDefault();
            openQrModal(restaurant, event.currentTarget);
        });

        const configBtn = document.createElement("button");
        configBtn.type = "button";
        configBtn.className = "ghost-btn configure-restaurant";
        configBtn.dataset.restaurantId = restaurant.id || "";
        configBtn.innerHTML = "⚙️ Configurer";
        configBtn.addEventListener("click", (event) => {
            event.preventDefault();
            if (restaurant.id) {
                startEditRestaurant(restaurant.id);
                goToRestaurantManagement("edit");
            }
        });

        const chatBtn = document.createElement("button");
        chatBtn.type = "button";
        chatBtn.className = "secondary-btn";
        chatBtn.dataset.openChat = "true";
        chatBtn.dataset.restaurantId = restaurant.id ? String(restaurant.id) : "";
        chatBtn.dataset.restaurantName = restaurant.display_name || restaurant.name || "";
        chatBtn.innerHTML = "🤖 Tester";

        actions.append(qrBtn, configBtn, chatBtn);

        card.append(header, infoSection, actions);
        fragment.appendChild(card);
    });

    container.appendChild(fragment);
}

// --- Menu Upload ---

function setAIButtonState(button, isAnalyzing) {
    if (!button) {
        return;
    }
    button.classList.toggle("is-analyzing", Boolean(isAnalyzing));
    const label = button.querySelector("[data-role='ai-btn-label']");
    if (label) {
        if (!label.dataset.defaultText) {
            label.dataset.defaultText = label.textContent || "Analyser avec l'IA";
        }
        label.textContent = isAnalyzing ? "Analyse en cours…" : label.dataset.defaultText;
    }
}

async function handleMenuUpload(event, scopedForm) {
    event.preventDefault();
    const trigger = event.currentTarget;
    const form = scopedForm || (trigger && trigger.closest ? trigger.closest("form") : null);
    if (!form) {
        return;
    }
    const fileInput = form.querySelector("[data-role='menu-file']");
    const status = form.querySelector("[data-role='menu-upload-status']");
    if (!status || !fileInput) {
        return;
    }
    if (state.isUploadingMenu) {
        status.textContent = "Une autre analyse est en cours. Patientez quelques secondes.";
        return;
    }

    const files = fileInput.files ? Array.from(fileInput.files) : [];
    if (!files.length) {
        status.textContent = "Sélectionnez au moins un fichier avant de lancer l'analyse.";
        return;
    }

    state.isUploadingMenu = true;
    if (trigger) {
        trigger.disabled = true;
        setAIButtonState(trigger, true);
    }

    const isMultiple = files.length > 1;
    status.textContent = isMultiple
        ? `Analyse de ${files.length} fichiers en cours…`
        : "Analyse du menu en cours…";

    try {
        const token = await getAccessToken();
        const formData = new FormData();

        if (isMultiple) {
            // Upload multiple files
            files.forEach(file => {
                formData.append("files", file);
            });

            const response = await fetch("/api/restaurants/menu/from-multiple-uploads", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
                body: formData,
            });

            const payload = await response.json().catch(() => ({}));
            const detailMessage = payload && payload.detail ? payload.detail : null;
            if (!response.ok) {
                throw new Error(detailMessage || "Impossible d'analyser ces menus.");
            }

            const { menu_document: menuDocument } = payload || {};
            applyMenuDocumentToForm(form, menuDocument);
            status.textContent = `${files.length} fichiers importés et fusionnés. Vérifiez puis sauvegardez.`;
        } else {
            // Upload single file (use existing endpoint)
            formData.append("file", files[0]);

            const response = await fetch("/api/restaurants/menu/from-upload", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
                body: formData,
            });

            const payload = await response.json().catch(() => ({}));
            const detailMessage = payload && payload.detail ? payload.detail : null;
            if (!response.ok) {
                throw new Error(detailMessage || "Impossible d'analyser ce menu.");
            }

            const { menu_document: menuDocument } = payload || {};
            applyMenuDocumentToForm(form, menuDocument);
            status.textContent = "Menu importé. Vérifiez puis sauvegardez.";
        }
    } catch (error) {
        console.error("Menu upload failed", error);
        status.textContent = error.message || "Erreur lors de l'analyse.";
    } finally {
        state.isUploadingMenu = false;
        if (trigger) {
            trigger.disabled = false;
            setAIButtonState(trigger, false);
        }
    }
}

function applyMenuDocumentToForm(form, menuDocument) {
    const menuField = form.querySelector("[name='menu_document']");
    if (!menuField) {
        return;
    }
    menuField.value = stringifyMenu(menuDocument);

    const editorWrapper = form.querySelector("[data-role='menu-editor-wrapper']");
    const editor = editorWrapper && editorWrapper.menuEditorInstance ? editorWrapper.menuEditorInstance : null;
    if (editor) {
        // Keep the textarea as the source of truth, then refresh the visual editor.
        editor.syncFromJSON();
        editor.render();
    }
}

export function setupUploadUI() {
    const cards = document.querySelectorAll(".upload-card");
    if (!cards || !cards.length) {
        return;
    }
    forEachNode(cards, (card) => {
        initUploadCard(card);
    });
}

export function setupMenuEditors() {
    const editorWrappers = document.querySelectorAll("[data-role='menu-editor-wrapper']");
    if (!editorWrappers || !editorWrappers.length) {
        return;
    }

    forEachNode(editorWrappers, (wrapper) => {
        const textarea = wrapper.querySelector("[name='menu_document']");
        if (!textarea) return;

        // Initialize MenuEditor
        if (typeof window.MenuEditor !== 'undefined') {
            const editor = new window.MenuEditor(wrapper, textarea);

            // Store editor instance on the wrapper for later access
            wrapper.menuEditorInstance = editor;

            // Sync to JSON before form submission
            const form = wrapper.closest('form');
            if (form) {
                form.addEventListener('submit', () => {
                    if (editor) {
                        editor.syncToJSON();
                    }
                });
            }
        }
    });
}

function initUploadCard(card) {
    if (!card || card.dataset.uploadReady === "true") {
        return;
    }
    const fileInput = card.querySelector("[data-role='menu-file']");
    if (!fileInput) {
        return;
    }
    const dropzone = card.querySelector("[data-role='menu-dropzone']");
    const gallery = card.querySelector("[data-role='files-gallery']");
    const isMultiple = fileInput.hasAttribute("multiple");

    // Store files array on the card element
    card.uploadedFiles = [];
    card.previewUrls = [];

    // Function to render the files gallery
    const renderFilesGallery = () => {
        if (!gallery) return;

        const files = card.uploadedFiles || [];

        if (files.length === 0) {
            gallery.innerHTML = "";
            gallery.classList.remove("has-files");
            card.classList.remove("has-multiple-files");
            return;
        }

        gallery.classList.add("has-files");
        card.classList.add("has-multiple-files");
        gallery.innerHTML = "";

        files.forEach((file, index) => {
            const fileCard = document.createElement("div");
            fileCard.className = "file-preview-card";
            fileCard.draggable = true;
            fileCard.dataset.fileIndex = index;

            // Position badge
            const position = document.createElement("div");
            position.className = "file-preview-position";
            position.textContent = index + 1;

            // Thumbnail
            const thumbnail = document.createElement("div");
            thumbnail.className = "file-preview-thumbnail";

            if (file.type && file.type.startsWith("image/")) {
                const img = document.createElement("img");
                const url = URL.createObjectURL(file);
                card.previewUrls.push(url);
                img.src = url;
                img.alt = file.name;
                thumbnail.appendChild(img);
            } else {
                thumbnail.classList.add("no-preview");
                thumbnail.textContent = "📄";
            }

            // File info
            const info = document.createElement("div");
            info.className = "file-preview-info";

            const name = document.createElement("div");
            name.className = "file-preview-name";
            name.textContent = file.name;
            name.title = file.name;

            const meta = document.createElement("div");
            meta.className = "file-preview-meta";
            const sizeLabel = formatFileSize(file.size);
            meta.textContent = sizeLabel || "—";

            info.appendChild(name);
            info.appendChild(meta);

            // Remove button
            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "file-preview-remove";
            removeBtn.innerHTML = "×";
            removeBtn.title = "Supprimer ce fichier";
            removeBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                handleFileRemove(index);
            });

            // Drag handle (visual only)
            const dragHandle = document.createElement("div");
            dragHandle.className = "file-preview-drag-handle";
            dragHandle.innerHTML = "⋮⋮";
            dragHandle.title = "Glisser pour réorganiser";

            fileCard.appendChild(position);
            fileCard.appendChild(thumbnail);
            fileCard.appendChild(info);
            fileCard.appendChild(removeBtn);
            fileCard.appendChild(dragHandle);

            // Drag and drop for reordering
            fileCard.addEventListener("dragstart", (e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", index);
                fileCard.classList.add("is-dragging");
            });

            fileCard.addEventListener("dragend", () => {
                fileCard.classList.remove("is-dragging");
                document.querySelectorAll(".file-preview-card").forEach(c => {
                    c.classList.remove("drop-target");
                });
            });

            fileCard.addEventListener("dragover", (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                fileCard.classList.add("drop-target");
            });

            fileCard.addEventListener("dragleave", () => {
                fileCard.classList.remove("drop-target");
            });

            fileCard.addEventListener("drop", (e) => {
                e.preventDefault();
                fileCard.classList.remove("drop-target");
                const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
                const toIndex = index;
                if (fromIndex !== toIndex) {
                    handleFileReorder(fromIndex, toIndex);
                }
            });

            gallery.appendChild(fileCard);
        });
    };

    // Function to remove a file
    const handleFileRemove = (index) => {
        if (card.uploadedFiles && card.uploadedFiles[index]) {
            card.uploadedFiles.splice(index, 1);
            updateFileInput();
            renderFilesGallery();
        }
    };

    // Function to reorder files
    const handleFileReorder = (fromIndex, toIndex) => {
        if (!card.uploadedFiles) return;
        const files = card.uploadedFiles;
        const [movedFile] = files.splice(fromIndex, 1);
        files.splice(toIndex, 0, movedFile);
        updateFileInput();
        renderFilesGallery();
    };

    // Function to update the file input with current files
    const updateFileInput = () => {
        if (!fileInput || !card.uploadedFiles) return;

        try {
            const dataTransfer = new DataTransfer();
            card.uploadedFiles.forEach(file => {
                dataTransfer.items.add(file);
            });
            fileInput.files = dataTransfer.files;
        } catch (error) {
            console.warn("Could not update file input:", error);
        }
    };

    // Handle file input change
    fileInput.addEventListener("change", () => {
        const files = Array.from(fileInput.files || []);

        if (isMultiple) {
            // Check limit
            if (files.length > 5) {
                alert("Vous ne pouvez pas uploader plus de 5 fichiers à la fois.");
                fileInput.value = "";
                return;
            }
            card.uploadedFiles = files;
        } else {
            card.uploadedFiles = files.slice(0, 1);
        }

        renderFilesGallery();
    });

    // Handle drag and drop on dropzone
    if (dropzone) {
        const stopDefault = (event) => {
            event.preventDefault();
            event.stopPropagation();
        };

        ["dragenter", "dragover"].forEach((type) => {
            dropzone.addEventListener(type, (event) => {
                stopDefault(event);
                dropzone.classList.add("is-dragover");
            });
        });

        dropzone.addEventListener("dragleave", (event) => {
            stopDefault(event);
            if (event.relatedTarget && dropzone.contains(event.relatedTarget)) {
                return;
            }
            dropzone.classList.remove("is-dragover");
        });

        dropzone.addEventListener("drop", (event) => {
            stopDefault(event);
            dropzone.classList.remove("is-dragover");
            const files = event.dataTransfer && event.dataTransfer.files ? Array.from(event.dataTransfer.files) : [];
            if (!files.length) {
                return;
            }

            if (isMultiple) {
                if (files.length > 5) {
                    alert("Vous ne pouvez pas uploader plus de 5 fichiers à la fois.");
                    return;
                }
                card.uploadedFiles = files;
            } else {
                card.uploadedFiles = files.slice(0, 1);
            }

            updateFileInput();
            renderFilesGallery();
        });
    }

    const form = card.closest("form");
    if (form) {
        form.addEventListener("reset", () => {
            window.requestAnimationFrame(() => {
                // Revoke all preview URLs
                if (card.previewUrls) {
                    card.previewUrls.forEach(url => URL.revokeObjectURL(url));
                    card.previewUrls = [];
                }
                card.uploadedFiles = [];
                renderFilesGallery();
            });
        });
    }

    card.dataset.uploadReady = "true";
}

function formatFileSize(bytes) {
    if (typeof bytes !== "number" || Number.isNaN(bytes) || bytes <= 0) {
        return "";
    }
    const units = ["octets", "Ko", "Mo", "Go"];
    let size = bytes;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) {
        size /= 1024;
        index += 1;
    }
    const decimals = index === 0 ? 0 : size < 10 ? 1 : 0;
    return `${size.toFixed(decimals)} ${units[index]}`;
}
