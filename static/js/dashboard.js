(function () {
  const state = {
    supabase: null,
    session: null,
    token: null,
    snapshot: null,
    restaurants: [],
    editingId: null,
    isUploadingMenu: false,
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
    initializeDashboard().catch(handleInitializationError);
  });

  async function initializeDashboard() {
    state.supabase = await ensureSupabaseClient();
    await ensureAuthenticated();
    bindFormEvents();
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
        navigateToSection("create");
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

  async function refreshDashboardData() {
    const tbody = document.getElementById("restaurants-table-body");
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="5">Chargement des restaurants…</td></tr>`;
    }
    const token = await getAccessToken();
    const response = await fetch("/api/dashboard/snapshot", {
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
    updateOverview(snapshot.kpis);
    renderRestaurants();
    renderStatistics(snapshot.statistics);
    renderBilling(snapshot.billing);
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
    const form = document.getElementById("restaurant-form");
    const resetBtn = document.getElementById("restaurant-reset-btn");
    const uploadBtn = document.getElementById("menu-upload-btn");

    if (form) {
      form.addEventListener("submit", handleRestaurantFormSubmit);
    }
    if (resetBtn) {
      resetBtn.addEventListener("click", resetForm);
    }
    if (uploadBtn) {
      uploadBtn.addEventListener("click", handleMenuUpload);
    }
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
    const tbody = document.getElementById("restaurants-table-body");
    if (!tbody) {
      return;
    }

    if (!state.restaurants.length) {
      tbody.innerHTML = `<tr><td colspan="5">Ajoutez un restaurant pour commencer à entraîner votre chatbot.</td></tr>`;
      return;
    }

    const fragment = document.createDocumentFragment();
    state.restaurants.forEach((restaurant) => {
      const row = document.createElement("tr");

      const nameCell = document.createElement("td");
      const nameStrong = document.createElement("strong");
      nameStrong.textContent = restaurant.display_name || "Sans nom";
      const nameMeta = document.createElement("p");
      nameMeta.className = "muted small";
      nameMeta.textContent = restaurant.id || "Identifiant non disponible";
      nameCell.append(nameStrong, nameMeta);

      const slugCell = document.createElement("td");
      slugCell.textContent = restaurant.slug || "—";

      const menuCell = document.createElement("td");
      menuCell.textContent = countCategories(restaurant.menu_document).toString();

      const dateCell = document.createElement("td");
      dateCell.textContent = formatTimestamp(restaurant);

      const actionsCell = document.createElement("td");
      actionsCell.className = "actions";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "ghost-btn configure-restaurant";
      editBtn.dataset.restaurantId = restaurant.id;
      editBtn.textContent = "Configurer";

      const testerBtn = document.createElement("button");
      testerBtn.type = "button";
      testerBtn.className = "ghost-btn tester-chatbot";
      testerBtn.dataset.openChat = "true";
      testerBtn.dataset.restaurantId = restaurant.id || "";
      testerBtn.dataset.restaurantName = restaurant.display_name || restaurant.name || "Restaurant";
      testerBtn.textContent = "Tester le chatbot";

      actionsCell.append(editBtn, testerBtn);

      row.append(nameCell, slugCell, menuCell, dateCell, actionsCell);
      fragment.appendChild(row);
    });

    tbody.innerHTML = "";
    tbody.appendChild(fragment);
  }

  function countCategories(menuDocument) {
    const parsed = normalizeMenuDocument(menuDocument);
    if (!parsed || !Array.isArray(parsed.categories)) {
      return 0;
    }
    return parsed.categories.length;
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
    setTextContent("kpi-restaurants", formatNumber(kpis.restaurants));
    setTextContent("kpi-conversations", formatNumber(kpis.conversations_last_30));
    setTextContent("kpi-customers", formatNumber(kpis.unique_customers));
    setTextContent("kpi-plan", kpis.plan || "Plan Pro");
    setTextContent("kpi-plan-detail", kpis.plan_detail || "");
    renderConversationChart(kpis.timeline);
  }

  function renderConversationChart(timeline) {
    const container = document.getElementById("overview-conversation-chart");
    if (!container) {
      return;
    }
    container.innerHTML = "";
    const data = Array.isArray(timeline) && timeline.length ? timeline : [];
    const fallback = data.length ? data : Array.from({ length: 10 }, () => ({ label: "", count: 0 }));
    const maxValue = fallback.reduce((acc, entry) => Math.max(acc, entry.count || 0), 0) || 1;

    fallback.forEach((entry) => {
      const bar = document.createElement("span");
      const value = typeof entry.count === "number" ? entry.count : 0;
      const height = Math.max(6, Math.round((value / maxValue) * 100));
      bar.style.height = `${height}%`;
      bar.title = entry.label ? `${entry.label} · ${value}` : `${value}`;
      container.appendChild(bar);
    });
  }

  function renderStatistics(statistics) {
    if (!statistics) {
      setTextContent("stats-total-conversations", "—");
      setTextContent("stats-average-per-day", "—");
      setTextContent("stats-resolution-rate", "—");
      renderTopQuestions([]);
      renderDietBreakdown([]);
      return;
    }
    setTextContent("stats-total-conversations", formatNumber(statistics.total_conversations));
    setTextContent("stats-average-per-day", formatNumber(statistics.average_per_day));
    const resolution = typeof statistics.resolution_rate === "number" ? `${statistics.resolution_rate}%` : "—";
    setTextContent("stats-resolution-rate", resolution);
    renderTopQuestions(statistics.top_questions);
    renderDietBreakdown(statistics.diet_breakdown);
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

  function startEditRestaurant(id) {
    if (!id) {
      return;
    }
    const record = state.restaurants.find((restaurant) => restaurant.id === id);
    if (!record) {
      showToast("Restaurant introuvable.");
      return;
    }
    state.editingId = id;
    const form = document.getElementById("restaurant-form");
    if (!form) {
      return;
    }
    form.dataset.mode = "edit";
    const nameInput = document.getElementById("restaurant-name");
    const slugInput = document.getElementById("restaurant-slug");
    const menuInput = document.getElementById("restaurant-menu");
    const submitBtn = document.getElementById("restaurant-submit-btn");
    const modeLabel = document.getElementById("form-mode-label");
    const messageEl = document.getElementById("restaurant-form-message");
    if (nameInput) {
      nameInput.value = record.display_name || "";
    }
    if (slugInput) {
      slugInput.value = record.slug || "";
    }
    if (menuInput) {
      menuInput.value = stringifyMenu(record.menu_document);
    }
    if (submitBtn) {
      submitBtn.textContent = "Mettre à jour le restaurant";
    }
    if (modeLabel) {
      modeLabel.textContent = `Mode édition — ${record.display_name || "Restaurant"}`;
    }
    if (messageEl) {
      messageEl.textContent = "";
    }
  }

  function resetForm() {
    const form = document.getElementById("restaurant-form");
    if (!form) {
      return;
    }
    form.reset();
    form.dataset.mode = "create";
    state.editingId = null;
    const modeLabel = document.getElementById("form-mode-label");
    if (modeLabel) {
      modeLabel.textContent = "Mode création — aucun restaurant en cours d'édition.";
    }
    const submitBtn = document.getElementById("restaurant-submit-btn");
    if (submitBtn) {
      submitBtn.textContent = "Enregistrer le restaurant";
    }
    const messageEl = document.getElementById("restaurant-form-message");
    if (messageEl) {
      messageEl.textContent = "";
    }
    const uploadStatus = document.getElementById("menu-upload-status");
    if (uploadStatus) {
      uploadStatus.textContent = "";
    }
  }

  async function handleRestaurantFormSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitBtn = document.getElementById("restaurant-submit-btn");
    const messageEl = document.getElementById("restaurant-form-message");
    if (messageEl) {
      messageEl.textContent = "";
    }

    const { payload, error } = collectFormData(form);
    if (error) {
      if (messageEl) {
        messageEl.textContent = error;
      }
      return;
    }

    submitBtn.disabled = true;
    try {
      const token = await getAccessToken();
      const isEdit = form.dataset.mode === "edit" && state.editingId;
      const endpoint = isEdit
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
        resetForm();
      }
    } catch (error) {
      console.error("Restaurant form submission failed", error);
      if (messageEl) {
        messageEl.textContent = error.message || "Impossible d'enregistrer ces informations.";
      }
    } finally {
      submitBtn.disabled = false;
    }
  }

  function collectFormData(form) {
    const nameInput = form.querySelector("#restaurant-name");
    const slugInput = form.querySelector("#restaurant-slug");
    const menuInput = form.querySelector("#restaurant-menu");

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

  async function handleMenuUpload(event) {
    event.preventDefault();
    if (state.isUploadingMenu) {
      return;
    }
    const fileInput = document.getElementById("menu-file");
    const status = document.getElementById("menu-upload-status");
    if (!status) {
      return;
    }
    const file = fileInput && fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
    if (!file) {
      status.textContent = "Sélectionnez un fichier avant de lancer l'analyse.";
      return;
    }

    state.isUploadingMenu = true;
    event.currentTarget.disabled = true;
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
      const menuField = document.getElementById("restaurant-menu");
      if (menuField) {
        menuField.value = stringifyMenu(menuDocument);
      }
      status.textContent = "Menu importé. Vérifiez puis sauvegardez.";
    } catch (error) {
      console.error("Menu upload failed", error);
      status.textContent = error.message || "Erreur lors de l'analyse.";
    } finally {
      state.isUploadingMenu = false;
      event.currentTarget.disabled = false;
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

    let target = available.find((entry) => entry.id === restaurantId);
    if (!target && restaurantId) {
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
    const url = new URL("/dashboard/chat", window.location.origin);
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
