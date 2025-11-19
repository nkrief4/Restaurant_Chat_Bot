// Définition globale des domaines d'email jetables
const DISPOSABLE_EMAIL_DOMAINS = (function getDisposableDomains() {
  if (window.__SIGNUP_DISPOSABLE_SET instanceof Set) {
    return window.__SIGNUP_DISPOSABLE_SET;
  }
    const domains = new Set([
      "yopmail.com",
      "yopmail.fr",
      "mailinator.com",
      "tempmail.com",
      "guerrillamail.com",
      "guerrillamail.net",
      "33mail.com",
    ]);
    window.__SIGNUP_DISPOSABLE_SET = domains;
    return domains;
  })();
  const MENU_TEMPLATE = `{
  "categories": [
    {
      "name": "Entrées",
      "items": [
        { "name": "Salade de saison", "price": 9.5, "description": "Mesclun, crudités, vinaigrette maison." }
      ]
    },
    {
      "name": "Plats",
      "items": [
        { "name": "Risotto crémeux", "price": 18, "description": "Arborio, parmesan affiné, huile de truffe." }
      ]
    }
  ]
}`;

  const state = {
    currentStep: 0,
    values: {},
    isSubmitting: false,
    slugLocked: true,
    isMenuUploading: false,
  };

  document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("signup-form");
    if (!form) {
      return;
    }

    state.form = form;
    cacheElements();
    bindEvents();
    updateStep(0);
  });

  function cacheElements() {
    state.steps = Array.from(state.form.querySelectorAll(".form-step"));
    state.progressChips = Array.from(document.querySelectorAll(".progress-chip"));
    state.feedback = document.getElementById("signup-feedback");
    state.prevBtn = state.form.querySelector("[data-prev]");
    state.nextBtn = state.form.querySelector("[data-next]");
    state.submitBtn = state.form.querySelector("[data-submit]");
    state.passwordInput = document.getElementById("password");
    state.passwordConfirmInput = document.getElementById("password_confirm");
    state.passwordMeter = document.getElementById("password-meter");
    state.restaurantNameInput = document.getElementById("restaurant_name");
    state.slugInput = document.getElementById("restaurant_slug");
    state.slugRefresh = document.getElementById("slug-refresh");
    state.menuTextarea = document.getElementById("restaurant_menu_document");
    state.menuExampleBtn = document.getElementById("menu-example-btn");
    state.menuFileInput = document.getElementById("menu-upload-file");
    state.menuGenerateBtn = document.getElementById("menu-generate-btn");
    state.menuUploadStatus = document.getElementById("menu-upload-status");
  }

  function bindEvents() {
    state.nextBtn.addEventListener("click", handleNextStep);
    state.prevBtn.addEventListener("click", () => updateStep(state.currentStep - 1));
    state.form.addEventListener("submit", handleSubmit);

    state.progressChips.forEach((chip) => {
      chip.addEventListener("click", () => {
        const targetIndex = Number(chip.dataset.progress);
        if (Number.isInteger(targetIndex) && targetIndex < state.currentStep) {
          updateStep(targetIndex);
        }
      });
    });

    state.passwordInput.addEventListener("input", () => {
      updatePasswordMeter(state.passwordInput.value);
    });
    state.passwordConfirmInput.addEventListener("input", () => {
      clearFieldError("password_confirm");
    });

    if (state.restaurantNameInput) {
      state.restaurantNameInput.addEventListener("input", () => {
        if (state.slugLocked && state.slugInput) {
          state.slugInput.value = slugify(state.restaurantNameInput.value);
        }
      });
    }

    if (state.slugInput) {
      state.slugInput.addEventListener("input", () => {
        state.slugLocked = false;
      });
    }

    if (state.slugRefresh) {
      state.slugRefresh.addEventListener("click", () => {
        const base = state.restaurantNameInput?.value || "restaurant";
        if (state.slugInput) {
          state.slugInput.value = slugify(base, true);
        }
        state.slugLocked = true;
      });
    }

    if (state.menuExampleBtn && state.menuTextarea) {
      state.menuExampleBtn.addEventListener("click", (event) => {
        event.preventDefault();
        state.menuTextarea.value = MENU_TEMPLATE;
        clearFieldError("restaurant_menu_document");
        state.values.restaurant_menu_document = state.menuTextarea.value;
        if (state.currentStep === state.steps.length - 1) {
          fillSummary();
        }
      });
    }

    if (state.menuTextarea) {
      state.menuTextarea.addEventListener("input", () => {
        state.values.restaurant_menu_document = state.menuTextarea.value;
      });
    }

    if (state.menuGenerateBtn) {
      state.menuGenerateBtn.addEventListener("click", handleMenuUpload);
    }
  }

  function passwordPolicyMessage(value) {
    const normalized = value || "";
    if (normalized.length < 8) {
      return "Au moins 8 caractères sont requis.";
    }
    if (!/[a-z]/.test(normalized) || !/[A-Z]/.test(normalized)) {
      return "Ajoutez des majuscules et minuscules.";
    }
    if (!/\d/.test(normalized)) {
      return "Ajoutez au moins un chiffre.";
    }
    if (!/[^A-Za-z0-9]/.test(normalized)) {
      return "Ajoutez un symbole pour sécuriser le mot de passe.";
    }
    return "";
  }

  function isPasswordCompliant(value) {
    return !passwordPolicyMessage(value);
  }

  async function handleMenuUpload(event) {
    event.preventDefault();
    if (state.isMenuUploading) {
      return;
    }
    const file = state.menuFileInput?.files?.[0];
    if (!file) {
      setMenuUploadStatus("Sélectionnez un fichier avant de lancer l'analyse.", "error");
      return;
    }

    state.isMenuUploading = true;
    if (state.menuGenerateBtn) {
      state.menuGenerateBtn.disabled = true;
    }
    setMenuUploadStatus("Analyse du menu en cours…", "info");

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/signup/menu/from-upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({ detail: "" }));
        const detail = errorPayload?.detail || "Impossible d'analyser ce fichier.";
        throw new Error(detail);
      }
      const { menu_document: menuDocument } = await response.json();
      if (!menuDocument) {
        throw new Error("La réponse de l'IA ne contient pas de menu.");
      }
      const pretty = stringifyMenu(menuDocument);
      if (state.menuTextarea) {
        state.menuTextarea.value = pretty;
      }
      state.values.restaurant_menu_document = pretty;
      setMenuUploadStatus("Menu généré. Vérifiez et ajustez avant de créer votre compte.");
      if (state.currentStep === state.steps.length - 1) {
        fillSummary();
      }
    } catch (error) {
      console.error("Menu upload failed", error);
      setMenuUploadStatus(error.message || "Echec de l'analyse IA.", "error");
    } finally {
      state.isMenuUploading = false;
      if (state.menuGenerateBtn) {
        state.menuGenerateBtn.disabled = false;
      }
    }
  }

  function handleNextStep() {
    const { valid, data } = validateStep(state.currentStep);
    if (!valid) {
      return;
    }
    Object.assign(state.values, data);
    updateStep(state.currentStep + 1);
  }

  function updateStep(target) {
    const nextIndex = Math.max(0, Math.min(target, state.steps.length - 1));
    state.currentStep = nextIndex;

    state.steps.forEach((section, index) => {
      const isActive = index === nextIndex;
      section.hidden = !isActive;
      section.setAttribute("aria-hidden", String(!isActive));
    });

    state.progressChips.forEach((chip, index) => {
      chip.classList.toggle("active", index === nextIndex);
      chip.classList.toggle("done", index < nextIndex);
    });

    state.prevBtn.disabled = nextIndex === 0;
    state.nextBtn.hidden = nextIndex === state.steps.length - 1;
    state.submitBtn.hidden = nextIndex !== state.steps.length - 1;

    if (nextIndex === state.steps.length - 1) {
      fillSummary();
    }

    clearFeedback();
  }

  function fillSummary() {
    const summaryMap = {
      full_name: (value) => value || "—",
      email: (value) => value || "—",
      preferred_language: formatLanguage,
      restaurant_name: (value) => value || "—",
      restaurant_slug: (value) => value || "—",
      use_case: formatUseCase,
      menu_sections: () => countMenuSections(state.values.restaurant_menu_document),
    };

    Object.entries(summaryMap).forEach(([key, formatter]) => {
      const target = state.form.querySelector(`[data-summary="${key}"]`);
      if (!target) {
        return;
      }
      const formatted = formatter(state.values[key]);
      target.textContent = formatted;
    });
  }

  function validateStep(stepIndex) {
    const stepElement = state.steps[stepIndex];
    const inputs = Array.from(stepElement.querySelectorAll("input, select, textarea"));
    let valid = true;
    const data = {};

    inputs.forEach((input) => {
      const name = input.name;
      if (!name) {
        return;
      }
      let message = "";
      const value = input.type === "checkbox" ? input.checked : input.value.trim();

      if (input.required && ((input.type === "checkbox" && !input.checked) || !value)) {
        message = "Ce champ est requis.";
      }

      if (!message && name === "email" && value) {
        if (!/.+@.+\..+/.test(value)) {
          message = "Adresse email invalide.";
        } else if (isDisposableEmail(value)) {
          message = "Les adresses temporaires ne sont pas acceptées.";
        }
      }

      if (!message && name === "password") {
        const passwordMessage = passwordPolicyMessage(value);
        if (passwordMessage) {
          message = passwordMessage;
        }
      }

      if (!message && name === "phone_number" && value) {
        if (!isValidPhoneNumber(value)) {
          message = "Renseignez un numéro valide (10 à 15 chiffres).";
        }
      }

      if (!message && name === "password_confirm") {
        if (value !== state.passwordInput.value) {
          message = "Les mots de passe ne correspondent pas.";
        }
      }

      if (!message && name === "restaurant_slug" && value) {
        if (!/^[a-z0-9-]{3,}$/.test(value)) {
          message = "Utilisez uniquement des lettres minuscules, chiffres et tirets.";
        }
      }

      if (!message && name === "restaurant_menu_document" && value) {
        if (!isValidJson(value)) {
          message = "Le menu doit être un JSON valide.";
        }
      }

      setFieldError(name, message);
      if (message) {
        valid = false;
      }

      data[name] = input.type === "checkbox" ? Boolean(input.checked) : value;
    });

    return { valid, data };
  }

  function setFieldError(field, message) {
    const target = state.form.querySelector(`[data-error-for="${field}"]`);
    if (target) {
      target.textContent = message || "";
    }
    const input = state.form.querySelector(`[name="${field}"]`);
    if (input) {
      input.classList.toggle("has-error", Boolean(message));
    }
  }

  function clearFieldError(field) {
    setFieldError(field, "");
  }

  function updatePasswordMeter(value) {
    if (!state.passwordMeter) {
      return;
    }
    const bar = state.passwordMeter.querySelector(".password-meter-bar");
    const label = state.passwordMeter.querySelector(".password-meter-label");
    if (!bar || !label) {
      return;
    }
    const score = scorePassword(value);
    bar.dataset.strength = String(score);
    bar.style.setProperty("--strength", score);
    const policyMessage = passwordPolicyMessage(value);
    label.textContent = policyMessage || passwordStrengthLabel(score);
  }

  function scorePassword(value) {
    if (!value) {
      return 0;
    }
    let score = 0;
    if (value.length >= 12) score += 1;
    if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score += 1;
    if (/\d/.test(value)) score += 1;
    if (/[^A-Za-z0-9]/.test(value)) score += 1;
    return Math.min(score, 4);
  }

  function passwordStrengthLabel(score) {
    switch (score) {
      case 0:
        return "Choisissez un mot de passe d'au moins 12 caractères.";
      case 1:
        return "Ajoutez des majuscules et minuscules.";
      case 2:
        return "Ajoutez un chiffre et un symbole.";
      case 3:
        return "Renforcez encore pour atteindre l'exigence maximale.";
      case 4:
        return "Mot de passe conforme aux exigences de sécurité.";
      default:
        return "";
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (state.isSubmitting) {
      return;
    }

    const aggregated = { ...state.values };
    const { valid, data } = validateStep(state.currentStep);
    if (!valid) {
      return;
    }
    Object.assign(state.values, data);
    Object.assign(aggregated, state.values);

    const payload = buildPayload(aggregated);
    if (!payload) {
      displayFeedback(
        "Impossible de préparer vos informations. Revenez aux étapes précédentes et vérifiez les champs.",
        "error"
      );
      return;
    }

    state.isSubmitting = true;
    toggleSubmitting(true);
    displayFeedback("Création de votre tenant en cours…", "info");

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        const detail = errorPayload?.detail || "Impossible de finaliser l'inscription.";
        throw new Error(detail);
      }
      const result = await response.json();
      displayFeedback(
        "Compte créé avec succès. Nous vous redirigeons vers le tableau de bord…",
        "success"
      );
      await attemptAutoLogin(payload.email, payload.password, Boolean(result?.auto_login));
    } catch (error) {
      console.error("Signup failed", error);
      displayFeedback(error.message || "Erreur inattendue lors de l'inscription.", "error");
      state.isSubmitting = false;
      toggleSubmitting(false);
    }
  }

  function buildPayload(values) {
    const requiredKeys = [
      "full_name",
      "email",
      "password",
      "phone_number",
      "timezone",
      "restaurant_name",
      "restaurant_slug",
      "preferred_language",
      "use_case",
      "terms_accepted",
    ];
    const missing = requiredKeys.filter((key) => values[key] === undefined || values[key] === "");
    if (missing.length) {
      return null;
    }

    const menuRaw = values.restaurant_menu_document?.trim();
    let menuDocument = null;
    if (menuRaw) {
      try {
        menuDocument = JSON.parse(menuRaw);
      } catch (error) {
        setFieldError("restaurant_menu_document", "Le menu doit être un JSON valide.");
        return null;
      }
    }

    return {
      full_name: values.full_name,
      company_name: values.company_name || null,
      email: values.email,
      password: values.password,
      phone_number: values.phone_number,
      timezone: values.timezone,
      restaurant_name: values.restaurant_name,
      restaurant_slug: values.restaurant_slug,
      menu_document: menuDocument,
      preferred_language: values.preferred_language || "fr",
      newsletter_opt_in: Boolean(values.newsletter_opt_in),
      terms_accepted: Boolean(values.terms_accepted),
      use_case: values.use_case || "single_location",
      referral_code: values.referral_code || null,
    };
  }

  async function attemptAutoLogin(email, password, shouldLogin) {
    if (!shouldLogin) {
      toggleSubmitting(false);
      state.isSubmitting = false;
      return;
    }
    try {
      if (typeof window.secureSupabaseLogin !== "function") {
        throw new Error("Module d'authentification indisponible.");
      }
      await window.secureSupabaseLogin(email, password);
      window.location.href = "/dashboard";
    } catch (error) {
      console.warn("Automatic login failed", error);
      displayFeedback(
        "Compte créé. Connectez-vous manuellement avec votre nouveau mot de passe.",
        "info"
      );
      toggleSubmitting(false);
      state.isSubmitting = false;
    }
  }

  function toggleSubmitting(isLoading) {
    state.submitBtn.disabled = isLoading;
    state.prevBtn.disabled = isLoading || state.currentStep === 0;
    state.nextBtn.disabled = isLoading;
    if (isLoading) {
      state.submitBtn.textContent = "Création en cours…";
    } else {
      state.submitBtn.textContent = "Créer mon espace";
    }
  }

  function displayFeedback(message, variant) {
    if (!state.feedback) {
      return;
    }
    state.feedback.textContent = message;
    state.feedback.className = "form-message";
    if (variant) {
      state.feedback.classList.add(variant);
    }
  }

  function clearFeedback() {
    if (!state.feedback) {
      return;
    }
    state.feedback.textContent = "";
    state.feedback.className = "form-message";
  }

  function setMenuUploadStatus(message, variant = "success") {
    if (!state.menuUploadStatus) {
      return;
    }
    state.menuUploadStatus.textContent = message;
    state.menuUploadStatus.className = "form-message";
    if (!message) {
      return;
    }
    state.menuUploadStatus.classList.add(variant);
  }

  function slugify(input, forceRandom) {
    const normalized = (input || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    let slug = normalized
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!slug || forceRandom) {
      slug = `${slug || "restaurant"}-${Math.floor(Math.random() * 900 + 100)}`;
    }
    return slug;
  }

  function formatLanguage(value) {
    return value === "en" ? "Anglais" : "Français";
  }

  function formatUseCase(value) {
    const map = {
      single_location: "Un seul établissement",
      multi_location: "Plusieurs établissements",
      agency: "Agence ou franchise",
      other: "Autre besoin",
    };
    return map[value] || map.other;
  }

  function isValidJson(value) {
    try {
      JSON.parse(value);
      return true;
    } catch (error) {
      return false;
    }
  }

  function countMenuSections(menuValue) {
    if (!menuValue) {
      return 0;
    }
    try {
      const parsed = typeof menuValue === "string" ? JSON.parse(menuValue) : menuValue;
      if (!parsed || !Array.isArray(parsed.categories)) {
        return 0;
      }
      return parsed.categories.length;
    } catch (error) {
      return 0;
    }
  }

  function stringifyMenu(menuDocument) {
    try {
      return JSON.stringify(menuDocument, null, 2);
    } catch (error) {
      return "";
    }
  }

  function isDisposableEmail(email) {
    if (!email) return false;
    const [, domain = ""] = email.toLowerCase().split("@");
    return DISPOSABLE_EMAIL_DOMAINS.has(domain);
  }

  function normalizePhoneDigits(value) {
    return (value || "").replace(/[^0-9]/g, "");
  }

  function isValidPhoneNumber(value) {
    const trimmed = (value || "").trim();
    const digits = normalizePhoneDigits(trimmed);
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
