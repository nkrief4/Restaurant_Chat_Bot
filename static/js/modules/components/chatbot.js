import { state } from "../core/state.js";
import { CHATBOT_HISTORY_LIMIT, CHAT_TESTER_WINDOW_NAME, CHAT_TESTER_WINDOW_FEATURES, CHAT_PAGE_PATH } from "../core/constants.js";
import { getAccessToken } from "../core/auth.js";
import { createChatSurface } from "./chat_surface.js";

// --- Chatbot Logic ---
let chatbotSurface = null;
let hasRestaurantListener = false;

export function bindChatbotUI() {
    if (!chatbotSurface) {
        chatbotSurface = createChatSurface({
            thread: document.getElementById("chatbot-thread"),
            empty: document.getElementById("chatbot-empty-state"),
            typing: document.getElementById("chatbot-typing"),
            form: document.getElementById("chatbot-form"),
            input: document.getElementById("chatbot-input"),
            sendButton: document.getElementById("chatbot-send-btn"),
            status: document.getElementById("chatbot-feedback"),
            history: state.chatbot.history,
            historyLimit: CHATBOT_HISTORY_LIMIT,
            getContext: () => ({
                restaurantId: state.chatbot.restaurantId,
                restaurantName: state.chatbot.restaurantName,
            }),
            getAuthToken: getAccessToken,
            getSessionId: () => state.chatbot.sessionId,
            setSessionId: (value) => {
                state.chatbot.sessionId = value;
            },
            resetSessionId: () => {
                state.chatbot.sessionId = null;
            },
            placeholder: (context) => context.restaurantId
                ? `Message pour ${context.restaurantName || "votre restaurant"}…`
                : "Utilisez le sélecteur global pour commencer.",
            emptyMessage: (context) => context.restaurantId
                ? `Discutez avec ${context.restaurantName || "votre restaurant"}.`
                : "Utilisez le sélecteur global puis dites bonjour à votre assistant.",
            onStateChange: ({ isSending, hasInteracted }) => {
                state.chatbot.isSending = isSending;
                state.chatbot.hasInteracted = hasInteracted;
            },
        });
        chatbotSurface.bind();
    }
    const resetBtn = document.getElementById("chatbot-reset-btn");
    if (resetBtn) {
        resetBtn.addEventListener("click", (event) => {
            event.preventDefault();
            chatbotSurface?.reset();
        });
    }
    const fullscreenBtn = document.getElementById("chatbot-fullscreen-btn");
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener("click", (event) => {
            event.preventDefault();
            if (!fullscreenBtn.disabled && state.chatbot.restaurantId) {
                launchChatTester(state.chatbot.restaurantId, state.chatbot.restaurantName);
            }
        });
    }
    if (!hasRestaurantListener) {
        document.addEventListener("activeRestaurantChange", (event) => {
            const nextId = event?.detail?.id ? String(event.detail.id) : null;
            if (!nextId) {
                applyChatbotSelectionFromGlobal(null, { changed: true });
                return;
            }
            const restaurants = Array.isArray(state.restaurants) ? state.restaurants : [];
            const match = restaurants.find((restaurant) => restaurant && String(restaurant.id) === nextId);
            applyChatbotSelectionFromGlobal(match || null, { changed: true });
        });
        hasRestaurantListener = true;
    }
}

export function syncChatbotStateWithRestaurants() {
    const restaurants = Array.isArray(state.restaurants) ? state.restaurants : [];
    if (!restaurants.length) {
        const hadSelection = Boolean(state.chatbot.restaurantId);
        applyChatbotSelectionFromGlobal(null, { changed: hadSelection });
        setChatbotFeedback("Ajoutez un restaurant pour tester le chatbot.");
        return;
    }

    if (!state.overview.restaurantId) {
        const hadSelection = Boolean(state.chatbot.restaurantId);
        applyChatbotSelectionFromGlobal(null, { changed: hadSelection });
        return;
    }

    const match = restaurants.find(
        (restaurant) => restaurant && String(restaurant.id) === String(state.overview.restaurantId)
    );
    if (match) {
        applyChatbotSelectionFromGlobal(match, { changed: false });
    } else {
        const hadSelection = Boolean(state.chatbot.restaurantId);
        applyChatbotSelectionFromGlobal(null, { changed: hadSelection });
    }
}

