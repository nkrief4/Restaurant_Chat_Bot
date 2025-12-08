import { state } from "../core/state.js";
import { purchasingApi } from "../services/api.js";
import { formatCurrency } from "../utils/format.js";
import { forEachNode } from "../utils/dom.js";
import { ensureChartJsLibrary } from "../utils/charts.js";

// --- Purchasing Logic ---

const PURCHASING_RANGE_DEFAULT_DAYS = 30;

const purchasingEmbedRuntime = {
    iframe: null,
    loader: null,
    shell: null,
    resizeObserver: null,
    resizeInterval: null,
};

const purchasingViewRuntime = {
    container: null,
    toggle: null,
    label: null,
    menu: null,
    items: [],
    panels: [],
    navLinks: [],
    navDropdown: null,
    activeView: "dashboard",
};

let purchasingCharts = {};
let allIngredients = []; // Store all ingredients for filtering
let activeStatusFilter = 'all';

export function bindPurchasingSectionUI() {
    setupPurchasingEmbed();
    setupPurchasingViewSwitcher();
    setupPurchasingDateFilters();
    setupIngredientStatusTabs();
    refreshPurchasingDashboard();
    document.addEventListener('salesDataChanged', refreshPurchasingDashboard);
}

function setupIngredientStatusTabs() {
    const tabs = document.querySelectorAll('.status-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const status = tab.getAttribute('data-status-filter');
            activeStatusFilter = status;

            // Update active tab
            tabs.forEach(t => t.classList.remove('is-active'));
            tab.classList.add('is-active');

            // Filter and display ingredients
            filterAndDisplayIngredients();
        });
    });
}

function filterAndDisplayIngredients() {
    const criticalBody = document.getElementById('dashboard-critical-ingredients-body');
    if (!criticalBody) return;

    let filteredIngredients = allIngredients;

    if (activeStatusFilter !== 'all') {
        filteredIngredients = allIngredients.filter(item => item.status === activeStatusFilter);
    }

    if (filteredIngredients.length === 0) {
        criticalBody.innerHTML = '<tr><td colspan="5" class="text-center muted">Aucun ingrédient avec ce statut.</td></tr>';
    } else {
        criticalBody.innerHTML = filteredIngredients.map(item => `
          <tr>
            <td><strong>${item.ingredient_name}</strong></td>
            <td>${item.current_stock} ${item.unit}</td>
            <td><span class="stock-status is-${item.status.toLowerCase()}">${item.status}</span></td>
            <td>${item.default_supplier ? item.default_supplier.name : '-'}</td>
            <td><strong>${item.recommended_order_quantity.toFixed(1)} ${item.unit}</strong></td>
          </tr>
        `).join('');
    }
}

function updateStatusTabCounts(recommendations) {
    const counts = {
        all: recommendations.length,
        CRITICAL: recommendations.filter(r => r.status === 'CRITICAL').length,
        LOW: recommendations.filter(r => r.status === 'LOW').length,
        OK: recommendations.filter(r => r.status === 'OK').length
    };

    document.getElementById('tab-count-all').textContent = counts.all;
    document.getElementById('tab-count-critical').textContent = counts.CRITICAL;
    document.getElementById('tab-count-low').textContent = counts.LOW;
    document.getElementById('tab-count-ok').textContent = counts.OK;
}


function ensurePurchasingRangeDefaults() {
    if (!state.purchasingRange) {
        state.purchasingRange = { startDate: null, endDate: null };
    }
    if (!state.purchasingRange.startDate || !state.purchasingRange.endDate) {
        const today = new Date();
        const start = new Date(today);
        start.setDate(today.getDate() - (PURCHASING_RANGE_DEFAULT_DAYS - 1));
        state.purchasingRange.startDate = formatInputDate(start);
        state.purchasingRange.endDate = formatInputDate(today);
    }
}

