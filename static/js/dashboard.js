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
    statistics: {
      startDate: null,
      endDate: null,
      activeRangePreset: 7,
      selectedRestaurants: [],
      availableRestaurants: [],
      isFetching: false,
      hasInitialized: false,
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
    chatTesterWindow: null,
    isLaunchingChat: false,
    restaurantForms: {
      activeTab: "create",
    },
  };

  let overviewConversationChart = null;
  let statsActivityChart = null;
  let chartJsReadyPromise = null;
  let overviewTypingNode = null;
  const OVERVIEW_TYPING_LABEL = "RestauBot est en train d'écrire…";

  const restaurantTabsRuntime = {
    container: null,
    buttons: [],
    panels: [],
    indicator: null,
    panelsWrapper: null,
    resizeObserver: null,
  };

  const CHAT_PAGE_PATH = "/dashboard/chat";
  const CHAT_TESTER_WINDOW_NAME = "restaubot-chat-tester";
  const CHAT_TESTER_WINDOW_FEATURES = "noopener,noreferrer";

  const shareModalState = {
    element: null,
    nameEl: null,
    qrImage: null,
    placeholder: null,
    linkInput: null,
    copyStatus: null,
    copyBtn: null,
    openLinkBtn: null,
    currentUrl: "",
    trigger: null,
    statusTimeout: null,
  };

  const purchasingEmbedRuntime = {
    iframe: null,
    loader: null,
    shell: null,
    resizeObserver: null,
    resizeInterval: null,
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
    setupQrModal();
    bindGlobalButtons();
    bindOverviewUI();
    bindChatbotUI();
    bindStatisticsUI();
    bindPurchasingSectionUI();
    setupRestaurantTabs();
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
      let pendingTab = null;
      if (targetId === "create" || targetId === "edit") {
        pendingTab = targetId === "edit" ? "edit" : "create";
        targetId = "manage-restaurants";
      }
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

      if (pendingTab && targetId === "manage-restaurants") {
        setRestaurantManagementTab(pendingTab, { focus: false });
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
        const targetTab = link.dataset ? link.dataset.openTab : null;
        if (sectionId) {
          const activeId = showSection(sectionId);
          if (activeId === "manage-restaurants" && targetTab) {
            setRestaurantManagementTab(targetTab, { focus: true });
          }
          closeSidebar();
        }
      });
    });

    window.addEventListener("popstate", syncFromHash);
    window.addEventListener("hashchange", syncFromHash);

    syncFromHash();
    return (sectionId) => showSection(sectionId);
  }

  function setupRestaurantTabs() {
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

    setRestaurantManagementTab(state.restaurantForms.activeTab || "create", { immediate: true });
  }

  function setRestaurantManagementTab(tabName, options = {}) {
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

  function goToRestaurantManagement(tabName = "create", options = {}) {
    if (typeof navigateToSection === "function") {
      navigateToSection("manage-restaurants");
    }
    setRestaurantManagementTab(tabName, { focus: options.focus !== false });
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
        goToRestaurantManagement("edit");
      }
    });
  }

  function setupQrModal() {
    const modal = document.getElementById("chatbot-modal");
    if (!modal) {
      return;
    }
    shareModalState.element = modal;
    shareModalState.nameEl = document.getElementById("modal-restaurant-name");
    shareModalState.qrImage = document.getElementById("qr-code-image");
    shareModalState.placeholder = document.getElementById("qr-code-placeholder");
    shareModalState.linkInput = document.getElementById("qr-share-link");
    shareModalState.copyStatus = document.getElementById("qr-copy-status");
    shareModalState.copyBtn = modal.querySelector("[data-action='copy-qr-link']");
    shareModalState.openLinkBtn = modal.querySelector("[data-action='open-qr-link']");

    const closeButtons = modal.querySelectorAll("[data-modal-close]");
    closeButtons.forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        closeQrModal();
      });
    });

    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeQrModal();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isQrModalOpen()) {
        closeQrModal();
      }
    });

    if (shareModalState.copyBtn) {
      shareModalState.copyBtn.addEventListener("click", (event) => {
        event.preventDefault();
        copyQrLinkToClipboard();
      });
    }

    if (shareModalState.openLinkBtn) {
      shareModalState.openLinkBtn.addEventListener("click", (event) => {
        event.preventDefault();
        openQrLinkInNewTab();
      });
    }

    if (shareModalState.qrImage) {
      shareModalState.qrImage.addEventListener("load", () => {
        shareModalState.qrImage.hidden = false;
        hideQrPlaceholder();
      });
      shareModalState.qrImage.addEventListener("error", () => {
        shareModalState.qrImage.hidden = true;
        showQrPlaceholder("Impossible de générer le QR code.");
      });
    }
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

  function bindPurchasingSectionUI() {
    const select = document.getElementById("purchasing-section-restaurant-select");
    if (!select) {
      setupPurchasingEmbed();
      return;
    }
    select.addEventListener("change", (event) => {
      const value = event.target.value || null;
      selectOverviewRestaurant(value || null, { manual: true });
      syncPurchasingSectionSelectValue();
      updatePurchasingIframeSrc(value || null);
    });
    syncPurchasingSectionSelectValue();
    setupPurchasingEmbed();
  }

  function setupPurchasingEmbed() {
    const iframe = document.getElementById("purchasing-iframe");
    if (!iframe) {
      return;
    }
    purchasingEmbedRuntime.iframe = iframe;
    purchasingEmbedRuntime.loader = document.getElementById("purchasing-iframe-loader");
    purchasingEmbedRuntime.shell = document.getElementById("purchasing-iframe-shell");
    setPurchasingIframeLoading(true);
    iframe.addEventListener("load", () => {
      markPurchasingIframeReady();
    });
    if (iframe.contentDocument && iframe.contentDocument.readyState === "complete") {
      markPurchasingIframeReady();
    }
  }

  function markPurchasingIframeReady() {
    setPurchasingIframeLoading(false);
    const iframe = purchasingEmbedRuntime.iframe || document.getElementById("purchasing-iframe");
    if (iframe) {
      iframe.classList.add("is-loaded");
    }
    syncPurchasingIframeHeight();
    attachPurchasingIframeResizeObserver();
  }

  function setPurchasingIframeLoading(isLoading) {
    const loader = purchasingEmbedRuntime.loader || document.getElementById("purchasing-iframe-loader");
    const shell = purchasingEmbedRuntime.shell || document.getElementById("purchasing-iframe-shell");
    if (loader) {
      loader.classList.toggle("is-hidden", !isLoading);
      loader.setAttribute("aria-hidden", isLoading ? "false" : "true");
    }
    if (shell) {
      shell.classList.toggle("is-loading", Boolean(isLoading));
    }
  }

  function syncPurchasingIframeHeight() {
    const iframe = purchasingEmbedRuntime.iframe || document.getElementById("purchasing-iframe");
    if (!iframe) {
      return;
    }
    try {
      const doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
      if (!doc) {
        return;
      }
      const bodyHeight = doc.body ? doc.body.scrollHeight : 0;
      const docHeight = doc.documentElement ? doc.documentElement.scrollHeight : 0;
      const targetHeight = Math.max(760, bodyHeight, docHeight);
      iframe.style.height = `${targetHeight}px`;
    } catch (error) {
      console.warn("Unable to sync purchasing iframe height", error);
    }
  }

  function attachPurchasingIframeResizeObserver() {
    const iframe = purchasingEmbedRuntime.iframe || document.getElementById("purchasing-iframe");
    if (!iframe) {
      return;
    }
    let contentWindow;
    let doc;
    try {
      contentWindow = iframe.contentWindow;
      doc = iframe.contentDocument;
    } catch (error) {
      console.warn("Unable to observe purchasing iframe", error);
      return;
    }
    if (!contentWindow || !doc) {
      return;
    }
    teardownPurchasingIframeObservers();
    const target = doc.body || doc.documentElement;
    const ResizeObserverCtor = contentWindow.ResizeObserver;
    if (target && typeof ResizeObserverCtor === "function") {
      const observer = new ResizeObserverCtor(() => {
        window.requestAnimationFrame(() => {
          syncPurchasingIframeHeight();
        });
      });
      observer.observe(target);
      purchasingEmbedRuntime.resizeObserver = observer;
    } else if (target) {
      purchasingEmbedRuntime.resizeInterval = window.setInterval(() => {
        syncPurchasingIframeHeight();
      }, 1200);
    }
  }

  function teardownPurchasingIframeObservers() {
    if (purchasingEmbedRuntime.resizeObserver && typeof purchasingEmbedRuntime.resizeObserver.disconnect === "function") {
      purchasingEmbedRuntime.resizeObserver.disconnect();
    }
    purchasingEmbedRuntime.resizeObserver = null;
    if (purchasingEmbedRuntime.resizeInterval) {
      window.clearInterval(purchasingEmbedRuntime.resizeInterval);
    }
    purchasingEmbedRuntime.resizeInterval = null;
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

  function bindStatisticsUI() {
    ensureStatsRangeDefaults();
    const rangeButtons = document.querySelectorAll("[data-stats-range]");
    rangeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const days = parseInt(button.dataset.statsRange || "", 10);
        if (!Number.isFinite(days)) {
          return;
        }
        setStatsRangeFromPreset(days);
      });
    });

    const applyButton = document.getElementById("stats-apply-range");
    if (applyButton) {
      applyButton.addEventListener("click", (event) => {
        event.preventDefault();
        handleStatsRangeApply();
      });
    }

    const toggle = document.getElementById("stats-restaurant-toggle");
    if (toggle) {
      toggle.addEventListener("click", () => {
        const panel = document.getElementById("stats-restaurant-panel");
        if (!panel) {
          return;
        }
        if (panel.hasAttribute("hidden")) {
          openStatsRestaurantPanel(panel, toggle);
        } else {
          closeStatsRestaurantPanel(panel, toggle);
        }
      });
    }

    const panel = document.getElementById("stats-restaurant-panel");
    if (panel) {
      panel.addEventListener("click", (event) => {
        const actionBtn = event.target.closest("[data-action]");
        if (actionBtn) {
          handleStatsPanelAction(actionBtn.dataset.action);
          event.preventDefault();
          return;
        }
        const option = event.target.closest("li[data-value]");
        if (option) {
          const value = option.dataset.value;
          toggleStatsRestaurantSelection(value);
        }
      });
    }

    const searchInput = document.getElementById("stats-restaurant-search");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        filterStatsRestaurantOptions(searchInput.value || "");
      });
    }

    document.addEventListener("click", (event) => {
      const panelEl = document.getElementById("stats-restaurant-panel");
      const toggleBtn = document.getElementById("stats-restaurant-toggle");
      if (!panelEl || !toggleBtn) {
        return;
      }
      if (panelEl.hasAttribute("hidden")) {
        return;
      }
      if (panelEl.contains(event.target) || toggleBtn.contains(event.target)) {
        return;
      }
      closeStatsRestaurantPanel(panelEl, toggleBtn);
    });
  }

  function ensureStatsRangeDefaults() {
    const stats = state.statistics;
    if (!stats.startDate || !stats.endDate) {
      const today = new Date();
      const start = new Date(today.getTime());
      start.setDate(today.getDate() - 6);
      stats.startDate = formatInputDate(start);
      stats.endDate = formatInputDate(today);
      stats.activeRangePreset = 7;
    }
    syncStatsRangeInputs();
    highlightStatsPreset();
  }

  function syncStatsRangeInputs() {
    const startInput = document.getElementById("stats-start-date");
    const endInput = document.getElementById("stats-end-date");
    if (startInput && state.statistics.startDate) {
      startInput.value = state.statistics.startDate;
    }
    if (endInput && state.statistics.endDate) {
      endInput.value = state.statistics.endDate;
    }
  }

  function highlightStatsPreset() {
    const preset = state.statistics.activeRangePreset;
    const rangeButtons = document.querySelectorAll("[data-stats-range]");
    rangeButtons.forEach((button) => {
      const value = parseInt(button.dataset.statsRange || "", 10);
      if (preset && value === preset) {
        button.classList.add("active");
      } else {
        button.classList.remove("active");
      }
    });
  }

  function setStatsRangeFromPreset(days) {
    const today = new Date();
    const start = new Date(today.getTime());
    start.setDate(today.getDate() - (days - 1));
    state.statistics.startDate = formatInputDate(start);
    state.statistics.endDate = formatInputDate(today);
    state.statistics.activeRangePreset = days;
    const messageEl = document.getElementById("stats-range-message");
    if (messageEl) {
      messageEl.textContent = "";
    }
    syncStatsRangeInputs();
    highlightStatsPreset();
    fetchStatisticsData();
  }

  function handleStatsRangeApply() {
    const startInput = document.getElementById("stats-start-date");
    const endInput = document.getElementById("stats-end-date");
    const messageEl = document.getElementById("stats-range-message");
    if (!startInput || !endInput) {
      return;
    }
    const startValue = startInput.value;
    const endValue = endInput.value;
    const error = validateRange(startValue, endValue);
    if (messageEl) {
      messageEl.textContent = error ? error.message : "";
    }
    if (error) {
      return;
    }
    state.statistics.startDate = startValue;
    state.statistics.endDate = endValue;
    state.statistics.activeRangePreset = null;
    highlightStatsPreset();
    fetchStatisticsData();
  }

  function handleStatsPanelAction(action) {
    if (!action) {
      return;
    }
    const available = state.statistics.availableRestaurants || [];
    if (action === "select-all") {
      state.statistics.selectedRestaurants = available.map((entry) => entry.id);
      renderStatsRestaurantOptions(available);
      updateStatsSelectionSummary();
      fetchStatisticsData();
      return;
    }
    if (action === "clear-all") {
      state.statistics.selectedRestaurants = [];
      renderStatsRestaurantOptions(available);
      updateStatsSelectionSummary();
    }
  }

  function toggleStatsRestaurantSelection(restaurantId) {
    if (!restaurantId) {
      return;
    }
    const current = state.statistics.selectedRestaurants || [];
    const index = current.indexOf(restaurantId);
    if (index === -1) {
      current.push(restaurantId);
    } else {
      current.splice(index, 1);
    }
    state.statistics.selectedRestaurants = current;
    const available = state.statistics.availableRestaurants || [];
    renderStatsRestaurantOptions(available);
    updateStatsSelectionSummary();
    if (state.statistics.selectedRestaurants.length > 0) {
      fetchStatisticsData();
    }
  }

  function renderStatsRestaurantOptions(restaurants) {
    const list = document.getElementById("stats-restaurant-options");
    if (!list) {
      return;
    }
    list.innerHTML = "";
    if (!restaurants || !restaurants.length) {
      const empty = document.createElement("li");
      empty.className = "muted";
      empty.textContent = "Aucun restaurant disponible.";
      list.appendChild(empty);
      return;
    }
    const selection = state.statistics.selectedRestaurants || [];
    restaurants.forEach((restaurant) => {
      const li = document.createElement("li");
      li.dataset.value = restaurant.id;
      li.setAttribute("role", "option");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selection.includes(restaurant.id);
      checkbox.tabIndex = -1;
      const label = document.createElement("span");
      label.textContent = restaurant.name || "Restaurant";
      li.append(checkbox, label);
      li.setAttribute("aria-selected", checkbox.checked ? "true" : "false");
      list.appendChild(li);
    });
  }

  function updateStatsSelectionSummary() {
    const summary = document.getElementById("stats-selected-summary");
    const hint = document.getElementById("stats-selection-hint");
    const headerLabel = document.getElementById("statistics-selection-label");
    const available = state.statistics.availableRestaurants || [];
    const selected = state.statistics.selectedRestaurants || [];
    const allSelected = selected.length > 0 && selected.length === available.length;
    let label = "Tous les restaurants";
    if (!selected.length) {
      label = "Sélectionnez des restaurants";
    } else if (!allSelected) {
      label = selected.length === 1 ? "1 restaurant" : `${selected.length} restaurants`;
    }
    if (summary) {
      summary.textContent = label;
    }
    if (hint) {
      if (!selected.length) {
        hint.textContent = "Sélectionnez au moins un établissement";
      } else if (allSelected) {
        hint.textContent = "Affichage global";
      } else {
        hint.textContent = `${selected.length} établissement(s) comparé(s)`;
      }
    }
    if (headerLabel) {
      if (!selected.length) {
        headerLabel.textContent = "Aucun établissement sélectionné";
      } else if (selected.length === 1) {
        const names = buildStatsSelectionNames(selected);
        headerLabel.textContent = names[0];
      } else {
        headerLabel.textContent = label;
      }
    }
  }

  function buildStatsSelectionNames(ids) {
    const available = state.statistics.availableRestaurants || [];
    const mapping = available.reduce((acc, entry) => {
      acc[entry.id] = entry.name;
      return acc;
    }, {});
    return ids.map((id) => mapping[id] || "Restaurant");
  }

  function filterStatsRestaurantOptions(query) {
    const list = document.getElementById("stats-restaurant-options");
    if (!list) {
      return;
    }
    const normalized = (query || "").trim().toLowerCase();
    const entries = list.querySelectorAll("li[data-value]");
    entries.forEach((entry) => {
      const label = entry.textContent || "";
      const matches = !normalized || label.toLowerCase().includes(normalized);
      entry.hidden = !matches;
    });
  }

  function openStatsRestaurantPanel(panel, toggle) {
    panel.removeAttribute("hidden");
    toggle.setAttribute("aria-expanded", "true");
  }

  function closeStatsRestaurantPanel(panel, toggle) {
    panel.setAttribute("hidden", "true");
    toggle.setAttribute("aria-expanded", "false");
  }

  function syncStatsRestaurantsFromSnapshot(restaurants) {
    const list = Array.isArray(restaurants) ? restaurants : [];
    const normalized = list
      .map((restaurant) => ({
        id: restaurant && restaurant.id ? String(restaurant.id) : null,
        name: restaurant.display_name || restaurant.name || "Restaurant",
      }))
      .filter((entry) => Boolean(entry.id));
    state.statistics.availableRestaurants = normalized;
    const currentSelection = state.statistics.selectedRestaurants || [];
    const validatedSelection = currentSelection.filter((id) => normalized.some((entry) => entry.id === id));
    if (!state.statistics.hasInitialized && !validatedSelection.length) {
      state.statistics.selectedRestaurants = normalized.map((entry) => entry.id);
    } else {
      state.statistics.selectedRestaurants = validatedSelection;
      if (!state.statistics.selectedRestaurants.length && normalized.length) {
        state.statistics.selectedRestaurants = normalized.map((entry) => entry.id);
      }
    }
    renderStatsRestaurantOptions(normalized);
    updateStatsSelectionSummary();
  }

  function validateRange(startValue, endValue) {
    if (!startValue || !endValue) {
      return { 
        message: "Veuillez sélectionner deux dates.",
        type: "error"
      };
    }
    const startDate = new Date(startValue);
    const endDate = new Date(endValue);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return { 
        message: "Dates invalides.",
        type: "error"
      };
    }
    if (startDate > endDate) {
      return { 
        message: "La date de début doit précéder la date de fin.",
        type: "error"
      };
    }
    const diff = endDate.getTime() - startDate.getTime();
    const maxDuration = 365 * 24 * 60 * 60 * 1000;
    if (diff > maxDuration) {
      return { 
        message: "La période ne peut pas dépasser 12 mois.",
        type: "error"
      };
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

  function persistActiveRestaurantId(restaurantId) {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    try {
      if (restaurantId) {
        window.localStorage.setItem("restaurantId", String(restaurantId));
      } else {
        window.localStorage.removeItem("restaurantId");
      }
    } catch (error) {
      console.warn("Impossible de mémoriser le restaurant actif", error);
    }
    updatePurchasingIframeSrc(restaurantId);
    syncPurchasingSectionSelectValue();
  }

  function setDashboardLoading(isLoading, options = {}) {
    const overlay = document.getElementById("dashboard-loading-overlay");
    const { useOverlay = true } = options;
    const shouldShowOverlay = Boolean(isLoading && useOverlay);

    if (overlay) {
      const hideTimeoutId = overlay.dataset.hideTimeoutId
        ? Number(overlay.dataset.hideTimeoutId)
        : null;
      if (hideTimeoutId) {
        window.clearTimeout(hideTimeoutId);
        delete overlay.dataset.hideTimeoutId;
      }

      if (shouldShowOverlay) {
        overlay.removeAttribute("hidden");
        overlay.classList.remove("is-hidden");
        overlay.setAttribute("aria-hidden", "false");
        overlay.setAttribute("aria-busy", "true");
      } else {
        overlay.classList.add("is-hidden");
        overlay.setAttribute("aria-hidden", "true");
        overlay.setAttribute("aria-busy", "false");
        const timeoutId = window.setTimeout(() => {
          overlay.setAttribute("hidden", "true");
          delete overlay.dataset.hideTimeoutId;
        }, 280);
        overlay.dataset.hideTimeoutId = String(timeoutId);
      }
    }

    if (document && document.body) {
      if (shouldShowOverlay) {
        document.body.classList.add("dashboard-loading");
      } else {
        document.body.classList.remove("dashboard-loading");
      }
    }
  }

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
      syncStatsRestaurantsFromSnapshot(state.restaurants);
      populatePurchasingSectionSelect();

      updateUIWithUserData(snapshot.user);
      updateProfileFormFields(snapshot.profile);
      syncOverviewStateWithRestaurants();
      syncChatbotStateWithRestaurants();
      updateOverview(snapshot.kpis);
      renderRestaurants();
      if (!state.statistics.hasInitialized) {
        renderStatistics(snapshot.statistics);
      }
      renderBilling(snapshot.billing);
      fetchStatisticsData({ silent: Boolean(state.statistics.hasInitialized) });
    } catch (error) {
      console.error("Snapshot refresh failed", error);
      showToast(error.message || "Impossible de charger vos données.");
      throw error;
    } finally {
      state.isFetchingSnapshot = false;
      if (shouldShowOverlay) {
        setDashboardLoading(false, { useOverlay: true });
      }
    }
  }

  async function fetchStatisticsData(options = {}) {
    const { silent = false } = options;
    if (state.statistics.isFetching) {
      return;
    }
    const hasRestaurants = Array.isArray(state.statistics.availableRestaurants)
      ? state.statistics.availableRestaurants.length > 0
      : false;
    const hasSelection = Array.isArray(state.statistics.selectedRestaurants)
      ? state.statistics.selectedRestaurants.length > 0
      : false;
    if (!state.statistics.startDate || !state.statistics.endDate) {
      return;
    }
    if (hasRestaurants && !hasSelection) {
      return;
    }
    const params = new URLSearchParams();
    const requestedRange = {
      start: state.statistics.startDate,
      end: state.statistics.endDate,
    };
    params.set("start_date", state.statistics.startDate);
    params.set("end_date", state.statistics.endDate);
    if (hasSelection && hasRestaurants && state.statistics.selectedRestaurants.length < state.statistics.availableRestaurants.length) {
      state.statistics.selectedRestaurants.forEach((id) => {
        params.append("restaurant_id", id);
      });
    }
    const endpoint = `/api/dashboard/statistics?${params.toString()}`;
    state.statistics.isFetching = true;
    const rangeLabel = document.getElementById("statistics-range-label");
    if (rangeLabel && !silent) {
      rangeLabel.textContent = "Actualisation des statistiques…";
    }
    try {
      const token = await getAccessToken();
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = payload && payload.detail ? payload.detail : "Impossible de charger les statistiques.";
        throw new Error(detail);
      }
      let shouldRefreshOptions = false;
      if (Array.isArray(payload.available_restaurants)) {
        const normalized = payload.available_restaurants
          .map((entry) => ({
            id: entry && entry.id ? String(entry.id) : null,
            name: entry.name || "Restaurant",
          }))
          .filter((entry) => Boolean(entry.id));
        state.statistics.availableRestaurants = normalized;
        const filteredSelection = (state.statistics.selectedRestaurants || []).filter((id) =>
          normalized.some((entry) => entry.id === id),
        );
        if (!filteredSelection.length && normalized.length) {
          state.statistics.selectedRestaurants = normalized.map((entry) => entry.id);
        } else {
          state.statistics.selectedRestaurants = filteredSelection;
        }
        shouldRefreshOptions = true;
      }
      if (Array.isArray(payload.selected_restaurants) && payload.selected_restaurants.length) {
        const sanitized = payload.selected_restaurants
          .map((value) => String(value))
          .filter((id) => state.statistics.availableRestaurants.some((entry) => entry.id === id));
        if (sanitized.length) {
          state.statistics.selectedRestaurants = sanitized;
          shouldRefreshOptions = true;
        }
      }
      if (shouldRefreshOptions) {
        renderStatsRestaurantOptions(state.statistics.availableRestaurants);
        updateStatsSelectionSummary();
      }
      state.statistics.hasInitialized = true;
      renderStatistics(payload.statistics || payload);
    } catch (error) {
      console.error("Statistics fetch failed", error);
      showToast(error.message || "Impossible de charger les statistiques.");
      setTextContent("statistics-range-label", formatRangeText(requestedRange));
    } finally {
      state.statistics.isFetching = false;
    }
  }

