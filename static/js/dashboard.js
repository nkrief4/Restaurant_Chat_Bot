(function () {
  const OVERVIEW_HISTORY_LIMIT = 6;
  const CHATBOT_HISTORY_LIMIT = 12;

  const state = {
    supabase: null,
    session: null,
    token: null,
    snapshot: null,
    restaurants: [],
    editingId: null,
    isUploadingMenu: false,
    filters: {
      startDate: null,
      endDate: null,
    },
    isFetchingSnapshot: false,
    overview: {
      restaurantId: null,
      restaurantName: "",
      history: [],
      isSending: false,
      hasManualSelection: false,
    },
    chatbot: {
      restaurantId: null,
      restaurantName: "",
      hasManualSelection: false,
      history: [],
      isSending: false,
      sessionId: null,
      hasInteracted: false,
    },
  };

  function forEachNode(list, handler) {
    if (!list || typeof handler !== "function") {
      return;
    }
    for (let index = 0; index < list.length; index += 1) {
      handler(list[index], index);
    }
  }

  async function ensureSupabaseClient() {
    if (state.supabase) {
      return state.supabase;
    }
    if (!window.getSupabaseClient) {
      throw new Error("Supabase non initialisé");
    }
    state.supabase = await window.getSupabaseClient();
    return state.supabase;
  }

  let navigateToSection = () => {};

  document.addEventListener("DOMContentLoaded", () => {
    navigateToSection = setupNavigation();
    setupActionHandlers();
    bindGlobalButtons();
    bindOverviewUI();
    bindChatbotUI();
    setupDateFilters();
    initializeDashboard().catch(handleInitializationError);
  });

  async function initializeDashboard() {
    state.supabase = await ensureSupabaseClient();
    await ensureAuthenticated();
    bindFormEvents();
    setupUploadUI();
    bindProfileForm();
    await refreshDashboardData();

    state.supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        window.location.href = "/login";
        return;
      }
      state.session = session;
      state.token = session.access_token || null;
    });
  }

  function setupNavigation() {
    const sections = document.querySelectorAll(".section");
    const navLinks = document.querySelectorAll(".nav-link");
    const quickLinks = document.querySelectorAll("[data-open-section]");
    const dashboardContainer = document.querySelector(".dashboard");
    const sidebarElement = document.getElementById("dashboard-sidebar");
    const sidebarToggle = document.getElementById("sidebar-toggle");
    const sidebarBackdrop = document.getElementById("sidebar-backdrop");
    const bodyElement = document.body;

    function setSidebarOpen(shouldOpen) {
      if (!dashboardContainer) {
        return;
      }
      const mobileQuery = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(max-width: 1023px)") : null;
      const isMobileViewport = mobileQuery ? mobileQuery.matches : false;
      dashboardContainer.classList.toggle("sidebar-open", Boolean(shouldOpen));
      if (bodyElement && isMobileViewport) {
        bodyElement.classList.toggle("sidebar-overlay-open", Boolean(shouldOpen));
      } else if (bodyElement) {
        bodyElement.classList.remove("sidebar-overlay-open");
      }
      if (sidebarToggle) {
        sidebarToggle.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
      }
      if (sidebarBackdrop) {
        sidebarBackdrop.setAttribute("aria-hidden", shouldOpen ? "false" : "true");
      }
      if (sidebarElement) {
        if (shouldOpen) {
          sidebarElement.removeAttribute("inert");
          sidebarElement.setAttribute("aria-hidden", "false");
        } else if (isMobileViewport) {
          sidebarElement.setAttribute("inert", "");
          sidebarElement.setAttribute("aria-hidden", "true");
        } else {
          sidebarElement.removeAttribute("inert");
          sidebarElement.setAttribute("aria-hidden", "false");
        }
      }
    }

    function toggleSidebar() {
      const isOpen = dashboardContainer ? dashboardContainer.classList.contains("sidebar-open") : false;
      setSidebarOpen(!isOpen);
    }

    function closeSidebar() {
      setSidebarOpen(false);
    }

    if (sidebarToggle) {
      sidebarToggle.addEventListener("click", () => {
        toggleSidebar();
      });
    }

    if (sidebarBackdrop) {
      sidebarBackdrop.addEventListener("click", () => {
        closeSidebar();
      });
    }

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeSidebar();
      }
    });

    const desktopQuery = window.matchMedia("(min-width: 1024px)");
    const syncSidebarAccessibility = (event) => {
      if (event.matches) {
        setSidebarOpen(false);
      } else if (!dashboardContainer || !dashboardContainer.classList.contains("sidebar-open")) {
        setSidebarOpen(false);
      }
    };
    if (typeof desktopQuery.addEventListener === "function") {
      desktopQuery.addEventListener("change", syncSidebarAccessibility);
    } else if (typeof desktopQuery.addListener === "function") {
      desktopQuery.addListener(syncSidebarAccessibility);
    }
    syncSidebarAccessibility(desktopQuery);

    function updateHash(sectionId) {
      if (!sectionId) {
        return;
      }
      const newHash = `#${sectionId}`;
      if (window.location.hash === newHash) {
        return;
      }
      if (window.history && typeof window.history.pushState === "function") {
        window.history.pushState({}, "", newHash);
      } else {
        window.location.hash = newHash;
      }
    }

    function activateSection(sectionId) {
      let targetId = sectionId;
      if (!document.getElementById(targetId)) {
        targetId = "overview";
      }

      forEachNode(sections, (section) => {
        if (section.id === targetId) {
          section.classList.add("active-section");
        } else {
          section.classList.remove("active-section");
        }
      });

      forEachNode(navLinks, (link) => {
        const linkSection = link.dataset ? link.dataset.section : null;
        if (linkSection === targetId) {
          link.classList.add("active");
        } else {
          link.classList.remove("active");
        }
      });
      
      closeSidebar();
      if (dashboardContainer) {
        dashboardContainer.dataset.activeSection = targetId;
      }

      return targetId;
    }

    function showSection(sectionId, options) {
      const activeId = activateSection(sectionId);
      const shouldUpdateHash = !options || options.updateHash !== false;
      if (shouldUpdateHash) {
        updateHash(activeId);
      }
      return activeId;
    }

    function syncFromHash() {
      const rawHash = window.location.hash ? window.location.hash.substring(1) : "";
      if (rawHash) {
        showSection(rawHash, { updateHash: false });
      } else {
        showSection("overview", { updateHash: false });
      }
    }

    forEachNode(navLinks, (link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        const sectionId = link.dataset ? link.dataset.section : null;
        if (sectionId) {
          showSection(sectionId);
        }
      });
    });

    forEachNode(quickLinks, (link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        const sectionId = link.dataset ? link.dataset.openSection : null;
        if (sectionId) {
          showSection(sectionId);
          closeSidebar();
        }
      });
    });

    window.addEventListener("popstate", syncFromHash);
    window.addEventListener("hashchange", syncFromHash);

    syncFromHash();
    return (sectionId) => showSection(sectionId);
  }

  function setupActionHandlers() {
    document.addEventListener("click", (event) => {
      const chatLauncher = event.target.closest("[data-open-chat]");
      if (chatLauncher) {
        event.preventDefault();
        const restaurantId = chatLauncher.dataset ? chatLauncher.dataset.restaurantId : null;
        const restaurantName = chatLauncher.dataset ? chatLauncher.dataset.restaurantName : null;
        launchChatTester(restaurantId, restaurantName);
        return;
      }
      const configureBtn = event.target.closest(".configure-restaurant");
      if (configureBtn) {
        event.preventDefault();
        startEditRestaurant(configureBtn.dataset.restaurantId);
        navigateToSection("edit");
      }
    });
  }

  function bindGlobalButtons() {
    const logoutBtn = document.getElementById("logout-btn");
    if (!logoutBtn) {
      return;
    }

    logoutBtn.addEventListener("click", async (event) => {
      event.preventDefault();
      if (logoutBtn.disabled) {
        return;
      }

      const originalText = logoutBtn.textContent;
      logoutBtn.disabled = true;
      logoutBtn.textContent = "Déconnexion en cours...";

      try {
        const client = await ensureSupabaseClient();
        const { error } = await client.auth.signOut();
        if (error) {
          throw error;
        }
        window.location.href = "/login";
      } catch (error) {
        console.error("Erreur lors de la déconnexion :", error);
        showToast("Erreur lors de la déconnexion. Veuillez réessayer.");
        logoutBtn.disabled = false;
        logoutBtn.textContent = originalText || "Se déconnecter";
      }
    });
  }

  function bindOverviewUI() {
    const select = document.getElementById("overview-restaurant-select");
    if (select) {
      select.addEventListener("change", handleOverviewSelectChange);
    }

    const form = document.getElementById("overview-chat-form");
    if (form) {
      form.addEventListener("submit", handleOverviewChatSubmit);
    }
  }

  function bindChatbotUI() {
    const select = document.getElementById("chatbot-restaurant-select");
    if (select) {
      select.addEventListener("change", handleChatbotSelectChange);
    }

    const form = document.getElementById("chatbot-form");
    if (form) {
      form.addEventListener("submit", handleChatbotSubmit);
    }

    const input = document.getElementById("chatbot-input");
    if (input && form) {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          if (input.disabled) {
            return;
          }
          if (typeof form.requestSubmit === "function") {
            form.requestSubmit();
          } else {
            form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
          }
        }
      });
    }

    updateChatbotEmptyState();
    refreshChatbotFormAvailability();
    setChatbotFeedback("Sélectionnez un restaurant pour lancer la discussion.");
  }

  function setupDateFilters() {
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
      fallbackStart.setDate(today.getDate() - 29);
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
        messageEl.textContent = error || "";
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

  function validateRange(startValue, endValue) {
    if (!startValue || !endValue) {
      return "Veuillez sélectionner deux dates.";
    }
    const startDate = new Date(startValue);
    const endDate = new Date(endValue);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return "Dates invalides.";
    }
    if (startDate > endDate) {
      return "La date de début doit précéder la date de fin.";
    }
    const diff = endDate.getTime() - startDate.getTime();
    const maxDuration = 365 * 24 * 60 * 60 * 1000;
    if (diff > maxDuration) {
      return "La période ne peut pas dépasser 12 mois.";
    }
    return null;
  }

  function formatInputDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  async function ensureAuthenticated() {
    const { data, error } = await state.supabase.auth.getSession();
    if (error || !data?.session) {
      redirectToLogin();
      throw error || new Error("AUTH_REQUIRED");
    }
    state.session = data.session;
    state.token = data.session.access_token || null;
    return data.session.user;
  }

  async function refreshDashboardData(options = {}) {
    const { silent = false } = options;
    if (state.isFetchingSnapshot) {
      return;
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

      updateUIWithUserData(snapshot.user);
      updateProfileFormFields(snapshot.profile);
      syncOverviewStateWithRestaurants();
      syncChatbotStateWithRestaurants();
      updateOverview(snapshot.kpis);
      renderRestaurants();
      renderStatistics(snapshot.statistics);
      renderBilling(snapshot.billing);
    } catch (error) {
      console.error("Snapshot refresh failed", error);
      showToast(error.message || "Impossible de charger vos données.");
      throw error;
    } finally {
      state.isFetchingSnapshot = false;
    }
  }