export function applyChatbotSelectionFromGlobal(record, options = {}) {
    const { changed = false } = options;
    const previousId = state.chatbot.restaurantId ? String(state.chatbot.restaurantId) : null;
    const nextId = record?.id ? String(record.id) : null;

    if (!nextId) {
        const hadSelection = Boolean(previousId);
        state.chatbot.restaurantId = null;
        state.chatbot.restaurantName = "";
        state.chatbot.hasManualSelection = false;
        if (hadSelection || changed) {
            chatbotSurface?.reset();
            setChatbotFeedback("Utilisez le sélecteur global pour lancer la discussion.");
        }
        syncChatbotControls();
        return;
    }

    state.chatbot.restaurantId = nextId;
    state.chatbot.restaurantName = record.display_name || record.name || "";
    state.chatbot.hasManualSelection = true;

    if (previousId !== nextId || changed) {
        chatbotSurface?.reset();
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
    const launchBtn = document.getElementById("chatbot-fullscreen-btn");
    const hasRestaurants = Array.isArray(state.restaurants) && state.restaurants.length > 0;
    const hasSelection = Boolean(state.chatbot.restaurantId);

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
        statusMessage = "Utilisez le sélecteur global pour charger son contexte.";
    } else {
        statusMessage = `${state.chatbot.restaurantName || "Votre restaurant"} est prêt à répondre.`;
    }
    setChatbotStatus(statusMessage, isError);
    chatbotSurface?.refresh();
}

function setChatbotFeedback(message, isError = false) {
    chatbotSurface?.setStatus(message, isError);
}

function setChatbotStatus(message, isError = false) {
    const hint = document.getElementById("chatbot-selection-hint");
    if (!hint) {
        return;
    }
    const resolved = message || "Utilisez le sélecteur global pour activer le chatbot.";
    hint.textContent = resolved;
    hint.classList.toggle("error", Boolean(isError));
}

function focusChatbotInput() {
    const input = document.getElementById("chatbot-input");
    if (input && !input.disabled) {
        input.focus();
    }
}

// --- Chat Tester & QR ---

export function launchChatTester(restaurantId, restaurantName) {
    if (state.isLaunchingChat) {
        return;
    }
    state.isLaunchingChat = true;

    const target = resolveRestaurantRecord(restaurantId);
    if (!target) {
        // showToast("Ajoutez un restaurant pour tester le chatbot.");
        document.dispatchEvent(new CustomEvent('showToast', { detail: { message: "Ajoutez un restaurant pour tester le chatbot." } }));
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
        // showToast("Impossible d'ouvrir le chatbot dans un nouvel onglet. Autorisez les fenêtres pop-up puis réessayez.");
        document.dispatchEvent(new CustomEvent('showToast', { detail: { message: "Impossible d'ouvrir le chatbot dans un nouvel onglet. Autorisez les fenêtres pop-up puis réessayez." } }));
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

const shareModalState = {
    element: document.getElementById("chatbot-modal"),
    trigger: null,
    currentUrl: "",
    nameEl: document.getElementById("modal-restaurant-name"),
    linkInput: document.getElementById("qr-share-link"),
};

export function setupQrModal() {
    // Re-bind elements if they were null initially (though they should be present in DOM)
    if (!shareModalState.element) shareModalState.element = document.getElementById("chatbot-modal");
    if (!shareModalState.nameEl) shareModalState.nameEl = document.getElementById("modal-restaurant-name");
    if (!shareModalState.linkInput) shareModalState.linkInput = document.getElementById("qr-share-link");

    const closeBtn = shareModalState.element?.querySelector("[data-modal-close]");
    const copyBtn = shareModalState.element?.querySelector("[data-action='copy-qr-link']");
    const openBtn = shareModalState.element?.querySelector("[data-action='open-qr-link']");

    if (closeBtn) {
        closeBtn.addEventListener("click", closeQrModal);
    }

    // Close modal when clicking on the backdrop (not the content)
    if (shareModalState.element) {
        shareModalState.element.addEventListener("click", (e) => {
            if (e.target === shareModalState.element) {
                closeQrModal();
            }
        });
    }

    if (copyBtn) {
        copyBtn.addEventListener("click", handleQrCopy);
    }

    if (openBtn) {
        openBtn.addEventListener("click", () => {
            if (shareModalState.currentUrl) {
                window.open(shareModalState.currentUrl, '_blank');
            }
        });
    }

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && shareModalState.element && shareModalState.element.classList.contains("open")) {
            closeQrModal();
        }
    });
}