function updateUIWithUserData(userData) {
  try {
    const safeDetails = userData || {};
    const firstName = safeDetails.first_name || safeDetails.firstName;
    const lastName = safeDetails.last_name || safeDetails.lastName;
    const combinedName = [firstName, lastName].filter(Boolean).join(" ").trim();
    const displayName =
      combinedName ||
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
    form.addEventListener("reset", () => {
      window.requestAnimationFrame(() => {
        if (state.snapshot?.profile) {
          updateProfileFormFields(state.snapshot.profile);
        } else if (state.snapshot?.user) {
          updateProfileFormFields(state.snapshot.user);
        }
        clearProfileErrors();
        setProfileMessage("");
      });
    });
  }

  async function handleProfileSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitBtn = form.querySelector("button[type='submit']");
    const messageEl = document.getElementById("profile-form-message");
    setProfileMessage("");
    clearProfileErrors();

    const payload = {
      full_name: (document.getElementById("profile-full-name")?.value || "").trim(),
      company_name: (document.getElementById("profile-company")?.value || "").trim(),
      country: (document.getElementById("profile-country")?.value || "").trim(),
      phone_number: (document.getElementById("profile-phone")?.value || "").trim(),
      timezone: document.getElementById("profile-timezone")?.value || "",
    };

    const errors = {};
    if (!payload.full_name) {
      errors.full_name = "Indiquez votre nom complet.";
    }
    if (!payload.phone_number) {
      errors.phone_number = "Le numéro de téléphone est requis.";
    } else if (!isValidPhoneNumber(payload.phone_number)) {
      errors.phone_number = "Entrez un numéro valide (10 à 15 chiffres).";
    }
    if (!payload.timezone) {
      errors.timezone = "Choisissez un fuseau horaire.";
    }

    const cleanPayload = Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value && typeof value === "string")
    );

    if (Object.keys(errors).length) {
      Object.entries(errors).forEach(([key, message]) => setProfileFieldError(key, message));
      setProfileMessage("Merci de corriger les champs en surbrillance.", "error");
      return;
    }

    if (!Object.keys(cleanPayload).length) {
      setProfileMessage("Aucune information à mettre à jour.");
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
          const userDetails = state.snapshot.user;
          userDetails.fullName = payloadResponse.full_name || userDetails.fullName;
          userDetails.first_name = payloadResponse.first_name || userDetails.first_name;
          userDetails.last_name = payloadResponse.last_name || userDetails.last_name;
          userDetails.phone_number = payloadResponse.phone_number || userDetails.phone_number;
          userDetails.timezone = payloadResponse.timezone || userDetails.timezone;
        }
      }
      updateProfileFormFields(payloadResponse);
      if (state.snapshot?.user) {
        updateUIWithUserData(state.snapshot.user);
      }
      setProfileMessage("Profil mis à jour avec succès.", "success");
      showToast("Profil mis à jour.");
    } catch (error) {
      console.error("Profile update failed", error);
      setProfileMessage(error.message || "Erreur lors de la mise à jour.", "error");
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
          goToRestaurantManagement("edit");
        }
      });

      const testerBtn = document.createElement("button");
      testerBtn.type = "button";
      testerBtn.className = "secondary-btn";
      testerBtn.dataset.openChat = "true";
      testerBtn.dataset.restaurantId = restaurant.id ? String(restaurant.id) : "";
      testerBtn.dataset.restaurantName = restaurant.display_name || restaurant.name || "";
      testerBtn.textContent = "Tester le chatbot";

      const shareBtn = document.createElement("button");
      shareBtn.type = "button";
      shareBtn.className = "ghost-btn";
      shareBtn.textContent = "QR clients";
      shareBtn.addEventListener("click", (event) => {
        event.preventDefault();
        openQrModal(restaurant, event.currentTarget);
      });

      actions.append(editBtn, testerBtn, shareBtn);

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
      persistActiveRestaurantId(null);
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
          goToRestaurantManagement("edit");
        }
      });

      const testerBtn = document.createElement("button");
      testerBtn.type = "button";
      testerBtn.className = "secondary-btn";
      testerBtn.textContent = "Tester";
      testerBtn.dataset.openChat = "true";
      testerBtn.dataset.restaurantId = restaurant.id ? String(restaurant.id) : "";
      testerBtn.dataset.restaurantName = restaurant.display_name || restaurant.name || "";

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

  function populatePurchasingSectionSelect() {
    const select = document.getElementById("purchasing-section-restaurant-select");
    if (!select) {
      return;
    }
    const restaurants = Array.isArray(state.restaurants) ? state.restaurants : [];
    const placeholder = '<option value="">Sélectionnez un restaurant</option>';
    if (!restaurants.length) {
      select.innerHTML = placeholder;
      select.disabled = true;
      return;
    }
    const options = restaurants
      .map((restaurant) => {
        const label = restaurant.display_name || restaurant.name || "Restaurant";
        return `<option value="${restaurant.id}">${label}</option>`;
      })
      .join("\n");
    select.innerHTML = `${placeholder}${options}`;
    select.disabled = false;
    syncPurchasingSectionSelectValue();
  }

  function syncPurchasingSectionSelectValue() {
    const select = document.getElementById("purchasing-section-restaurant-select");
    if (!select) {
      return;
    }
    const activeId = state.overview.restaurantId ? String(state.overview.restaurantId) : "";
    if (select.value !== activeId) {
      select.value = activeId;
    }
    select.disabled = !Array.isArray(state.restaurants) || !state.restaurants.length;
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
      persistActiveRestaurantId(null);
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
      persistActiveRestaurantId(null);
      state.overview.history = [];
      clearOverviewChatStatus();
      renderOverviewChatMessages();
      updateOverviewChatState();
      highlightOverviewSelection();
      return;
    }

    const changed = state.overview.restaurantId !== record.id;
    state.overview.restaurantId = record.id;
    persistActiveRestaurantId(record.id);
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

  function updatePurchasingIframeSrc(restaurantId) {
    const iframe = document.getElementById("purchasing-iframe");
    if (!iframe) {
      return;
    }
    const base = "/purchasing";
    const params = new URLSearchParams();
    params.set("embedded", "1");
    if (restaurantId) {
      params.set("restaurant_id", restaurantId);
    }
    const nextSrc = `${base}?${params.toString()}`;
    const currentSrc = iframe.getAttribute("src");
    if (currentSrc === nextSrc) {
      return;
    }
    setPurchasingIframeLoading(true);
    teardownPurchasingIframeObservers();
    iframe.setAttribute("src", nextSrc);
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
    // L'indicateur ne doit apparaître que lorsqu'un message utilisateur est en cours d'envoi.
    const canDisplay = Boolean(shouldShow && state.chatbot.hasInteracted);
    indicator.hidden = !canDisplay;
    indicator.setAttribute("aria-hidden", (!canDisplay).toString());
    indicator.style.display = canDisplay ? "inline-flex" : "none";
    indicator.classList.toggle("is-visible", canDisplay);
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

  function createChatHistoryEntry(role, content) {
    return {
      role: role === "assistant" ? "assistant" : "user",
      content: content || "",
      created_at: new Date().toISOString(),
    };
  }

  function formatChatTimestamp(value) {
    if (!value) {
      return "À l'instant";
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return "À l'instant";
    }
    return parsed.toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function buildOverviewChatMessage(entry, options = {}) {
    const role = entry.role === "assistant" ? "assistant" : "user";
    const bubble = document.createElement("div");
    bubble.className = `chat-preview-message ${role}`;
    if (options.isTyping) {
      bubble.classList.add("typing");
    }

    const avatar = document.createElement("span");
    avatar.className = "chat-preview-avatar";
    avatar.textContent = role === "assistant" ? "RB" : "Vous";

    const content = document.createElement("div");
    content.className = "chat-preview-content";

    const meta = document.createElement("div");
    meta.className = "chat-preview-meta";

    const author = document.createElement("span");
    author.className = "chat-preview-author";
    author.textContent = role === "assistant" ? "RestauBot" : "Vous";

    const timestamp = document.createElement("time");
    timestamp.className = "chat-preview-timestamp";
    const timestampValue = options.timestamp || entry.created_at || null;
    if (timestampValue) {
      timestamp.dateTime = timestampValue;
    }
    timestamp.textContent = formatChatTimestamp(timestampValue);

    meta.append(author, timestamp);

    const text = document.createElement("div");
    text.className = "chat-preview-text";
    if (typeof options.renderText === "function") {
      options.renderText(text);
    } else {
      text.textContent = entry.content || "";
    }

    content.append(meta, text);
    bubble.append(avatar, content);
    return bubble;
  }

  function showOverviewTypingIndicator() {
    if (overviewTypingNode) {
      return;
    }
    const container = document.getElementById("overview-chat-messages");
    if (!container) {
      return;
    }
    const empty = document.getElementById("overview-chat-empty");
    const timestamp = new Date().toISOString();
    overviewTypingNode = buildOverviewChatMessage(
      { role: "assistant", content: OVERVIEW_TYPING_LABEL, created_at: timestamp },
      {
        isTyping: true,
        timestamp,
        renderText(target) {
          const wrapper = document.createElement("div");
          wrapper.className = "chat-preview-typing";

          const label = document.createElement("span");
          label.className = "chat-preview-typing-label";
          label.textContent = OVERVIEW_TYPING_LABEL;

          const dots = document.createElement("span");
          dots.className = "chat-preview-typing-dots";
          for (let index = 0; index < 3; index += 1) {
            const dot = document.createElement("span");
            dot.className = "chat-preview-typing-dot";
            dot.style.animationDelay = `${index * 0.15}s`;
            dots.appendChild(dot);
          }

          wrapper.append(label, dots);
          target.append(wrapper);
        },
      }
    );
    if (empty) {
      empty.hidden = true;
    }
    container.hidden = false;
    container.appendChild(overviewTypingNode);
    requestAnimationFrame(() => {
      if (typeof container.scrollTo === "function") {
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      } else {
        container.scrollTop = container.scrollHeight;
      }
    });
  }

  function hideOverviewTypingIndicator() {
    if (!overviewTypingNode) {
      return;
    }
    if (overviewTypingNode.parentElement) {
      overviewTypingNode.parentElement.removeChild(overviewTypingNode);
    }
    overviewTypingNode = null;
  }

  function buildChatPayloadHistory(history, limit) {
    if (!Array.isArray(history) || history.length === 0) {
      return [];
    }
    const sliceLimit = limit ? -Math.abs(limit) : undefined;
    return history.slice(sliceLimit).map((entry) => ({
      role: entry.role === "assistant" ? "assistant" : "user",
      content: entry.content || "",
    }));
  }

  function renderOverviewChatMessages() {
    const container = document.getElementById("overview-chat-messages");
    const empty = document.getElementById("overview-chat-empty");
    if (!container || !empty) {
      return;
    }
    container.innerHTML = "";
    overviewTypingNode = null;
    const history = state.overview.history.slice(-OVERVIEW_HISTORY_LIMIT * 2);
    if (!history.length) {
      empty.hidden = false;
      container.hidden = true;
      return;
    }
    empty.hidden = true;
    container.hidden = false;
    history.forEach((entry) => {
      const bubble = buildOverviewChatMessage(entry);
      container.appendChild(bubble);
    });
    requestAnimationFrame(() => {
      if (typeof container.scrollTo === "function") {
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      } else {
        container.scrollTop = container.scrollHeight;
      }
    });
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

    const payloadHistory = buildChatPayloadHistory(state.overview.history, OVERVIEW_HISTORY_LIMIT);
    state.overview.history.push(createChatHistoryEntry("user", message));
    trimOverviewHistory();
    renderOverviewChatMessages();
    if (input) {
      input.value = "";
    }

    state.overview.isSending = true;
    updateOverviewChatState();
    showOverviewTypingIndicator();
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
        state.overview.history.push(createChatHistoryEntry("assistant", reply));
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
      hideOverviewTypingIndicator();
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

  async function ensureChartJsLibrary() {
    if (typeof window === "undefined") {
      return null;
    }
    if (typeof window.Chart !== "undefined") {
      return window.Chart;
    }
    if (chartJsReadyPromise) {
      return chartJsReadyPromise;
    }

    chartJsReadyPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector("script[data-chartjs]") || document.querySelector("script[src*='chart.umd']");

      const attachListeners = (script) => {
        if (!script) {
          reject(new Error("CHARTJS_SCRIPT_MISSING"));
          return;
        }
        script.addEventListener(
          "load",
          () => {
            if (typeof window.Chart !== "undefined") {
              resolve(window.Chart);
            } else {
              reject(new Error("CHARTJS_UNAVAILABLE"));
            }
          },
          { once: true },
        );
        script.addEventListener(
          "error",
          () => {
            reject(new Error("CHARTJS_LOAD_FAILED"));
          },
          { once: true },
        );
      };

      if (existingScript) {
        attachListeners(existingScript);
        return;
      }

      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
      script.defer = true;
      script.dataset.chartjs = "true";
      document.head.appendChild(script);
      attachListeners(script);
    })
      .then((lib) => {
        return lib;
      })
      .catch((error) => {
        chartJsReadyPromise = null;
        throw error;
      });

    return chartJsReadyPromise;
  }

  function setConversationEmptyState(isVisible, message) {
    const emptyState = document.getElementById("overview-conversation-empty");
    if (!emptyState) {
      return;
    }
    if (isVisible) {
      emptyState.hidden = false;
      emptyState.style.display = "flex";
      emptyState.setAttribute("aria-hidden", "false");
      if (message) {
        emptyState.textContent = message;
      }
    } else {
      emptyState.hidden = true;
      emptyState.style.display = "none";
      emptyState.setAttribute("aria-hidden", "true");
    }
  }

  async function renderConversationChart(timeline) {
    const canvas = document.getElementById("overview-conversation-chart");
    if (!canvas) {
      return;
    }

    let ChartLib = null;
    try {
      ChartLib = await ensureChartJsLibrary();
    } catch (error) {
      console.error("Chart.js failed to load", error);
      setConversationEmptyState(true, "Graphique indisponible pour le moment.");
      return;
    }

    if (!ChartLib) {
      setConversationEmptyState(true, "Graphique indisponible.");
      return;
    }

    const entries = Array.isArray(timeline) ? timeline.filter(Boolean) : [];
    const hasData = entries.length > 0;
    setConversationEmptyState(!hasData, "Aucune donnée disponible sur cette période.");

    const labels = (hasData ? entries : Array.from({ length: 7 }, () => ({}))).map((entry, index) => {
      const rawLabel = entry.label || entry.date;
      if (rawLabel) {
        return rawLabel;
      }
      return `Jour ${index + 1}`;
    });
    const values = (hasData ? entries : Array.from({ length: labels.length }, () => ({ count: 0 }))).map((entry) => {
      if (!entry) {
        return 0;
      }
      const value = typeof entry.count === "number" ? entry.count : entry.conversations || 0;
      return Number.isFinite(value) ? value : 0;
    });

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const chartData = {
      labels,
      datasets: [
        {
          label: "Conversations",
          data: values,
          backgroundColor: "rgba(58, 117, 255, 0.65)",
          hoverBackgroundColor: "rgba(58, 117, 255, 0.9)",
          borderRadius: 12,
          borderSkipped: false,
          barThickness: values.length > 30 ? 12 : undefined,
        },
      ],
    };

    const chartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 500,
      },
      scales: {
        x: {
          grid: {
            display: false,
          },
          ticks: {
            maxRotation: 0,
            minRotation: 0,
            autoSkip: true,
            color: "#6b7280",
          },
        },
        y: {
          beginAtZero: true,
          ticks: {
            precision: 0,
            color: "#6b7280",
          },
          grid: {
            color: "rgba(15, 23, 42, 0.08)",
            drawBorder: false,
          },
        },
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          callbacks: {
            label(context) {
              const value = context.raw;
              return `${value} conversation${value > 1 ? "s" : ""}`;
            },
          },
        },
      },
    };

    if (overviewConversationChart) {
      overviewConversationChart.data.labels = chartData.labels;
      overviewConversationChart.data.datasets[0].data = chartData.datasets[0].data;
      overviewConversationChart.update();
      setConversationEmptyState(false);
      return;
    }

    overviewConversationChart = new ChartLib(context, {
      type: "bar",
      data: chartData,
      options: chartOptions,
    });
    setConversationEmptyState(false);
  }

  function renderStatistics(statistics) {
    if (!statistics) {
      setTextContent("stats-total-conversations", "—");
      setTextContent("stats-total-messages", "—");
      setTextContent("stats-average-per-day", "—");
      setTextContent("stats-average-messages", "—");
      setTextContent("stats-active-restaurants", "—");
      setTextContent("stats-resolution-rate", "—");
      const fallbackRange = {
        start: state.statistics.startDate,
        end: state.statistics.endDate,
      };
      setTextContent("statistics-range-label", formatRangeText(fallbackRange));
      renderTopQuestions([]);
      renderDietBreakdown([]);
      updateBusiestSections(null);
      renderStatisticsActivityChart([]);
      renderStatsRestaurantBreakdown([]);
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
    const breakdownEntries = Array.isArray(statistics.restaurant_breakdown)
      ? statistics.restaurant_breakdown.filter((entry) => (entry.count || 0) > 0)
      : [];
    const activeCount = breakdownEntries.length
      || state.statistics.selectedRestaurants.length
      || state.statistics.availableRestaurants.length;
    setTextContent("stats-active-restaurants", formatNumber(activeCount || 0));
    renderTopQuestions(statistics.top_questions);
    renderDietBreakdown(statistics.diet_breakdown);
    updateBusiestSections(statistics.busiest);
    renderStatisticsActivityChart(statistics.timeline);
    renderStatsRestaurantBreakdown(statistics.restaurant_breakdown);
  }

  function renderStatisticsActivityChart(timeline) {
    const canvas = document.getElementById("stats-activity-chart");
    const emptyState = document.getElementById("stats-activity-empty");
    if (!canvas || !emptyState) {
      return;
    }
    const normalizedTimeline = normalizeStatisticsTimeline(timeline);
    const hasData = normalizedTimeline.length > 0;
    if (!hasData) {
      if (statsActivityChart) {
        statsActivityChart.destroy();
        statsActivityChart = null;
      }
      emptyState.hidden = false;
      canvas.hidden = true;
      return;
    }
    emptyState.hidden = true;
    canvas.hidden = false;
    ensureChartJsLibrary()
      .then((ChartLib) => {
        const ctx = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
        if (!ctx) {
          return;
        }
        const labels = normalizedTimeline.map((point) => point.label || point.date || "");
        const conversations = normalizedTimeline.map((point) =>
          typeof point.conversations === "number"
            ? point.conversations
            : typeof point.count === "number"
              ? point.count
              : 0,
        );
        const messages = normalizedTimeline.map((point) =>
          typeof point.messages === "number"
            ? point.messages
            : typeof point.total_messages === "number"
              ? point.total_messages
              : typeof point.count === "number"
                ? point.count
                : 0,
        );
        const data = {
          labels,
          datasets: [
            {
              label: "Conversations",
              data: conversations,
              borderColor: "#3a75ff",
              backgroundColor: "rgba(58, 117, 255, 0.18)",
              tension: 0.4,
              fill: true,
              borderWidth: 2,
              pointRadius: 0,
            },
            {
              label: "Messages",
              data: messages,
              borderColor: "#93a5ff",
              backgroundColor: "rgba(147, 165, 255, 0.18)",
              borderWidth: 2,
              pointRadius: 0,
              tension: 0.4,
            },
          ],
        };
        const options = {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              grid: { display: false },
              ticks: {
                autoSkip: true,
                maxTicksLimit: 6,
              },
            },
            y: {
              beginAtZero: true,
              grid: { color: "rgba(148, 163, 184, 0.3)" },
              ticks: {
                precision: 0,
              },
            },
          },
          plugins: {
            legend: {
              display: true,
              position: "bottom",
            },
            tooltip: {
              intersect: false,
              mode: "index",
            },
          },
        };
        if (statsActivityChart && statsActivityChart.canvas !== canvas) {
          statsActivityChart.destroy();
          statsActivityChart = null;
        }
        if (statsActivityChart) {
          statsActivityChart.data = data;
          statsActivityChart.options = options;
          statsActivityChart.update();
        } else {
          statsActivityChart = new ChartLib(ctx, {
            type: "line",
            data,
            options,
          });
        }
      })
      .catch((error) => {
        console.error("Statistics chart rendering failed", error);
      });
  }

  function normalizeStatisticsTimeline(timeline) {
    if (Array.isArray(timeline) && timeline.length) {
      return timeline;
    }
    const overviewTimeline = state.snapshot?.kpis?.timeline;
    if (Array.isArray(overviewTimeline) && overviewTimeline.length) {
      return overviewTimeline.map((point) => ({
        label: point.label || point.date || "",
        date: point.date || point.label || "",
        conversations: typeof point.count === "number" ? point.count : 0,
        messages: typeof point.total_messages === "number" ? point.total_messages : point.count || 0,
      }));
    }
    return [];
  }

  function renderStatsRestaurantBreakdown(breakdown) {
    const list = document.getElementById("stats-restaurant-breakdown");
    if (!list) {
      return;
    }
    list.innerHTML = "";
    const entries = Array.isArray(breakdown) ? breakdown.filter((entry) => (entry.count || 0) > 0) : [];
    if (!entries.length) {
      const empty = document.createElement("li");
      empty.className = "muted";
      empty.textContent = state.statistics.selectedRestaurants.length
        ? "Aucune conversation sur cette période."
        : "Sélectionnez au moins un restaurant.";
      list.appendChild(empty);
      return;
    }
    const totalCount = entries.reduce((acc, entry) => acc + (entry.count || 0), 0) || 1;
    entries.forEach((entry) => {
      const row = document.createElement("li");
      const meta = document.createElement("div");
      meta.className = "stats-breakdown-row";
      const name = document.createElement("span");
      name.textContent = entry.name || "Restaurant";
      const value = document.createElement("strong");
      value.textContent = `${formatNumber(entry.count || 0)} conv.`;
      meta.append(name, value);

      const bar = document.createElement("div");
      bar.className = "stats-breakdown-bar";
      const fill = document.createElement("span");
      const share = typeof entry.share === "number"
        ? entry.share
        : Math.round(((entry.count || 0) / totalCount) * 1000) / 10;
      fill.style.width = `${Math.max(0, share)}%`;
      bar.appendChild(fill);

      const shareLabel = document.createElement("span");
      shareLabel.className = "stats-breakdown-share";
      shareLabel.textContent = `${share.toFixed(1)}%`;

      row.append(meta, bar, shareLabel);
      list.appendChild(row);
    });
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
    const phoneInput = document.getElementById("profile-phone");
    if (phoneInput) {
      phoneInput.value = data.phone_number || "";
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

  function setProfileFieldError(field, message) {
    const target = document.querySelector(`[data-profile-error="${field}"]`);
    if (target) {
      target.textContent = message || "";
    }
    const input = document.getElementById(`profile-${field.replace("_", "-")}`);
    if (input) {
      input.classList.toggle("has-error", Boolean(message));
    }
  }

  function clearProfileErrors() {
    document.querySelectorAll("[data-profile-error]").forEach((el) => {
      el.textContent = "";
    });
    [
      "profile-full-name",
      "profile-phone",
      "profile-timezone",
    ].forEach((id) => {
      const input = document.getElementById(id);
      if (input) {
        input.classList.remove("has-error");
      }
    });
  }

  function setProfileMessage(message, variant) {
    const target = document.getElementById("profile-form-message");
    if (!target) {
      return;
    }
    target.textContent = message || "";
    target.className = "profile-feedback";
    if (variant) {
      target.classList.add(variant);
    }
  }

  function isValidPhoneNumber(value) {
    const trimmed = (value || "").trim();
    const digits = trimmed.replace(/[^0-9]/g, "");
    if (digits.length < 10 || digits.length > 15) {
      return false;
    }
    if (trimmed.startsWith("+33") || trimmed.startsWith("0033")) {
      return digits.length === 11;
    }
    if (digits.startsWith("0")) {
      return digits.length === 10;
    }
    return true;
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
    if (state.isLaunchingChat) {
      return;
    }
    state.isLaunchingChat = true;

    const target = resolveRestaurantRecord(restaurantId);
    if (!target) {
      showToast("Ajoutez un restaurant pour tester le chatbot.");
      state.isLaunchingChat = false;
      return;
    }

    const resolvedName = getRestaurantDisplayName(target, restaurantName);
    const url = buildChatbotPageUrl(target, resolvedName);
    cacheChatLaunchContext(target, resolvedName);
    if (state.chatTesterWindow && !state.chatTesterWindow.closed) {
      try {
        state.chatTesterWindow.location.href = url.toString();
        state.chatTesterWindow.focus();
        return;
      } catch (_error) {
        state.chatTesterWindow = null;
      }
    }

    const newWindow = window.open(url.toString(), CHAT_TESTER_WINDOW_NAME, CHAT_TESTER_WINDOW_FEATURES);
    if (newWindow) {
      state.chatTesterWindow = newWindow;
      newWindow.focus();
    } else {
      showToast("Impossible d'ouvrir le chatbot dans un nouvel onglet. Autorisez les fenêtres pop-up puis réessayez.");
      state.isLaunchingChat = false;
      return;
    }

    window.setTimeout(() => {
      state.isLaunchingChat = false;
    }, 200);
  }

  function cacheChatLaunchContext(restaurant, displayName) {
    if (!restaurant || !restaurant.id || !window.localStorage) {
      return;
    }
    try {
      const payload = {
        id: restaurant.id,
        display_name: displayName || restaurant.display_name || restaurant.name || '',
        name: restaurant.name || '',
        menu_document: restaurant.menu_document || null,
        cached_at: Date.now(),
      };
      window.localStorage.setItem(`restaubot-chat-${restaurant.id}`, JSON.stringify(payload));
    } catch (error) {
      console.warn('Unable to cache chat launch context', error);
    }
  }

  function resolveRestaurantRecord(restaurantId) {
    const restaurants = Array.isArray(state.restaurants) ? state.restaurants : [];
    if (!restaurants.length) {
      return null;
    }
    if (restaurantId) {
      const normalizedId = String(restaurantId);
      const match = restaurants.find((entry) => entry && String(entry.id) === normalizedId);
      if (match) {
        return match;
      }
    }
    return restaurants.find((entry) => entry && entry.id) || restaurants[0] || null;
  }

  function getRestaurantDisplayName(restaurant, fallbackName) {
    if (!restaurant && !fallbackName) {
      return "Restaurant";
    }
    return (restaurant?.display_name || restaurant?.name || fallbackName || "Restaurant").trim();
  }

  function buildChatbotPageUrl(restaurant, fallbackName) {
    const url = new URL(CHAT_PAGE_PATH, window.location.origin);
    if (restaurant?.id) {
      url.searchParams.set("restaurant_id", restaurant.id);
    }
    const name = getRestaurantDisplayName(restaurant, fallbackName);
    if (name) {
      url.searchParams.set("restaurant_name", name);
    }
    return url;
  }

  function openQrModal(restaurant, triggerButton) {
    if (!shareModalState.element) {
      showToast("Impossible d'ouvrir le QR code pour le moment.");
      return;
    }
    const resolvedName = getRestaurantDisplayName(restaurant);
    const shareUrl = buildChatbotPageUrl(restaurant, resolvedName).toString();

    shareModalState.trigger = triggerButton || null;
    shareModalState.currentUrl = shareUrl;

    if (shareModalState.nameEl) {
      shareModalState.nameEl.textContent = resolvedName;
    }
    if (shareModalState.linkInput) {
      shareModalState.linkInput.value = shareUrl;
      shareModalState.linkInput.setAttribute("title", shareUrl);
    }
    updateQrCopyStatus("");
    updateQrVisualWithUrl(shareUrl);

    shareModalState.element.classList.add("open");
    shareModalState.element.setAttribute("aria-hidden", "false");
  }

  function closeQrModal() {
    if (!shareModalState.element) {
      return;
    }
    shareModalState.element.classList.remove("open");
    shareModalState.element.setAttribute("aria-hidden", "true");
    shareModalState.currentUrl = "";
    updateQrCopyStatus("");
    const trigger = shareModalState.trigger;
    shareModalState.trigger = null;
    if (trigger && typeof trigger.focus === "function") {
      window.requestAnimationFrame(() => trigger.focus());
    }
  }

  function isQrModalOpen() {
    return Boolean(
      shareModalState.element &&
        (shareModalState.element.classList.contains("open") || shareModalState.element.getAttribute("aria-hidden") === "false")
    );
  }

  function updateQrVisualWithUrl(url) {
    if (!shareModalState.qrImage) {
      return;
    }
    if (!url) {
      shareModalState.qrImage.hidden = true;
      showQrPlaceholder("Lien du chatbot indisponible.");
      return;
    }
    showQrPlaceholder("QR en préparation…");
    shareModalState.qrImage.hidden = true;
    const encoded = encodeURIComponent(url);
    shareModalState.qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encoded}`;
  }

  function showQrPlaceholder(text) {
    if (!shareModalState.placeholder) {
      return;
    }
    shareModalState.placeholder.hidden = false;
    shareModalState.placeholder.textContent = text || "QR en préparation…";
  }

  function hideQrPlaceholder() {
    if (shareModalState.placeholder) {
      shareModalState.placeholder.hidden = true;
    }
  }

  async function copyQrLinkToClipboard() {
    if (!shareModalState.currentUrl) {
      updateQrCopyStatus("Lien indisponible pour le moment.");
      return;
    }
    const linkToCopy = shareModalState.currentUrl;
    try {
      const canUseClipboardAPI = Boolean(
        navigator.clipboard && (typeof window.isSecureContext === "undefined" || window.isSecureContext)
      );
      if (canUseClipboardAPI) {
        await navigator.clipboard.writeText(linkToCopy);
      } else if (shareModalState.linkInput) {
        shareModalState.linkInput.focus();
        shareModalState.linkInput.select();
        const succeeded = document.execCommand("copy");
        if (!succeeded) {
          throw new Error("COPY_UNAVAILABLE");
        }
      } else {
        throw new Error("COPY_UNAVAILABLE");
      }
      updateQrCopyStatus("Lien copié dans le presse-papiers.");
    } catch (error) {
      console.warn("Unable to copy QR link", error);
      updateQrCopyStatus("Sélectionnez et copiez le lien manuellement.");
    }
  }

  function updateQrCopyStatus(message) {
    if (!shareModalState.copyStatus) {
      return;
    }
    if (shareModalState.statusTimeout) {
      window.clearTimeout(shareModalState.statusTimeout);
      shareModalState.statusTimeout = null;
    }
    const content = message ? message : "\u00A0";
    shareModalState.copyStatus.textContent = content;
    if (message) {
      shareModalState.statusTimeout = window.setTimeout(() => {
        if (shareModalState.copyStatus) {
          shareModalState.copyStatus.textContent = "\u00A0";
        }
        shareModalState.statusTimeout = null;
      }, 3200);
    }
  }

  function openQrLinkInNewTab() {
    if (!shareModalState.currentUrl) {
      updateQrCopyStatus("Lien indisponible.");
      return;
    }
    window.open(shareModalState.currentUrl, "_blank", "noopener");
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
    setDashboardLoading(false, { useOverlay: true });
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