function updateUIWithUserData(userData) {
  try {
    const safeDetails = userData || {};
    const displayName =
      safeDetails.fullName ||
      safeDetails.full_name ||
      safeDetails.username ||
      (safeDetails.email ? safeDetails.email.split("@")[0] : "");

    const welcomeTitle = document.getElementById("welcome-title");
    if (welcomeTitle) {
      welcomeTitle.textContent = displayName ? `Bonjour, ${displayName}` : "Bonjour";
    }

    const pillName = document.getElementById("user-pill-name");
    if (pillName) {
      pillName.textContent = displayName || "";
    }

    const planLabel = document.getElementById("user-plan-label");
    if (planLabel) {
      planLabel.textContent = safeDetails.plan || "";
    }
  } catch (error) {
    console.error("Erreur lors de la mise à jour de l'interface:", error);
  }
}

function redirectToLogin() {
  // Nettoyage avant redirection
  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

  function bindFormEvents() {
    const forms = document.querySelectorAll(".restaurant-form");
    if (!forms || !forms.length) {
      return;
    }
    
    // Gestion de la sélection d'un restaurant dans le formulaire d'édition
    const restaurantSelector = document.getElementById("edit-restaurant-select");
    const editForm = document.getElementById("restaurant-edit-form");
    
    function updateFormFieldsState(restaurantId) {
      if (!editForm) return;
      
      if (restaurantId) {
        editForm.classList.add('restaurant-selected');
        editForm.classList.remove('is-idle');
      } else {
        editForm.classList.remove('restaurant-selected');
        editForm.classList.add('is-idle');
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

  function setupUploadUI() {
    const cards = document.querySelectorAll(".upload-card");
    if (!cards || !cards.length) {
      return;
    }
    forEachNode(cards, (card) => {
      initUploadCard(card);
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
    const previewInfo = card.querySelector("[data-role='preview-info']");
    const previewImage = card.querySelector("[data-role='preview-image']");
    if (previewInfo && !previewInfo.dataset.defaultText) {
      previewInfo.dataset.defaultText = previewInfo.textContent || "";
    }
    let previewUrl = null;

    const updatePreview = (file) => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = null;
      }
      if (!file) {
        card.classList.remove("has-file");
        if (previewInfo) {
          previewInfo.textContent = previewInfo.dataset.defaultText || "Aucun fichier importé pour le moment.";
        }
        if (previewImage) {
          previewImage.setAttribute("hidden", "true");
          previewImage.removeAttribute("src");
        }
        return;
      }
      if (previewInfo) {
        const sizeLabel = formatFileSize(file.size);
        previewInfo.textContent = sizeLabel ? `${file.name} · ${sizeLabel}` : file.name;
      }
      if (file.type && file.type.startsWith("image/") && previewImage) {
        try {
          previewUrl = URL.createObjectURL(file);
          previewImage.src = previewUrl;
          previewImage.removeAttribute("hidden");
        } catch (error) {
          previewUrl = null;
          previewImage.setAttribute("hidden", "true");
          previewImage.removeAttribute("src");
        }
      } else if (previewImage) {
        previewImage.setAttribute("hidden", "true");
        previewImage.removeAttribute("src");
      }
      card.classList.add("has-file");
    };

    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
      updatePreview(file);
    });

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
        const files = event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files : null;
        if (!files || !files.length) {
          return;
        }
        const file = files[0];
        if (fileInput) {
          try {
            if (typeof DataTransfer !== "undefined") {
              const dataTransfer = new DataTransfer();
              dataTransfer.items.add(file);
              fileInput.files = dataTransfer.files;
            } else {
              fileInput.files = files;
            }
          } catch (error) {
            console.warn("Impossible d'attacher le fichier déposé.", error);
          }
        }
        updatePreview(file);
      });
    }

    const form = card.closest("form");
    if (form) {
      form.addEventListener("reset", () => {
        window.requestAnimationFrame(() => {
          updatePreview(null);
        });
      });
    }

    card.dataset.uploadReady = "true";
  }

  function bindProfileForm() {
    const form = document.getElementById("profile-form");
    if (!form) {
      return;
    }
    form.addEventListener("submit", handleProfileSubmit);
  }

  async function handleProfileSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitBtn = form.querySelector("button[type='submit']");
    const messageEl = document.getElementById("profile-form-message");
    if (messageEl) {
      messageEl.textContent = "";
    }

    const payload = {
      full_name: (document.getElementById("profile-full-name")?.value || "").trim(),
      company_name: (document.getElementById("profile-company")?.value || "").trim(),
      country: (document.getElementById("profile-country")?.value || "").trim(),
      timezone: document.getElementById("profile-timezone")?.value || "",
    };

    const cleanPayload = Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value && typeof value === "string")
    );

    if (!Object.keys(cleanPayload).length) {
      if (messageEl) {
        messageEl.textContent = "Aucune information à mettre à jour.";
      }
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
    }

    try {
      const token = await getAccessToken();
      const response = await fetch("/api/dashboard/profile", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(cleanPayload),
      });

      const payloadResponse = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = payloadResponse && payloadResponse.detail ? payloadResponse.detail : null;
        throw new Error(detail || "Impossible de mettre à jour le profil.");
      }

      if (state.snapshot) {
        state.snapshot.profile = payloadResponse;
        if (state.snapshot.user) {
          state.snapshot.user.fullName = payloadResponse.full_name || state.snapshot.user.fullName;
        }
      }
      updateProfileFormFields(payloadResponse);
      if (state.snapshot?.user) {
        updateUIWithUserData(state.snapshot.user);
      }
      showToast("Profil mis à jour.");
    } catch (error) {
      console.error("Profile update failed", error);
      if (messageEl) {
        messageEl.textContent = error.message || "Erreur lors de la mise à jour.";
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
      }
    }
  }

  function renderRestaurants() {
    const container = document.getElementById("restaurants-card-list");
    const restaurantSelector = document.getElementById("edit-restaurant-select");
    
    if (!container) {
      return;
    }
    
    // Update the restaurant dropdown in the edit form
    if (restaurantSelector) {
      const currentValue = restaurantSelector.value;
      
      // Clear existing options except the first one (placeholder)
      while (restaurantSelector.options.length > 1) {
        restaurantSelector.remove(1);
      }
      
      // Add restaurant options
      const restaurants = Array.isArray(state.restaurants) ? state.restaurants : [];
      restaurants.forEach(restaurant => {
        if (restaurant && restaurant.id) {
          const optionValue = String(restaurant.id);
          const isSelected = state.editingId && optionValue === state.editingId;
          const option = new Option(
            restaurant.display_name || restaurant.name || 'Sans nom',
            optionValue,
            false,
            Boolean(isSelected)
          );
          restaurantSelector.add(option);
        }
      });
      
      // If we're currently editing a restaurant, make sure it's selected
      if (state.editingId) {
        const optionToSelect = Array.from(restaurantSelector.options).find(
          opt => opt.value === state.editingId
        );
        if (optionToSelect) {
          optionToSelect.selected = true;
        }
      } else if (currentValue) {
        // Try to restore previous selection if it still exists
        const optionToSelect = Array.from(restaurantSelector.options).find(
          opt => opt.value === currentValue
        );
        if (optionToSelect) {
          optionToSelect.selected = true;
        }
      }
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

      const header = document.createElement("div");
      header.className = "restaurant-card-header";

      const title = document.createElement("h3");
      title.textContent = restaurant.display_name || "Sans nom";

      const status = document.createElement("span");
      status.className = "status-badge";
      status.textContent = restaurant.slug ? "Connecté" : "À configurer";

      header.append(title, status);

      const identifier = document.createElement("p");
      identifier.className = "muted small";
      identifier.textContent = restaurant.id || "Identifiant non disponible";

      const meta = document.createElement("div");
      meta.className = "restaurant-meta";
      const categoriesCount = countCategories(restaurant.menu_document);
      const lastUpdate = formatTimestamp(restaurant);
      const lastUpdateLabel = lastUpdate && lastUpdate !== "—" ? `Maj : ${lastUpdate}` : "Maj inconnue";
      meta.append(
        buildMetaChip(restaurant.slug ? `${restaurant.slug}` : "Slug non défini"),
        buildMetaChip(
          categoriesCount
            ? `${categoriesCount} section${categoriesCount > 1 ? "s" : ""} de menu`
            : "Menu non importé"
        ),
        buildMetaChip(lastUpdateLabel)
      );

      const actions = document.createElement("div");
      actions.className = "restaurant-card-actions";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "ghost-btn configure-restaurant";
      editBtn.dataset.restaurantId = restaurant.id || "";
      editBtn.textContent = "Configurer";
      editBtn.addEventListener("click", (event) => {
        event.preventDefault();
        if (restaurant.id) {
          startEditRestaurant(restaurant.id);
          navigateToSection("edit");
        }
      });

      const testerBtn = document.createElement("button");
      testerBtn.type = "button";
      testerBtn.className = "secondary-btn";
      testerBtn.dataset.openChat = "true";
      testerBtn.dataset.restaurantId = restaurant.id ? String(restaurant.id) : "";
      testerBtn.dataset.restaurantName = restaurant.display_name || restaurant.name || "";
      testerBtn.textContent = "Tester le chatbot";
      testerBtn.addEventListener("click", (event) => {
        event.preventDefault();
        launchChatTester(restaurant.id, restaurant.display_name || restaurant.name);
      });

      actions.append(editBtn, testerBtn);

      card.append(header, identifier, meta, actions);
      fragment.appendChild(card);
    });

    container.appendChild(fragment);
  }

  function syncOverviewStateWithRestaurants() {
    renderOverviewRestaurantCards();
    populateOverviewRestaurantSelect();
    const restaurants = Array.isArray(state.restaurants) ? state.restaurants : [];

    if (!restaurants.length) {
      state.overview.hasManualSelection = false;
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

  function renderOverviewRestaurantCards() {
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

      const menuMeta = document.createElement("p");
      menuMeta.className = "card-meta";
      const categories = countCategories(restaurant.menu_document);
      menuMeta.textContent = categories
        ? `${categories} section${categories > 1 ? "s" : ""} de menu`
        : "Menu non importé";

      const actions = document.createElement("div");
      actions.className = "card-actions";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "ghost-btn";
      editBtn.textContent = "Configurer";
      editBtn.addEventListener("click", (event) => {
        event.preventDefault();
        if (restaurant.id) {
          startEditRestaurant(restaurant.id);
          navigateToSection("edit");
        }
      });

      const testerBtn = document.createElement("button");
      testerBtn.type = "button";
      testerBtn.className = "secondary-btn";
      testerBtn.textContent = "Tester";
      testerBtn.addEventListener("click", (event) => {
        event.preventDefault();
        launchChatTester(restaurant.id, restaurant.display_name || restaurant.name);
      });

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

  function populateOverviewRestaurantSelect() {
    const select = document.getElementById("overview-restaurant-select");
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
      option.value = restaurant.id || "";
      option.textContent = restaurant.display_name || restaurant.name || "Sans nom";
      select.appendChild(option);
    });

    if (state.overview.restaurantId) {
      select.value = state.overview.restaurantId;
    }
    select.disabled = !restaurants.length || state.overview.isSending;
  }

  function populateChatbotSelect() {
    const select = document.getElementById("chatbot-restaurant-select");
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
      option.value = restaurant && restaurant.id ? String(restaurant.id) : "";
      option.textContent = restaurant.display_name || restaurant.name || "Sans nom";
      select.appendChild(option);
    });

    if (state.chatbot.restaurantId) {
      const match = restaurants.some((restaurant) => String(restaurant.id) === state.chatbot.restaurantId);
      if (match) {
        select.value = state.chatbot.restaurantId;
      } else {
        select.value = "";
      }
    } else {
      select.value = "";
    }

    select.disabled = !restaurants.length;
  }

  function selectOverviewRestaurant(restaurantId, options = {}) {
    const { manual = false } = options;
    const select = document.getElementById("overview-restaurant-select");

    if (!restaurantId) {
      if (select) {
        select.value = "";
      }
      const reset = Boolean(state.overview.restaurantId);
      state.overview.restaurantId = null;
      state.overview.restaurantName = "";
      if (manual) {
        state.overview.hasManualSelection = true;
      } else {
        state.overview.hasManualSelection = false;
      }
      if (reset) {
        state.overview.history = [];
        clearOverviewChatStatus();
        renderOverviewChatMessages();
      }
      updateOverviewChatState();
      highlightOverviewSelection();
      return;
    }

    const record = state.restaurants.find((restaurant) => restaurant.id === restaurantId);
    if (!record) {
      if (manual) {
        state.overview.hasManualSelection = true;
      } else {
        state.overview.hasManualSelection = false;
      }
      if (select) {
        select.value = "";
      }
      state.overview.restaurantId = null;
      state.overview.restaurantName = "";
      state.overview.history = [];
      clearOverviewChatStatus();
      renderOverviewChatMessages();
      updateOverviewChatState();
      highlightOverviewSelection();
      return;
    }

    const changed = state.overview.restaurantId !== record.id;
    state.overview.restaurantId = record.id;
    state.overview.restaurantName = record.display_name || record.name || "";
    if (manual) {
      state.overview.hasManualSelection = true;
    }
    if (changed) {
      state.overview.history = [];
      clearOverviewChatStatus();
      renderOverviewChatMessages();
    }
    if (select) {
      select.value = record.id || "";
    }
    updateOverviewChatState();
    highlightOverviewSelection();
  }

  function handleOverviewSelectChange(event) {
    const target = event.target;
    if (!target) {
      return;
    }
    const restaurantId = target.value || null;
    if (restaurantId) {
      selectOverviewRestaurant(restaurantId, { manual: true });
    } else {
      selectOverviewRestaurant(null, { manual: true });
    }
  }

  function handleChatbotSelectChange(event) {
    const target = event.target;
    if (!target) {
      return;
    }
    const selectedValue = target.value || null;
    if (!selectedValue) {
      const hadSelection = Boolean(state.chatbot.restaurantId);
      state.chatbot.restaurantId = null;
      state.chatbot.restaurantName = "";
      state.chatbot.hasManualSelection = true;
      if (hadSelection) {
        resetChatbotConversation();
      }
      syncChatbotControls();
      setChatbotFeedback("Sélectionnez un restaurant pour lancer la discussion.");
      return;
    }

    const normalizedId = String(selectedValue);
    const record = state.restaurants.find((restaurant) => String(restaurant.id) === normalizedId);
    const previousId = state.chatbot.restaurantId;
    state.chatbot.restaurantId = normalizedId;
    state.chatbot.restaurantName = record?.display_name || record?.name || "";
    state.chatbot.hasManualSelection = true;
    if (previousId !== normalizedId) {
      resetChatbotConversation();
      if (state.chatbot.restaurantName) {
        setChatbotFeedback(`Contexte chargé pour ${state.chatbot.restaurantName}.`);
      } else {
        setChatbotFeedback("Contexte chargé pour le restaurant sélectionné.");
      }
    }
    syncChatbotControls();
    focusChatbotInput();
  }

  function syncChatbotControls() {
    const select = document.getElementById("chatbot-restaurant-select");
    const launchBtn = document.getElementById("chatbot-fullscreen-btn");
    const hasRestaurants = Array.isArray(state.restaurants) && state.restaurants.length > 0;
    const hasSelection = Boolean(state.chatbot.restaurantId);

    if (select) {
      select.disabled = !hasRestaurants;
      if (!hasRestaurants) {
        select.value = "";
      } else if (hasSelection && select.value !== state.chatbot.restaurantId) {
        select.value = state.chatbot.restaurantId;
      } else if (!hasSelection) {
        select.value = "";
      }
    }

    if (launchBtn) {
      launchBtn.disabled = !hasSelection;
      if (hasSelection) {
        launchBtn.dataset.restaurantId = state.chatbot.restaurantId || "";
        launchBtn.dataset.restaurantName = state.chatbot.restaurantName || "";
      } else {
        delete launchBtn.dataset.restaurantId;
        delete launchBtn.dataset.restaurantName;
      }
    }

    let statusMessage = "";
    let isError = false;
    if (!hasRestaurants) {
      statusMessage = "Ajoutez un restaurant pour activer le chatbot.";
      isError = true;
    } else if (!hasSelection) {
      statusMessage = "Sélectionnez un restaurant pour charger son contexte.";
    } else {
      statusMessage = `${state.chatbot.restaurantName || "Votre restaurant"} est prêt à répondre.`;
    }
    setChatbotStatus(statusMessage, isError);

    refreshChatbotFormAvailability();
    updateChatbotEmptyState();
  }

  function syncChatbotStateWithRestaurants() {
    const restaurants = Array.isArray(state.restaurants) ? state.restaurants : [];
    const previousId = state.chatbot.restaurantId ? String(state.chatbot.restaurantId) : null;
    if (!restaurants.length) {
      state.chatbot.restaurantId = null;
      state.chatbot.restaurantName = "";
      state.chatbot.hasManualSelection = false;
      populateChatbotSelect();
      resetChatbotConversation();
      syncChatbotControls();
      setChatbotFeedback("Ajoutez un restaurant pour tester le chatbot.");
      return;
    }

    const normalizedSelection = state.chatbot.restaurantId ? String(state.chatbot.restaurantId) : "";
    const matchingRecord = normalizedSelection
      ? restaurants.find((restaurant) => String(restaurant.id) === normalizedSelection)
      : null;

    if (matchingRecord) {
      state.chatbot.restaurantId = matchingRecord.id ? String(matchingRecord.id) : null;
      state.chatbot.restaurantName = matchingRecord.display_name || matchingRecord.name || "";
    } else if (state.chatbot.hasManualSelection) {
      state.chatbot.restaurantId = null;
      state.chatbot.restaurantName = "";
    } else if (restaurants.length === 1) {
      const fallback = restaurants[0];
      state.chatbot.restaurantId = fallback?.id ? String(fallback.id) : null;
      state.chatbot.restaurantName = fallback?.display_name || fallback?.name || "";
    } else {
      state.chatbot.restaurantId = null;
      state.chatbot.restaurantName = "";
    }

    populateChatbotSelect();
    syncChatbotControls();

    const nextId = state.chatbot.restaurantId ? String(state.chatbot.restaurantId) : null;
    if (previousId !== nextId) {
      resetChatbotConversation();
      if (nextId) {
        if (state.chatbot.restaurantName) {
          setChatbotFeedback(`Contexte chargé pour ${state.chatbot.restaurantName}.`);
        } else {
          setChatbotFeedback("Contexte chargé pour le restaurant sélectionné.");
        }
      } else if (previousId) {
        setChatbotFeedback("Sélectionnez un restaurant pour lancer la discussion.");
      }
    }
  }

  async function handleChatbotSubmit(event) {
    event.preventDefault();
    if (state.chatbot.isSending) {
      return;
    }
    if (!state.chatbot.restaurantId) {
      setChatbotFeedback("Sélectionnez un restaurant avant de discuter.", true);
      return;
    }

    const input = document.getElementById("chatbot-input");
    if (!input) {
      return;
    }
    const message = (input.value || "").trim();
    if (!message) {
      setChatbotFeedback("Votre message ne peut pas être vide.", true);
      return;
    }

    appendChatbotMessage(message, "user");
    input.value = "";

    const historySnapshot = state.chatbot.history.slice(-CHATBOT_HISTORY_LIMIT);
    const pendingUserEntry = { role: "user", content: message };
    const sessionId = ensureChatbotSession();

    setChatbotFeedback("Envoi en cours…");
    state.chatbot.hasInteracted = true;
    setChatbotSending(true);

    try {
      const token = await getAccessToken();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          restaurant_id: state.chatbot.restaurantId,
          message,
          history: historySnapshot,
          session_id: sessionId,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = payload && payload.detail ? payload.detail : null;
        throw new Error(detail || "Impossible d'obtenir une réponse.");
      }

      const reply = (payload && payload.reply ? payload.reply : "").toString().trim() || "Réponse indisponible.";
      const assistantElements = appendChatbotMessage("", "assistant", { skipFormat: true, returnElements: true });
      await streamChatbotReply(assistantElements?.body || null, reply);
      state.chatbot.history.push(pendingUserEntry);
      state.chatbot.history.push({ role: "assistant", content: reply });
      trimChatbotHistory();
      setChatbotFeedback("Réponse générée.");
    } catch (error) {
      console.error("Chatbot request failed", error);
      setChatbotFeedback("Impossible de charger la réponse, réessayez.", true);
    } finally {
      setChatbotSending(false);
    }
  }

  function setChatbotSending(isSending) {
    state.chatbot.isSending = Boolean(isSending);
    refreshChatbotFormAvailability();
    toggleChatbotTyping(isSending);
    if (!state.chatbot.isSending) {
      focusChatbotInput();
    }
  }

  function refreshChatbotFormAvailability() {
    const hasSelection = Boolean(state.chatbot.restaurantId);
    const input = document.getElementById("chatbot-input");
    const sendBtn = document.getElementById("chatbot-send-btn");
    const disabled = !hasSelection || state.chatbot.isSending;
    if (input) {
      input.disabled = disabled;
      input.placeholder = hasSelection
        ? `Message pour ${state.chatbot.restaurantName || "votre restaurant"}…`
        : "Sélectionnez un restaurant pour commencer.";
    }
    if (sendBtn) {
      sendBtn.disabled = disabled;
    }
  }

  function toggleChatbotTyping(shouldShow) {
    const indicator = document.getElementById("chatbot-typing");
    if (!indicator) {
      return;
    }
    const visible = Boolean(shouldShow && state.chatbot.restaurantId && state.chatbot.hasInteracted);
    indicator.hidden = !visible;
    indicator.setAttribute("aria-hidden", (!visible).toString());
  }

  function updateChatbotEmptyState() {
    const empty = document.getElementById("chatbot-empty-state");
    const thread = document.getElementById("chatbot-thread");
    if (!empty || !thread) {
      return;
    }
    const hasMessages = thread.children.length > 0;
    empty.hidden = hasMessages;
    if (!hasMessages) {
      const baseMessage = state.chatbot.restaurantId
        ? `Discutez avec ${state.chatbot.restaurantName || "votre restaurant"}.`
        : "Sélectionnez un restaurant puis dites bonjour à votre assistant.";
      empty.innerHTML = `<p>${escapeHtml(baseMessage)}</p>`;
    }
  }

  function appendChatbotMessage(text, role, options = {}) {
    const feed = document.getElementById("chatbot-thread");
    if (!feed) {
      return;
    }
    const bubble = document.createElement("div");
    const resolvedRole = role === "assistant" ? "assistant" : "user";
    bubble.className = `chatbot-bubble ${resolvedRole}`;

    const author = document.createElement("span");
    author.className = "chatbot-author";
    author.textContent = resolvedRole === "assistant" ? "RestauBot" : "Vous";

    const body = document.createElement("div");
    body.className = "chatbot-text";
    const rawText = (text || "").toString();
    if (options.skipFormat) {
      body.textContent = rawText;
    } else if (rawText) {
      body.innerHTML = formatChatbotMessage(rawText);
    }

    bubble.append(author, body);
    feed.appendChild(bubble);
    feed.scrollTop = feed.scrollHeight;
    updateChatbotEmptyState();
    if (options.returnElements) {
      return { bubble, body };
    }
    return null;
  }

  function streamChatbotReply(target, text) {
    return streamFormattedContent(target, text, formatChatbotMessage);
  }

  // Animate the assistant reply so it feels streamed, even when received in one payload.
  function streamFormattedContent(target, text, formatter) {
    return new Promise((resolve) => {
      if (!target) {
        resolve();
        return;
      }
      const fullText = (text || "").toString();
      if (!fullText) {
        target.classList.remove("is-streaming");
        target.innerHTML = typeof formatter === "function" ? formatter("") : "";
        resolve();
        return;
      }

      const characters = Array.from(fullText);
      const chunkSize = 4;
      const baseDelay = 18;
      let index = 0;
      let buffer = "";

      target.classList.add("is-streaming");
      target.textContent = "";

      const writeNextChunk = () => {
        const nextChunk = characters.slice(index, index + chunkSize).join("");
        buffer += nextChunk;
        target.textContent = buffer;
        index += chunkSize;
        if (index < characters.length) {
          const jitter = Math.random() * 40;
          window.setTimeout(writeNextChunk, baseDelay + jitter);
        } else {
          target.classList.remove("is-streaming");
          if (typeof formatter === "function") {
            target.innerHTML = formatter(buffer);
          } else {
            target.textContent = buffer;
          }
          resolve();
        }
      };

      writeNextChunk();
    });
  }

  function formatChatbotMessage(text) {
    const safe = escapeHtml(text);
    const blocks = safe.split(/\n{2,}/g).map((block) => {
      const withBreaks = block.replace(/\n/g, "<br />");
      return `<p>${withBreaks}</p>`;
    });
    return blocks.join("") || `<p>${safe}</p>`;
  }

  function escapeHtml(value) {
    return (value || "")
      .toString()
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function resetChatbotConversation() {
    state.chatbot.history = [];
    state.chatbot.isSending = false;
    state.chatbot.hasInteracted = false;
    resetChatbotSession();
    const thread = document.getElementById("chatbot-thread");
    if (thread) {
      thread.innerHTML = "";
    }
    toggleChatbotTyping(false);
    refreshChatbotFormAvailability();
    updateChatbotEmptyState();
    setChatbotFeedback("");
  }

  function setChatbotFeedback(message, isError = false) {
    const target = document.getElementById("chatbot-feedback");
    if (!target) {
      return;
    }
    const resolved = message || "";
    target.textContent = resolved;
    target.classList.toggle("error", Boolean(isError && resolved));
  }

  function setChatbotStatus(message, isError = false) {
    const hint = document.getElementById("chatbot-selection-hint");
    if (!hint) {
      return;
    }
    const resolved = message || "Sélectionnez un restaurant pour activer le chatbot.";
    hint.textContent = resolved;
    hint.classList.toggle("error", Boolean(isError));
  }

  function focusChatbotInput() {
    const input = document.getElementById("chatbot-input");
    if (input && !input.disabled) {
      input.focus();
    }
  }

  function ensureChatbotSession() {
    if (!state.chatbot.sessionId) {
      state.chatbot.sessionId = createChatbotSessionId();
    }
    return state.chatbot.sessionId;
  }

  function createChatbotSessionId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    const random = Math.random().toString(16).slice(2, 10);
    return `${Date.now().toString(36)}-${random}`;
  }

  function resetChatbotSession() {
    state.chatbot.sessionId = null;
  }

  function trimChatbotHistory() {
    const maxEntries = CHATBOT_HISTORY_LIMIT * 2;
    if (state.chatbot.history.length > maxEntries) {
      state.chatbot.history = state.chatbot.history.slice(-maxEntries);
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
      container.hidden = true;
      return;
    }
    empty.hidden = true;
    container.hidden = false;
    history.forEach((entry) => {
      const role = entry.role === "assistant" ? "assistant" : "user";
      const bubble = document.createElement("div");
      bubble.className = `chat-preview-message ${role}`;

      const avatar = document.createElement("span");
      avatar.className = "chat-preview-avatar";
      avatar.textContent = role === "assistant" ? "RB" : "Vous";

      const content = document.createElement("div");
      content.className = "chat-preview-content";

      const author = document.createElement("span");
      author.className = "chat-preview-author";
      author.textContent = role === "assistant" ? "RestauBot" : "Vous";

      const text = document.createElement("div");
      text.className = "chat-preview-text";
      text.textContent = entry.content || "";

      content.append(author, text);
      bubble.append(avatar, content);
      container.appendChild(bubble);
    });
    container.scrollTop = container.scrollHeight;
  }

  function updateOverviewChatState() {
    const hasRestaurant = Boolean(state.overview.restaurantId);
    const hasOptions = Array.isArray(state.restaurants) && state.restaurants.length > 0;
    const select = document.getElementById("overview-restaurant-select");
    if (select) {
      select.disabled = !hasOptions || state.overview.isSending;
      if (hasRestaurant && select.value !== state.overview.restaurantId) {
        select.value = state.overview.restaurantId || "";
      }
      if (!hasRestaurant && !state.overview.isSending) {
        select.value = "";
      }
    }
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
        : "Sélectionnez un restaurant pour activer l'aperçu.";
    }
    if (!hasRestaurant) {
      clearOverviewChatStatus();
    }
  }

  async function handleOverviewChatSubmit(event) {
    event.preventDefault();
    if (state.overview.isSending) {
      return;
    }
    if (!state.overview.restaurantId) {
      const statusEl = document.getElementById("overview-chat-status");
      if (statusEl) {
        statusEl.textContent = "Sélectionnez un restaurant avant d'envoyer un message.";
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

    const payloadHistory = state.overview.history.slice(-OVERVIEW_HISTORY_LIMIT);
    state.overview.history.push({ role: "user", content: message });
    trimOverviewHistory();
    renderOverviewChatMessages();
    if (input) {
      input.value = "";
    }

    state.overview.isSending = true;
    updateOverviewChatState();
    if (statusEl) {
      statusEl.textContent = "Envoi en cours…";
    }

    try {
      const token = await getAccessToken();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
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
        state.overview.history.push({ role: "assistant", content: reply });
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
      state.overview.isSending = false;
      updateOverviewChatState();
    }
  }

  function trimOverviewHistory() {
    const maxEntries = OVERVIEW_HISTORY_LIMIT * 2;
    if (state.overview.history.length > maxEntries) {
      state.overview.history = state.overview.history.slice(-maxEntries);
    }
  }

  function clearOverviewChatStatus() {
    const statusEl = document.getElementById("overview-chat-status");
    if (statusEl) {
      statusEl.textContent = "";
    }
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

  function countCategories(menuDocument) {
    const parsed = normalizeMenuDocument(menuDocument);
    if (!parsed || !Array.isArray(parsed.categories)) {
      return 0;
    }
    return parsed.categories.length;
  }

  function buildMetaChip(text) {
    const chip = document.createElement("span");
    chip.textContent = text || "—";
    return chip;
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

  function updateOverview(kpis) {
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

    const busiestEntries = Array.isArray(kpis.busiest)
      ? kpis.busiest
      : kpis.busiest_restaurants
        ? kpis.busiest_restaurants.map((entry) => ({
            name: entry.display_name || entry.name,
            count: entry.conversations || entry.count || 0,
          }))
        : null;
    updateBusiestSections(busiestEntries);
  }

  function renderConversationChart(timeline) {
    const container = document.getElementById("overview-conversation-chart");
    if (!container) {
      return;
    }

    const entries = Array.isArray(timeline) && timeline.length ? timeline : [];
    const fallback = entries.length ? entries : Array.from({ length: 10 }, () => ({ label: "", count: 0 }));
    const maxValue = fallback.reduce((acc, entry) => {
      const value = typeof entry.count === "number" ? entry.count : entry.conversations || 0;
      return Math.max(acc, value);
    }, 0)
      || 1;

    container.innerHTML = "";
    fallback.forEach((entry) => {
      const bar = document.createElement("span");
      const rawValue = typeof entry.count === "number" ? entry.count : entry.conversations || 0;
      const value = Number.isFinite(rawValue) ? rawValue : 0;
      const height = Math.max(6, Math.round((value / maxValue) * 100));
      bar.style.height = `${height}%`;
      const label = entry.label || entry.date || "";
      bar.title = label ? `${label} · ${value}` : `${value}`;
      container.appendChild(bar);
    });
  }

  function renderStatistics(statistics) {
    if (!statistics) {
      setTextContent("stats-total-conversations", "—");
      setTextContent("stats-total-messages", "—");
      setTextContent("stats-average-per-day", "—");
      setTextContent("stats-average-messages", "—");
      setTextContent("stats-resolution-rate", "—");
      setTextContent("statistics-range-label", "Aucune donnée");
      renderTopQuestions([]);
      renderDietBreakdown([]);
      updateBusiestSections(null);
      return;
    }
    setTextContent("stats-total-conversations", formatNumber(statistics.total_conversations));
    setTextContent("stats-total-messages", formatNumber(statistics.total_messages));
    setTextContent("stats-average-per-day", formatNumber(statistics.average_per_day));
    setTextContent(
      "stats-average-messages",
      typeof statistics.average_messages === "number"
        ? statistics.average_messages.toFixed(1)
        : "—"
    );
    const resolution = typeof statistics.resolution_rate === "number" ? `${statistics.resolution_rate}%` : "—";
    setTextContent("stats-resolution-rate", resolution);
    setTextContent("statistics-range-label", formatRangeText(statistics.date_range));
    renderTopQuestions(statistics.top_questions);
    renderDietBreakdown(statistics.diet_breakdown);
    updateBusiestSections(statistics.busiest);
  }

  function renderTopQuestions(topQuestions) {
    const list = document.getElementById("stats-top-questions");
    if (!list) {
      return;
    }
    list.innerHTML = "";
    const entries = Array.isArray(topQuestions) && topQuestions.length ? topQuestions : null;
    if (!entries) {
      const row = document.createElement("li");
      row.textContent = "Pas encore de conversations analysées.";
      list.appendChild(row);
      return;
    }
    entries.forEach((question) => {
      const row = document.createElement("li");
      const label = question.label || "Autres";
      row.textContent = `${label} — ${formatNumber(question.count || 0)}`;
      list.appendChild(row);
    });
  }

  function renderDietBreakdown(breakdown) {
    const container = document.getElementById("stats-diet-breakdown");
    if (!container) {
      return;
    }
    container.innerHTML = "";
    const entries = Array.isArray(breakdown) && breakdown.length ? breakdown : null;
    if (!entries) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "Aucune donnée diététique disponible.";
      container.appendChild(empty);
      return;
    }
    const total = entries.reduce((acc, entry) => acc + (entry.count || 0), 0) || 1;
    entries.forEach((entry) => {
      const segment = document.createElement("div");
      segment.className = "diet-segment";
      const percent = Math.round(((entry.count || 0) / total) * 100);
      segment.dataset.value = `${percent}%`;
      segment.textContent = entry.label || "";
      segment.style.setProperty("--value", `${percent}%`);
      container.appendChild(segment);
    });
  }

  function renderBilling(billing) {
    if (!billing) {
      return;
    }
    const plan = billing.plan || {};
    setTextContent("billing-plan-name", plan.name || "Plan Pro");
    setTextContent("billing-plan-description", plan.description || "");
    const nextPayment = billing.next_payment ? `Prochain prélèvement le ${formatDate(billing.next_payment)}` : "";
    setTextContent("billing-next-payment", nextPayment || "Prochain prélèvement non programmé");
    renderBillingHistory(billing.history);
  }

  function renderBillingHistory(history) {
    const tbody = document.getElementById("billing-history-body");
    if (!tbody) {
      return;
    }
    tbody.innerHTML = "";
    const entries = Array.isArray(history) && history.length ? history : null;
    if (!entries) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 4;
      cell.textContent = "Aucun paiement enregistré.";
      row.appendChild(cell);
      tbody.appendChild(row);
      return;
    }
    entries.forEach((entry) => {
      const tr = document.createElement("tr");
      const dateCell = document.createElement("td");
      dateCell.textContent = formatDate(entry.date);
      const descCell = document.createElement("td");
      descCell.textContent = entry.description || "—";
      const amountCell = document.createElement("td");
      amountCell.textContent = formatCurrency(entry.amount, entry.currency);
      const statusCell = document.createElement("td");
      const badge = document.createElement("span");
      const statusRaw = (entry.status || "paid").toString().toLowerCase();
      badge.className = `status ${statusRaw}`;
      badge.textContent = statusRaw === "paid" ? "Payé" : statusRaw.charAt(0).toUpperCase() + statusRaw.slice(1);
      statusCell.appendChild(badge);
      tr.append(dateCell, descCell, amountCell, statusCell);
      tbody.appendChild(tr);
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

  function formatDate(value) {
    if (!value) {
      return "—";
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }
    return parsed.toLocaleDateString("fr-FR");
  }

  function formatCurrency(amount, currency = "EUR") {
    if (typeof amount !== "number") {
      return amount || "—";
    }
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
    }).format(amount);
  }

  function formatRangeText(range) {
    if (!range || !range.start || !range.end) {
      return "Période non définie";
    }
    const start = new Date(range.start);
    const end = new Date(range.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return "Période non définie";
    }
    const startLabel = start.toLocaleDateString("fr-FR");
    const endLabel = end.toLocaleDateString("fr-FR");
    if (startLabel === endLabel) {
      return `Le ${startLabel}`;
    }
    return `Du ${startLabel} au ${endLabel}`;
  }

  function updateProfileFormFields(details) {
    const data = details || {};
    const nameInput = document.getElementById("profile-full-name");
    if (nameInput) {
      nameInput.value = data.full_name || data.fullName || "";
    }
    const emailInput = document.getElementById("profile-email");
    if (emailInput) {
      emailInput.value = data.email || "";
      emailInput.readOnly = true;
    }
    const companyInput = document.getElementById("profile-company");
    if (companyInput) {
      companyInput.value = data.company_name || data.company || "";
    }
    const countryInput = document.getElementById("profile-country");
    if (countryInput) {
      countryInput.value = data.country || "";
    }
    const timezoneSelect = document.getElementById("profile-timezone");
    if (timezoneSelect) {
      const timezoneValue = data.timezone || "Europe/Paris";
      if (timezoneValue) {
        timezoneSelect.value = timezoneValue;
        if (timezoneSelect.value !== timezoneValue) {
          const customOption = document.createElement("option");
          customOption.value = timezoneValue;
          customOption.textContent = timezoneValue;
          customOption.selected = true;
          timezoneSelect.appendChild(customOption);
        }
      } else {
        timezoneSelect.value = "";
        timezoneSelect.selectedIndex = -1;
      }
    }
  }

  function formatNumber(value) {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return "—";
    }
    return new Intl.NumberFormat("fr-FR").format(value);
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

  function startEditRestaurant(id) {
    if (!id) {
      return;
    }
    const normalizedId = String(id);
    const record = state.restaurants.find((restaurant) => String(restaurant.id) === normalizedId);
    if (!record) {
      showToast("Restaurant introuvable.");
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
    if (menuInput) menuInput.value = stringifyMenu(record.menu_document);
    if (submitBtn) submitBtn.textContent = "Mettre à jour le restaurant";
    if (modeLabel) modeLabel.textContent = `Édition — ${record.display_name || "Restaurant"}`;
    if (messageEl) messageEl.textContent = "";
  }
  function resetRestaurantForm(form) {
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
      const selector = document.getElementById("edit-restaurant-select");
      if (selector) {
        selector.value = "";
      }
      state.editingId = null;
      form.classList.add("is-idle");
      form.classList.remove("restaurant-selected");
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

    if (submitBtn) {
      submitBtn.disabled = true;
    }
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

      showToast(isEdit ? "Restaurant mis à jour." : "Restaurant créé.");
      await refreshDashboardData();
      if (isEdit && state.editingId) {
        startEditRestaurant(state.editingId);
      } else {
        resetRestaurantForm(form);
      }
    } catch (error) {
      console.error("Restaurant form submission failed", error);
      if (messageEl) {
        messageEl.textContent = error.message || "Impossible d'enregistrer ces informations.";
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
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
    const file = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
    if (!file) {
      status.textContent = "Sélectionnez un fichier avant de lancer l'analyse.";
      return;
    }

    state.isUploadingMenu = true;
    if (trigger) {
      trigger.disabled = true;
      setAIButtonState(trigger, true);
    }
    status.textContent = "Analyse du menu en cours…";

    try {
      const token = await getAccessToken();
      const formData = new FormData();
      formData.append("file", file);
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
      const menuField = form.querySelector("[name='menu_document']");
      if (menuField) {
        menuField.value = stringifyMenu(menuDocument);
      }
      status.textContent = "Menu importé. Vérifiez puis sauvegardez.";
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

  async function getAccessToken() {
    if (state.token) {
      return state.token;
    }
    const { data, error } = await state.supabase.auth.getSession();
    const token = data && data.session ? data.session.access_token : null;
    if (error || !token) {
      throw new Error("Session expirée. Merci de vous reconnecter.");
    }
    state.session = data.session;
    state.token = token;
    return token;
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

  function launchChatTester(restaurantId, restaurantName) {
    const available = Array.isArray(state.restaurants) ? state.restaurants : [];
    if (!restaurantId && !available.length) {
      showToast("Ajoutez un restaurant pour tester le chatbot.");
      return;
    }

    const normalizedId = restaurantId ? String(restaurantId) : "";
    let target = normalizedId
      ? available.find((entry) => String(entry.id) === normalizedId)
      : null;
    if (!target && normalizedId) {
      target = available.find((entry) => entry.id);
    }
    if (!target && available.length) {
      target = available[0];
    }
    if (!target) {
      showToast("Impossible de trouver un restaurant à tester.");
      return;
    }

    const resolvedName = restaurantName || target.display_name || target.name || "Restaurant";
    const url = new URL("/chat", window.location.origin);
    if (target.id) {
      url.searchParams.set("restaurant_id", target.id);
    }
    if (resolvedName) {
      url.searchParams.set("restaurant_name", resolvedName);
    }
    window.open(url.toString(), "_blank", "noopener");
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) {
      return;
    }
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => {
      toast.classList.remove("show");
    }, 2500);
  }

  function handleInitializationError(error) {
    console.error("Dashboard failed to initialize", error);
    if (error && error.code === "AUTH_REQUIRED") {
      window.location.href = "/login";
      return;
    }
    showToast("Impossible de charger le dashboard.");
    const tbody = document.getElementById("restaurants-table-body");
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="5">Chargement impossible. Veuillez réessayer.</td></tr>`;
    }
  }

  function formatTimestamp(record) {
    const keys = ["updated_at", "updatedAt", "created_at", "inserted_at", "createdAt"];
    for (const key of keys) {
      if (!record) {
        break;
      }
      const value = record[key];
      if (value) {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
          return parsed.toLocaleString("fr-FR");
        }
      }
    }
    return "—";
  }
})();