function setupPurchasingDateFilters() {
    const form = document.getElementById("purchasing-range-form");
    const startInput = document.getElementById("purchasing-start-date");
    const endInput = document.getElementById("purchasing-end-date");
    const messageEl = document.getElementById("purchasing-range-message");
    if (!form || !startInput || !endInput) {
        return;
    }

    ensurePurchasingRangeDefaults();
    startInput.value = state.purchasingRange.startDate;
    endInput.value = state.purchasingRange.endDate;
    updatePurchasingRangeDisplay(new Date(startInput.value), new Date(endInput.value));

    const handleRangeChange = async () => {
        const startValue = startInput.value;
        const endValue = endInput.value;
        const error = validateRange(startValue, endValue);
        if (messageEl) {
            messageEl.textContent = error ? error.message : "";
        }
        if (error) {
            return;
        }
        if (
            state.purchasingRange.startDate === startValue &&
            state.purchasingRange.endDate === endValue
        ) {
            return;
        }
        state.purchasingRange.startDate = startValue;
        state.purchasingRange.endDate = endValue;
        refreshPurchasingDashboard();
    };

    startInput.addEventListener("change", handleRangeChange);
    endInput.addEventListener("change", handleRangeChange);
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        handleRangeChange();
    });
}

function resolvePurchasingDateRange() {
    ensurePurchasingRangeDefaults();
    const { startDate, endDate } = state.purchasingRange;
    let start = startDate ? new Date(startDate) : null;
    let end = endDate ? new Date(endDate) : null;
    if (!start || Number.isNaN(start.getTime())) {
        start = new Date();
        start.setDate(start.getDate() - (PURCHASING_RANGE_DEFAULT_DAYS - 1));
    }
    if (!end || Number.isNaN(end.getTime())) {
        end = new Date();
    }
    if (start > end) {
        const temp = start;
        start = end;
        end = temp;
    }
    const diffDays = Math.max(
        1,
        Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1
    );
    return { start, end, rangeDays: diffDays };
}

function updatePurchasingRangeDisplay(start, end) {
    const node = document.getElementById("purchasing-range-display");
    if (!node) {
        return;
    }
    const safeStart = start && !Number.isNaN(start.getTime()) ? start : new Date();
    const safeEnd = end && !Number.isNaN(end.getTime()) ? end : safeStart;
    const formatter = new Intl.DateTimeFormat("fr-FR", {
        day: "2-digit",
        month: "short",
    });
    node.textContent = `${formatter.format(safeStart)} → ${formatter.format(safeEnd)}`;
}

