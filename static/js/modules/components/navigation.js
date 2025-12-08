import { state } from "../core/state.js";
import { forEachNode } from "../utils/dom.js";
import { updatePurchasingNavLinks, setPurchasingPanel } from "./purchasing.js"; // Need to export this from purchasing.js or handle differently
import { setRestaurantManagementTab } from "./restaurants.js";

// --- Navigation Logic ---



let dashboardContainer;
let bodyElement;
let sidebarToggle;
let sidebarBackdrop;
let sidebarElement;
let navDropdowns;

export function setupNavigation() {
    const sections = document.querySelectorAll(".section");
    const navLinks = document.querySelectorAll(".nav-link, .nav-sublink");
    const quickLinks = document.querySelectorAll("[data-open-section]");
    dashboardContainer = document.querySelector(".dashboard");
    sidebarElement = document.getElementById("dashboard-sidebar");
    sidebarToggle = document.getElementById("sidebar-toggle");
    sidebarBackdrop = document.getElementById("sidebar-backdrop");
    bodyElement = document.body;
    navDropdowns = document.querySelectorAll("[data-nav-dropdown]");

    if (sidebarToggle) {
        sidebarToggle.addEventListener("click", () => {
            toggleSidebar();
        });
    }

    const sidebarClose = document.getElementById("sidebar-close");
    if (sidebarClose) {
        sidebarClose.addEventListener("click", () => {
            closeSidebar();
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

    forEachNode(navDropdowns, (dropdown) => {
        const toggle = dropdown.querySelector("[data-nav-dropdown-toggle]");
        if (!toggle) {
            return;
        }
        toggle.addEventListener("click", (event) => {
            const willOpen = !dropdown.classList.contains("is-open");
            closeNavDropdowns(willOpen ? dropdown : null);
            setNavDropdownState(dropdown, willOpen);
            const touchQuery = window.matchMedia ? window.matchMedia("(max-width: 1023px)") : null;
            const shouldSkipNavigation = touchQuery && touchQuery.matches && willOpen;
            if (shouldSkipNavigation) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        });
        dropdown.addEventListener("mouseenter", () => {
            if (!dropdown.classList.contains("is-open") && toggle) {
                toggle.setAttribute("aria-expanded", "true");
            }
        });
        dropdown.addEventListener("mouseleave", () => {
            if (!dropdown.classList.contains("is-open") && toggle) {
                toggle.setAttribute("aria-expanded", "false");
            }
        });
    });

    document.addEventListener("click", (event) => {
        const dropdown = event.target.closest ? event.target.closest("[data-nav-dropdown]") : null;
        if (!dropdown) {
            closeNavDropdowns();
        }
    });

    document.addEventListener("navigate", (event) => {
        if (event.detail && event.detail.section) {
            navigateToSection(event.detail.section, event.detail.options);
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

    forEachNode(navLinks, (link) => {
        link.addEventListener("click", (event) => {
            event.preventDefault();
            const sectionId = link.dataset.section;
            const subView = link.dataset.purchasingView;
            navigateToSection(sectionId, { subView });
        });
    });

    forEachNode(quickLinks, (link) => {
        link.addEventListener("click", (event) => {
            event.preventDefault();
            const sectionId = link.dataset.openSection;
            navigateToSection(sectionId);
        });
    });

    window.addEventListener("hashchange", () => {
        const hash = window.location.hash.substring(1);
        if (hash) {
            navigateToSection(hash, { updateHash: false });
        }
    });

    // Initial load
    const initialHash = window.location.hash.substring(1);
    if (initialHash) {
        navigateToSection(initialHash, { updateHash: false });
    } else {
        navigateToSection("overview", { updateHash: false });
    }

    return navigateToSection;
}

export function navigateToSection(sectionId, options) {
    const activeId = activateSection(sectionId, options);
    const shouldUpdateHash = !options || options.updateHash !== false;
    if (shouldUpdateHash) {
        updateHash(activeId);
    }
    return activeId;
}

function setSidebarOpen(shouldOpen) {
    if (!dashboardContainer) {
        // Try to re-query if not initialized yet (though setupNavigation should have run)
        dashboardContainer = document.querySelector(".dashboard");
        if (!dashboardContainer) return;
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

function setNavDropdownState(dropdown, shouldOpen) {
    if (!dropdown) {
        return;
    }
    dropdown.classList.toggle("is-open", Boolean(shouldOpen));
    const toggle = dropdown.querySelector("[data-nav-dropdown-toggle]");
    if (toggle) {
        toggle.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
    }
}

function closeNavDropdowns(exceptDropdown) {
    if (!navDropdowns) navDropdowns = document.querySelectorAll("[data-nav-dropdown]");
    forEachNode(navDropdowns, (dropdown) => {
        if (dropdown === exceptDropdown) {
            return;
        }
        setNavDropdownState(dropdown, false);
    });
}

function toggleSidebar() {
    const isOpen = dashboardContainer ? dashboardContainer.classList.contains("sidebar-open") : false;
    setSidebarOpen(!isOpen);
}

function closeSidebar() {
    setSidebarOpen(false);
    closeNavDropdowns();
}

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

function activateSection(sectionId, options) {
    let targetId = sectionId;
    let pendingTab = null;
    if (targetId === "create" || targetId === "edit") {
        pendingTab = targetId === "edit" ? "edit" : "create";
        targetId = "manage-restaurants";
    }
    if (!document.getElementById(targetId)) {
        targetId = "overview";
    }

    const sections = document.querySelectorAll(".section");
    forEachNode(sections, (section) => {
        if (section.id === targetId) {
            section.classList.add("active-section");
        } else {
            section.classList.remove("active-section");
        }
    });

    const navLinks = document.querySelectorAll(".nav-link");
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

    if (targetId === "purchasing") {
        const subView = options && options.subView ? options.subView : "dashboard";
        setPurchasingPanel(subView);
    } else {
        updatePurchasingNavLinks(null, { forceClear: true });
    }

    if (targetId === "profile") {
        // Load stock thresholds when profile section becomes active
        import("./profile.js").then(module => {
            if (module.loadStockThresholds) {
                module.loadStockThresholds();
            }
        });
    }

    if (pendingTab && targetId === "manage-restaurants") {
        setRestaurantManagementTab(pendingTab, { focus: false });
    }

    return targetId;
}