export function openQrModal(restaurant, triggerButton) {
    if (!shareModalState.element) {
        // showToast("Impossible d'ouvrir le QR code pour le moment.");
        document.dispatchEvent(new CustomEvent('showToast', { detail: { message: "Impossible d'ouvrir le QR code pour le moment." } }));
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
    shareModalState.element.removeAttribute("hidden");
    shareModalState.element.setAttribute("aria-hidden", "false");
}

export function closeQrModal() {
    if (!shareModalState.element) {
        return;
    }
    shareModalState.element.classList.remove("open");
    shareModalState.element.setAttribute("hidden", "");
    shareModalState.element.setAttribute("aria-hidden", "true");
    shareModalState.currentUrl = "";
    updateQrCopyStatus("");
    const trigger = shareModalState.trigger;
    if (trigger) {
        trigger.focus();
    }
    shareModalState.trigger = null;
}

function handleQrCopy() {
    if (!shareModalState.currentUrl) {
        return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareModalState.currentUrl)
            .then(() => {
                updateQrCopyStatus("Lien copié !");
                // showToast("Lien copié dans le presse-papier.");
                document.dispatchEvent(new CustomEvent('showToast', { detail: { message: "Lien copié dans le presse-papier." } }));
            })
            .catch(() => {
                fallbackCopy();
            });
    } else {
        fallbackCopy();
    }
}

function fallbackCopy() {
    const input = shareModalState.linkInput;
    if (!input) {
        return;
    }
    input.select();
    try {
        document.execCommand("copy");
        updateQrCopyStatus("Lien copié !");
        // showToast("Lien copié.");
        document.dispatchEvent(new CustomEvent('showToast', { detail: { message: "Lien copié." } }));
    } catch (err) {
        updateQrCopyStatus("Erreur copie");
    }
}

function updateQrCopyStatus(message) {
    const btn = shareModalState.element?.querySelector("[data-action='copy-qr-link']");
    if (!btn) {
        return;
    }
    const originalText = btn.dataset.originalText || "Copier";
    if (!btn.dataset.originalText) {
        btn.dataset.originalText = btn.textContent;
    }
    if (message) {
        btn.textContent = message;
        btn.classList.add("copied");
        setTimeout(() => {
            btn.textContent = originalText;
            btn.classList.remove("copied");
        }, 2000);
    } else {
        btn.textContent = originalText;
        btn.classList.remove("copied");
    }
}

function updateQrVisualWithUrl(url) {
    const img = document.getElementById("qr-code-image");
    const placeholder = document.getElementById("qr-code-placeholder");

    if (!img) {
        return;
    }

    if (!url) {
        img.hidden = true;
        if (placeholder) placeholder.hidden = false;
        return;
    }

    // Using a simple QR code API for demonstration. 
    // In production, use a local library or a reliable API.
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
    img.alt = `QR Code vers ${url}`;
    img.hidden = false;
    if (placeholder) placeholder.hidden = true;
}