export async function refreshPurchasingDashboard() {
    const restaurantId = state.overview?.restaurantId || null;
    const { start, end } = resolvePurchasingDateRange();
    updatePurchasingRangeDisplay(start, end);

    if (!restaurantId) {
        // Clear data if no restaurant selected
        const kpiTotal = document.getElementById('kpi-total-stock');
        if (kpiTotal) kpiTotal.textContent = '-';

        const kpiSales = document.getElementById('kpi-total-sales');
        if (kpiSales) kpiSales.textContent = '-';

        const kpiCritical = document.getElementById('kpi-critical-stock');
        if (kpiCritical) kpiCritical.textContent = '-';

        const kpiActive = document.getElementById('kpi-active-orders');
        if (kpiActive) kpiActive.textContent = '-';

        const criticalBody = document.getElementById('dashboard-critical-ingredients-body');
        if (criticalBody) criticalBody.innerHTML = '<tr><td colspan="5" class="text-center muted">Sélectionnez un restaurant via la barre supérieure.</td></tr>';

        const ordersList = document.getElementById('dashboard-recent-orders-list');
        if (ordersList) ordersList.innerHTML = '<p class="text-center muted">Sélectionnez un restaurant via la barre supérieure.</p>';

        clearPurchasingCharts();
        setPurchasingDashboardLoading(false);
        return;
    }

    setPurchasingDashboardLoading(true);
    try {
        const dateFrom = formatInputDate(start);
        const dateTo = formatInputDate(end);

        // 1. Fetch Recommendations (for KPIs & Critical List)
        const [recommendations, orders, summary, salesInsights] = await Promise.all([
            purchasingApi.fetchRecommendations({
                restaurant_id: restaurantId, // Ensure restaurant_id is passed
                date_from: dateFrom,
                date_to: dateTo
            }),
            purchasingApi.fetchPurchaseOrders(5), // This might need restaurant_id if API supports it
            purchasingApi.fetchSummary({
                restaurant_id: restaurantId,
                date_from: dateFrom,
                date_to: dateTo
            }),
            purchasingApi.fetchSalesInsights({
                restaurant_id: restaurantId,
                date_from: dateFrom,
                date_to: dateTo
            }).catch((error) => {
                console.warn("Sales insights unavailable", error);
                return null;
            })
        ]);

        // Process recommendations to ensure status is calculated
        const processedRecommendations = (recommendations || []).map(item => {
            let status = item.status || 'OK';
            if (status === 'NO_DATA' || !item.status) {
                if (item.current_stock <= item.safety_stock) {
                    status = 'CRITICAL';
                } else if (item.current_stock <= item.safety_stock * 1.2) {
                    status = 'LOW';
                } else {
                    status = 'OK';
                }
            }
            return { ...item, status };
        });

        // Update KPIs
        const totalStock = processedRecommendations.length;
        const criticalStock = processedRecommendations.filter(r => r.status === 'CRITICAL').length;
        const activeOrders = (orders || []).filter(o => o.status === 'sent' || o.status === 'pending').length;
        const revenueTotal = salesInsights && typeof salesInsights.revenue_total === 'number'
            ? salesInsights.revenue_total
            : null;

        const kpiTotal = document.getElementById('kpi-total-stock');
        if (kpiTotal) kpiTotal.textContent = totalStock;

        const kpiSales = document.getElementById('kpi-total-sales');
        if (kpiSales) {
            kpiSales.textContent = revenueTotal !== null
                ? formatCurrency(revenueTotal)
                : '-';
        }

        const kpiCritical = document.getElementById('kpi-critical-stock');
        if (kpiCritical) kpiCritical.textContent = criticalStock;

        const kpiActive = document.getElementById('kpi-active-orders');
        if (kpiActive) kpiActive.textContent = activeOrders;

        // 4. Store all ingredients and update tab counts
        allIngredients = processedRecommendations;
        updateStatusTabCounts(processedRecommendations);

        // Filter and display ingredients based on active tab
        filterAndDisplayIngredients();


        // 5. Update Recent Orders List
        const ordersList = document.getElementById('dashboard-recent-orders-list');
        if (ordersList) {
            if (!orders || orders.length === 0) {
                ordersList.innerHTML = '<p class="text-center muted">Aucune commande récente.</p>';
            } else {
                ordersList.innerHTML = orders.map(order => `
          <div class="order-item">
            <div class="order-info">
              <h4>${order.supplier_name}</h4>
              <p class="order-meta">${new Date(order.created_at).toLocaleDateString()} • ${order.line_count} articles</p>
            </div>
            <span class="order-status ${order.status}">${order.status}</span>
          </div>
        `).join('');
            }
        }

        // 6. Render Charts
        renderPurchasingCharts(processedRecommendations, orders || [], salesInsights);
        setPurchasingDashboardLoading(false);

    } catch (error) {
        console.error("Error refreshing purchasing dashboard:", error);
        const criticalBody = document.getElementById('dashboard-critical-ingredients-body');
        if (criticalBody) criticalBody.innerHTML = '<tr><td colspan="5" class="text-center muted">Erreur lors du chargement des données.</td></tr>';
        setPurchasingDashboardLoading(false);
    }
}

