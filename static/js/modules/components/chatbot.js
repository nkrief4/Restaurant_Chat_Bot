import { state } from "../core/state.js";
import { CHATBOT_HISTORY_LIMIT, CHAT_TESTER_WINDOW_NAME, CHAT_TESTER_WINDOW_FEATURES, CHAT_PAGE_PATH } from "../core/constants.js";
import { escapeHtml, formatChatbotMessage } from "../utils/format.js";
import { getAccessToken } from "../core/auth.js";

// --- Chatbot Logic ---

export function bindChatbotUI() {
    const form = document.getElementById("chatbot-form");
    if (form) {
        form.addEventListener("submit", handleChatbotSubmit);
    }
    const resetBtn = document.getElementById("chatbot-reset-btn");
    if (resetBtn) {
        resetBtn.addEventListener("click", (event) => {
            event.preventDefault();
            resetChatbotConversation();
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
    const input = document.getElementById("chatbot-input");
    if (input) {
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (form) form.requestSubmit();
            }
        });
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
            resetChatbotConversation();
            setChatbotFeedback("Utilisez le sélecteur global pour lancer la discussion.");
        }
        syncChatbotControls();
        return;
    }

    state.chatbot.restaurantId = nextId;
    state.chatbot.restaurantName = record.display_name || record.name || "";
    state.chatbot.hasManualSelection = true;

    if (previousId !== nextId || changed) {
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

    refreshChatbotFormAvailability();
    updateChatbotEmptyState();
}

export async function handleChatbotSubmit(event) {
    event.preventDefault();
    if (state.chatbot.isSending) {
        return;
    }
    if (!state.chatbot.restaurantId) {
        setChatbotFeedback("Utilisez le sélecteur global avant de discuter.", true);
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
            : "Utilisez le sélecteur global pour commencer.";
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
            : "Utilisez le sélecteur global puis dites bonjour à votre assistant.";
        empty.innerHTML = `<p>${escapeHtml(baseMessage)}</p>`;
    }
}

function appendChatbotMessage(text, role, options = {}) {
    const feed = document.getElementById("chatbot-thread");
    if (!feed) {
        return null;
    }
    const resolvedRole = role === "assistant" ? "assistant" : "user";

    const message = document.createElement("div");
    message.className = `chat-message ${resolvedRole}`;

    const avatar = document.createElement("div");
    avatar.className = "chat-message-avatar";
    avatar.textContent = resolvedRole === "assistant" ? "AI" : "Vous";

    const content = document.createElement("div");
    content.className = "chat-message-content";

    const author = document.createElement("p");
    author.className = "chat-message-author";
    author.textContent =
        resolvedRole === "assistant"
            ? state.chatbot.restaurantName || "RestauBot"
            : "Vous";

    const body = document.createElement("div");
    body.className = "chatbot-text";
    const rawText = (text || "").toString();
    if (options.skipFormat) {
        body.textContent = rawText;
    } else if (rawText) {
        body.innerHTML = formatChatbotMessage(rawText);
    }

    content.append(author, body);

    if (!options.hideMeta) {
        const meta = document.createElement("small");
        meta.className = "chat-message-meta";
        meta.textContent = new Date().toLocaleTimeString("fr-FR", {
            hour: "2-digit",
            minute: "2-digit",
        });
        content.appendChild(meta);
    }

    message.append(avatar, content);
    feed.appendChild(message);
    feed.scrollTop = feed.scrollHeight;
    updateChatbotEmptyState();
    if (options.returnElements) {
        return { bubble: message, body };
    }
    return message;
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
