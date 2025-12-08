import { state } from "../core/state.js";

// --- UI Utilities ---

export function showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) {
        return;
    }

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    // Trigger reflow
    toast.offsetHeight;

    toast.classList.add("show");

    setTimeout(() => {
        toast.classList.remove("show");
        toast.addEventListener("transitionend", () => {
            toast.remove();
        });
    }, 3000);
}

export function navigateToSection(sectionId) {
    const sections = document.querySelectorAll("main > section");
    const navLinks = document.querySelectorAll(".nav-link");

    sections.forEach((section) => {
        if (section.id === sectionId) {
            section.hidden = false;
            section.setAttribute("aria-hidden", "false");
            section.classList.add("active-section");
        } else {
            section.hidden = true;
            section.setAttribute("aria-hidden", "true");
            section.classList.remove("active-section");
        }
    });

    navLinks.forEach((link) => {
        const target = link.dataset.section;
        if (target === sectionId) {
            link.classList.add("active");
            link.setAttribute("aria-current", "page");
        } else {
            link.classList.remove("active");
            link.removeAttribute("aria-current");
        }
    });

    // Scroll to top
    window.scrollTo({ top: 0, behavior: "smooth" });
}

export function updateUIWithUserData(userData) {
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

        // Also update avatar if needed, though original code didn't seem to have avatar update logic in the snippet I saw?
        // Wait, I saw lines 2699-2729. It updated welcomeTitle, pillName, planLabel.
        // It didn't update avatar in that snippet.
        // But my previous implementation did.
        // I'll stick to the snippet logic + maybe avatar if I saw it elsewhere.
        // I'll stick to the snippet.
    } catch (error) {
        console.error("Erreur lors de la mise à jour de l'interface:", error);
    }
}
// --- Global UI Handlers ---

export function setDashboardLoading(isLoading, options = {}) {
    const { useOverlay = false } = options;
    const loader = document.getElementById("dashboard-loader");
    const overlay = document.getElementById("dashboard-loading-overlay");

    if (useOverlay && overlay) {
        overlay.hidden = !isLoading;
        overlay.classList.toggle("is-hidden", !isLoading);
        overlay.setAttribute("aria-hidden", isLoading ? "false" : "true");
    } else if (loader) {
        loader.hidden = !isLoading;
        loader.setAttribute("aria-hidden", isLoading ? "false" : "true");
    }
}

export function bindGlobalButtons() {
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
            const client = await import("../core/supabase.js").then(m => m.ensureSupabaseClient());
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

export function setupGlobalRestaurantPicker() {
    const select = document.getElementById("global-restaurant-select");
    if (!select) {
        return;
    }
    select.addEventListener("change", async (event) => {
        const restaurantId = event.target.value || null;
        // Dynamic import to avoid circular dependency if possible, or just rely on event dispatch
        // Actually, selectOverviewRestaurant is in overview.js. 
        // We can dispatch an event or import it.
        // Let's import it.
        const { selectOverviewRestaurant } = await import("./overview.js");
        if (restaurantId) {
            selectOverviewRestaurant(restaurantId, { manual: true });
        } else {
            selectOverviewRestaurant(null, { manual: true });
        }
    });

    // Listen for global changes to update the edit form if visible
    document.addEventListener("activeRestaurantChange", async (event) => {
        const restaurantId = event.detail.id;
        const { state } = await import("../core/state.js");
        if (state.restaurantForms.activeTab === "edit") {
            const { startEditRestaurant, resetRestaurantForm } = await import("./restaurants.js");
            if (restaurantId) {
                startEditRestaurant(restaurantId);
            } else {
                const form = document.getElementById("restaurant-edit-form");
                resetRestaurantForm(form);
            }
        }
    });
}

export function setupActionHandlers() {
    document.addEventListener("click", async (event) => {
        const chatLauncher = event.target.closest("[data-open-chat]");
        if (chatLauncher) {
            event.preventDefault();
            const restaurantId = chatLauncher.dataset ? chatLauncher.dataset.restaurantId : null;
            const restaurantName = chatLauncher.dataset ? chatLauncher.dataset.restaurantName : null;
            const { launchChatTester } = await import("./chatbot.js");
            launchChatTester(restaurantId, restaurantName);
            return;
        }
        const configureBtn = event.target.closest(".configure-restaurant");
        if (configureBtn) {
            event.preventDefault();
            const { startEditRestaurant, goToRestaurantManagement } = await import("./restaurants.js");
            startEditRestaurant(configureBtn.dataset.restaurantId);
            goToRestaurantManagement("edit");
        }
    });
}