function setPurchasingDashboardLoading(isLoading) {
    // KPIs loading state
    const kpiGrid = document.querySelector('.purchasing-kpi-grid');
    if (kpiGrid) {
        kpiGrid.style.opacity = isLoading ? '0.6' : '1';
        kpiGrid.style.pointerEvents = isLoading ? 'none' : 'auto';
    }

    // Tables loading state
    const criticalBody = document.getElementById('dashboard-critical-ingredients-body');
    if (criticalBody && isLoading) {
        criticalBody.innerHTML = '<tr><td colspan="5" class="text-center muted"><span class="loading-spinner" style="display: inline-block; width: 20px; height: 20px; border: 2px solid #e5e7eb; border-top-color: #3b82f6; border-radius: 50%; animation: spin 0.8s linear infinite;"></span> Chargement...</td></tr>';
    }

    const ordersList = document.getElementById('dashboard-recent-orders-list');
    if (ordersList && isLoading) {
        ordersList.innerHTML = '<p class="text-center muted"><span class="loading-spinner" style="display: inline-block; width: 20px; height: 20px; border: 2px solid #e5e7eb; border-top-color: #3b82f6; border-radius: 50%; animation: spin 0.8s linear infinite;"></span> Chargement...</p>';
    }

    // Charts loading state
    const chartsGrid = document.querySelector('.purchasing-charts-grid');
    if (chartsGrid) {
        chartsGrid.style.opacity = isLoading ? '0.6' : '1';
    }
}

function clearPurchasingCharts() {
    ['chart-top-sales', 'chart-top-ingredients', 'chart-supplier-orders'].forEach(id => {
        if (purchasingCharts[id]) {
            purchasingCharts[id].destroy();
            purchasingCharts[id] = null;
        }
    });
}

async function renderPurchasingCharts(recommendations, orders, salesInsights) {
    const ChartLib = await ensureChartJsLibrary();
    if (!ChartLib) return;

    // Destroy existing charts if they exist
    ['chart-top-sales', 'chart-top-ingredients', 'chart-supplier-orders'].forEach(id => {
        if (purchasingCharts[id]) {
            purchasingCharts[id].destroy();
            purchasingCharts[id] = null;
        }
    });

    // 1. Top Ingredients Consumed
    const topConsumed = [...recommendations]
        .sort((a, b) => b.total_quantity_consumed - a.total_quantity_consumed)
        .slice(0, 5);

    const ctxIngredients = document.getElementById('chart-top-ingredients');
    if (ctxIngredients) {
        purchasingCharts['chart-top-ingredients'] = new ChartLib(ctxIngredients, {
            type: 'bar',
            data: {
                labels: topConsumed.map(i => i.ingredient_name),
                datasets: [{
                    label: 'Consommation',
                    data: topConsumed.map(i => i.total_quantity_consumed),
                    backgroundColor: 'rgba(37, 99, 235, 0.6)',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } }
            }
        });
    }

    // 2. Supplier Orders Over Time
    const ordersByDate = {};
    orders.forEach(o => {
        const date = new Date(o.created_at).toLocaleDateString();
        ordersByDate[date] = (ordersByDate[date] || 0) + 1;
    });

    const ctxOrders = document.getElementById('chart-supplier-orders');
    if (ctxOrders) {
        purchasingCharts['chart-supplier-orders'] = new ChartLib(ctxOrders, {
            type: 'line',
            data: {
                labels: Object.keys(ordersByDate).reverse(),
                datasets: [{
                    label: 'Commandes',
                    data: Object.values(ordersByDate).reverse(),
                    borderColor: '#10b981',
                    tension: 0.4,
                    fill: true,
                    backgroundColor: 'rgba(16, 185, 129, 0.1)'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
            }
        });
    }

    // 3. Top Sales (using salesInsights.top_items)
    const ctxSales = document.getElementById('chart-top-sales');
    if (ctxSales) {
        let topDishes = [];

        // Extract top items from salesInsights
        if (salesInsights && salesInsights.top_items && Array.isArray(salesInsights.top_items)) {
            topDishes = salesInsights.top_items.slice(0, 5);
        }

        // Create chart even if no data (show empty state)
        if (topDishes.length > 0) {
            purchasingCharts['chart-top-sales'] = new ChartLib(ctxSales, {
                type: 'doughnut',
                data: {
                    labels: topDishes.map(d => d.menu_item_name || 'Sans nom'),
                    datasets: [{
                        data: topDishes.map(d => d.quantity || 0),
                        backgroundColor: [
                            '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'
                        ]
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'right' } }
                }
            });
        } else {
            // Show empty state
            purchasingCharts['chart-top-sales'] = new ChartLib(ctxSales, {
                type: 'doughnut',
                data: {
                    labels: ['Aucune donnée'],
                    datasets: [{
                        data: [1],
                        backgroundColor: ['#e5e7eb']
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: { enabled: false }
                    }
                }
            });
        }
    }
}

// --- View Switcher & Embed ---

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

function setupPurchasingViewSwitcher() {
    // Initialize panels and nav links globally, independent of the switcher
    purchasingViewRuntime.panels = document.querySelectorAll("[data-purchasing-panel]");
    purchasingViewRuntime.navLinks = document.querySelectorAll("[data-purchasing-nav-link]");
    purchasingViewRuntime.navDropdown = document.querySelector("[data-nav-dropdown=\"purchasing\"]");

    const switcher = document.getElementById("purchasing-view-switcher");

    if (switcher) {
        purchasingViewRuntime.container = switcher;
        purchasingViewRuntime.toggle = switcher.querySelector("[data-purchasing-menu-toggle]");
        purchasingViewRuntime.label = switcher.querySelector("[data-purchasing-menu-label]");
        purchasingViewRuntime.menu = switcher.querySelector("[data-purchasing-menu]");
        purchasingViewRuntime.items = switcher.querySelectorAll("[data-purchasing-menu-item]");

        if (purchasingViewRuntime.toggle) {
            purchasingViewRuntime.toggle.addEventListener("click", () => {
                togglePurchasingMenu();
            });
        }

        forEachNode(purchasingViewRuntime.items, (item) => {
            item.addEventListener("click", () => {
                const view = item.getAttribute("data-view") || "dashboard";
                setPurchasingPanel(view);
                closePurchasingMenu();
            });
        });
    }

    // Set default view based on switcher state or default to dashboard
    const defaultView = switcher ? (switcher.getAttribute("data-active-view") || "dashboard") : "dashboard";
    setPurchasingPanel(defaultView);

    document.addEventListener("click", handlePurchasingMenuOutsideClick, true);
    document.addEventListener("keydown", handlePurchasingMenuKeydown);
}

export function setPurchasingPanel(viewId) {
    // Always refresh panels to ensure we have the latest DOM state
    purchasingViewRuntime.panels = document.querySelectorAll("[data-purchasing-panel]");

    const targetView = viewId || "dashboard";
    let hasMatch = false;

    forEachNode(purchasingViewRuntime.panels, (panel) => {
        const panelId = panel.getAttribute("data-purchasing-panel");
        const isActive = panelId === targetView;
        panel.classList.toggle("is-active", isActive);
        if (isActive) {
            panel.removeAttribute("hidden");
            hasMatch = true;
        } else {
            panel.setAttribute("hidden", "");
        }
    });

    // If no match found and we are not targeting dashboard, try to refresh panels and check again
    if (!hasMatch && targetView !== "dashboard") {
        // Refresh panels in case they were added dynamically or missed
        purchasingViewRuntime.panels = document.querySelectorAll("[data-purchasing-panel]");
        forEachNode(purchasingViewRuntime.panels, (panel) => {
            const panelId = panel.getAttribute("data-purchasing-panel");
            if (panelId === targetView) {
                panel.classList.add("is-active");
                panel.removeAttribute("hidden");
                hasMatch = true;
            }
        });
    }

    if (!hasMatch && targetView !== "dashboard") {
        setPurchasingPanel("dashboard");
        return;
    }

    purchasingViewRuntime.activeView = hasMatch ? targetView : "dashboard";
    if (purchasingViewRuntime.container) {
        purchasingViewRuntime.container.setAttribute("data-active-view", purchasingViewRuntime.activeView);
    }
    const activeItem = updatePurchasingMenuItems(purchasingViewRuntime.activeView);
    updatePurchasingMenuLabel(activeItem);
    updatePurchasingNavLinks(purchasingViewRuntime.activeView);
}

function updatePurchasingMenuItems(activeView) {
    let activeItem = null;
    forEachNode(purchasingViewRuntime.items, (item) => {
        const itemView = item.getAttribute("data-view") || "";
        const isActive = itemView === activeView;
        item.classList.toggle("is-active", isActive);
        item.setAttribute("aria-checked", isActive ? "true" : "false");
        if (isActive) {
            activeItem = item;
        }
    });
    return activeItem;
}

function updatePurchasingMenuLabel(activeItem) {
    if (!purchasingViewRuntime.label) {
        return;
    }
    if (!activeItem) {
        purchasingViewRuntime.label.textContent = "Achats & Stock";
        return;
    }
    purchasingViewRuntime.label.textContent = activeItem.textContent.trim();
}

export function updatePurchasingNavLinks(activeView, options) {
    const navLinks = purchasingViewRuntime.navLinks && purchasingViewRuntime.navLinks.length > 0 ? purchasingViewRuntime.navLinks : document.querySelectorAll("[data-purchasing-nav-link]");
    purchasingViewRuntime.navLinks = navLinks;
    const navDropdown = purchasingViewRuntime.navDropdown || document.querySelector("[data-nav-dropdown=\"purchasing\"]");
    purchasingViewRuntime.navDropdown = navDropdown;
    const shouldClear = options && options.forceClear;
    const shouldHighlight = !shouldClear && Boolean(activeView) && isPurchasingSectionActive();
    let hasActiveLink = false;
    forEachNode(navLinks, (navLink) => {
        const linkView = navLink.getAttribute("data-purchasing-view") || "";
        const isActive = shouldHighlight && linkView === activeView;
        navLink.classList.toggle("is-active", isActive);
        if (isActive) {
            navLink.setAttribute("aria-current", "page");
            hasActiveLink = true;
        } else {
            navLink.removeAttribute("aria-current");
        }
    });
    if (navDropdown) {
        navDropdown.classList.toggle("has-active-child", hasActiveLink);
    }
}

function isPurchasingSectionActive() {
    const purchasingSection = document.getElementById("purchasing");
    return Boolean(purchasingSection && purchasingSection.classList.contains("active-section"));
}

function togglePurchasingMenu(forceValue) {
    const container = purchasingViewRuntime.container;
    const toggle = purchasingViewRuntime.toggle;
    if (!container || !toggle) {
        return;
    }
    const isOpen = container.classList.contains("is-open");
    const shouldOpen = typeof forceValue === "boolean" ? forceValue : !isOpen;
    container.classList.toggle("is-open", shouldOpen);
    toggle.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
}

function closePurchasingMenu() {
    togglePurchasingMenu(false);
}

function handlePurchasingMenuOutsideClick(event) {
    const container = purchasingViewRuntime.container;
    if (!container || !container.classList.contains("is-open")) {
        return;
    }
    if (container.contains(event.target)) {
        return;
    }
    closePurchasingMenu();
}

function handlePurchasingMenuKeydown(event) {
    if (event.key !== "Escape") {
        return;
    }
    const container = purchasingViewRuntime.container;
    if (container && container.classList.contains("is-open")) {
        closePurchasingMenu();
        if (purchasingViewRuntime.toggle) {
            purchasingViewRuntime.toggle.focus();
        }
    }
}

function formatInputDate(date) {
    if (!date) return "";
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().split("T")[0];
}

function validateRange(start, end) {
    if (!start || !end) {
        return { message: "Veuillez sélectionner deux dates.", type: "error" };
    }
    const s = new Date(start);
    const e = new Date(end);
    if (s > e) {
        return { message: "La date de début doit être antérieure à la fin.", type: "error" };
    }
    return null;
}
