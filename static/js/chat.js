document.addEventListener("DOMContentLoaded", () => {
  // Check if we are on the standalone chat page
  const isStandalone = document.body.classList.contains("chat-experience");
  const requiresDashboardAuth = isStandalone;

  let messagesContainer, input, sendButton, chatWindow, bubble, chatForm;
  let restaurantId = null;
  let restaurantName = "Restaurant";
  let supabaseClientPromise = null;
  let authToken = null;

  // Parse URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  restaurantId = urlParams.get("restaurant_id");
  const nameParam = urlParams.get("restaurant_name");
  if (nameParam) {
    restaurantName = nameParam;
  }

  if (isStandalone) {
    // Use existing elements
    messagesContainer = document.getElementById("chat-messages");
    chatForm = document.getElementById("chat-form");
    input = document.getElementById("chat-input");
    sendButton = document.getElementById("chat-send");
    const titleEl = document.getElementById("chat-restaurant-name");
    if (titleEl) titleEl.textContent = restaurantName;

    // Update status
    const statusEl = document.getElementById("chat-status");
    if (statusEl) statusEl.innerHTML = '<span class="status-dot"></span><span>En ligne</span>';

    // Load optimized menu from API based on ingredient stock
    const menuSection = document.getElementById("menu-sections");
    const menuEmpty = document.getElementById("menu-empty-state");

    if (restaurantId) {
      loadOptimizedMenu(restaurantId, menuSection, menuEmpty);
    }

    // Hide loading overlay
    const loadingOverlay = document.getElementById("chat-loading-overlay");
    if (loadingOverlay) {
      setTimeout(() => {
        loadingOverlay.style.opacity = '0';
        setTimeout(() => {
          loadingOverlay.style.display = 'none';
        }, 300);
      }, 500);
    }

  } else {
    // Create widget elements
    bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    bubble.textContent = "💬";

    chatWindow = document.createElement("div");
    chatWindow.className = "chat-window";

    const header = document.createElement("div");
    header.className = "chat-header";
    const headerInfo = document.createElement("div");
    const headerTitle = document.createElement("h2");
    headerTitle.textContent = "Assistant du restaurant";
    const headerStatus = document.createElement("div");
    headerStatus.className = "chat-status";
    headerStatus.innerHTML = '<span class="status-dot"></span><span>Disponible</span>';
    headerInfo.appendChild(headerTitle);
    headerInfo.appendChild(headerStatus);
    const headerAction = document.createElement("button");
    headerAction.type = "button";
    headerAction.textContent = "–";
    headerAction.setAttribute("aria-label", "Réduire le chat");
    headerAction.style.background = "transparent";
    headerAction.style.border = "none";
    headerAction.style.color = "#cbd5f5";
    headerAction.style.fontSize = "22px";
    headerAction.style.cursor = "pointer";
    headerAction.addEventListener("click", () => chatWindow.classList.remove("open"));
    header.appendChild(headerInfo);
    header.appendChild(headerAction);

    messagesContainer = document.createElement("div");
    messagesContainer.className = "chat-messages";

    const inputArea = document.createElement("div");
    inputArea.className = "chat-input-area";

    input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Pose ta question...";

    sendButton = document.createElement("button");
    sendButton.textContent = "Envoyer";

    inputArea.appendChild(input);
    inputArea.appendChild(sendButton);

    chatWindow.appendChild(header);
    chatWindow.appendChild(messagesContainer);
    chatWindow.appendChild(inputArea);

    document.body.appendChild(bubble);
    document.body.appendChild(chatWindow);

    // Widget toggle logic
    bubble.addEventListener("click", toggleChat);
  }

  let hasGreeted = false;
  let isSending = false;
  const conversationHistory = [];
  const MAX_HISTORY_ITEMS = 12;
  let currentSessionId = null;
  const typingIndicatorEl = document.getElementById("typing-indicator");

  const generateSessionId = () => {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    const random = Math.random().toString(16).slice(2, 10);
    return `${Date.now().toString(36)}-${random}`;
  };

  const ensureSessionId = () => {
    if (!currentSessionId) {
      currentSessionId = generateSessionId();
    }
    return currentSessionId;
  };

  const resetSessionId = () => {
    currentSessionId = null;
  };

  const recordHistory = (role, content) => {
    if (!content?.trim()) {
      return;
    }
    conversationHistory.push({ role, content });
    if (conversationHistory.length > MAX_HISTORY_ITEMS) {
      conversationHistory.shift();
    }
  };

  const scrollToBottom = () => {
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  };

  const sanitizeHTML = (value = "") =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const formatMessageText = (text) => {
    const safe = sanitizeHTML(text).trim();
    if (!safe) {
      return "";
    }

    const lines = safe.split(/\n+/);
    const blocks = [];
    let listItems = [];

    const flushList = () => {
      if (!listItems.length) {
        return;
      }
      const itemsHTML = listItems.map((item) => `<li>${item}</li>`).join("");
      blocks.push(`<ul>${itemsHTML}</ul>`);
      listItems = [];
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        flushList();
        continue;
      }

      if (/^(?:[-*•]\s+)/.test(trimmed)) {
        listItems.push(trimmed.replace(/^(?:[-*•]\s+)/, ""));
        continue;
      }

      flushList();

      if (/^section\s*:/i.test(trimmed) || /^(?:conseils?|à savoir)\s*:/i.test(trimmed)) {
        blocks.push(`<p class="section-title">${trimmed}</p>`);
      } else {
        blocks.push(`<p>${trimmed}</p>`);
      }
    }

    flushList();
    return blocks.join("") || `<p>${safe}</p>`;
  };

  const appendMessage = (text, role) => {
    if (!messagesContainer) return;
    const formatted = formatMessageText(text);
    const resolvedRole = role === "user" ? "user" : "assistant";

    const message = document.createElement("div");
    message.className = `chat-message ${resolvedRole}`;

    const avatar = document.createElement("div");
    avatar.className = "chat-message-avatar";
    avatar.textContent = resolvedRole === "user" ? "Vous" : "AI";

    const content = document.createElement("div");
    content.className = "chat-message-content";

    const author = document.createElement("p");
    author.className = "chat-message-author";
    author.textContent = resolvedRole === "user" ? "Vous" : restaurantName || "RestauBot";

    const body = document.createElement("div");
    body.className = "chatbot-text";
    body.innerHTML = formatted || "<p></p>";

    content.append(author, body);

    if (!isStandalone) {
      const meta = document.createElement("small");
      meta.className = "chat-message-meta";
      meta.textContent = new Date().toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit"
      });
      content.appendChild(meta);
    }

    message.append(avatar, content);
    messagesContainer.appendChild(message);

    if (messagesContainer.childNodes.length > 60) {
      messagesContainer.removeChild(messagesContainer.firstChild);
    }
    scrollToBottom();
    return message;
  };

  const showTypingIndicator = () => {
    if (typingIndicatorEl) {
      typingIndicatorEl.hidden = false;
      return typingIndicatorEl;
    }
    if (!messagesContainer) return;

    const message = document.createElement("div");
    message.className = "chat-message assistant";

    const avatar = document.createElement("div");
    avatar.className = "chat-message-avatar";
    avatar.textContent = "AI";

    const content = document.createElement("div");
    content.className = "chat-message-content";

    const indicator = document.createElement("div");
    indicator.className = "typing-indicator";
    indicator.innerHTML = "<span></span><span></span><span></span>";

    content.appendChild(indicator);
    message.append(avatar, content);
    messagesContainer.appendChild(message);
    scrollToBottom();
    return message;
  };

  const greetIfNeeded = () => {
    if (hasGreeted) {
      return;
    }
    appendMessage(
      `Bonjour ! Bienvenue chez ${restaurantName}. Je suis là pour vous guider dans la carte. Que puis-je faire pour vous ?`,
      "assistant"
    );
    hasGreeted = true;
  };

  const setSendingState = (sending) => {
    isSending = sending;
    if (input) input.disabled = sending;
    if (sendButton) sendButton.disabled = sending;
    if (chatForm) {
      chatForm.classList.toggle("is-sending", sending);
    }
    if (!sending && input) {
      input.focus();
    }
  };

  function toggleChat() {
    if (!chatWindow) return;
    const isOpen = chatWindow.classList.contains("open");
    if (isOpen) {
      chatWindow.classList.remove("open");
      resetSessionId();
      return;
    }
    chatWindow.classList.add("open");
    ensureSessionId();
    if (input) input.focus();
    greetIfNeeded();
  }

  const buildChatHeaders = (token) => {
    const headers = { "Content-Type": "application/json" };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  };

  const getSupabaseInstance = async () => {
    if (!requiresDashboardAuth) {
      return null;
    }
    if (supabaseClientPromise) {
      return supabaseClientPromise;
    }
    if (typeof window.getSupabaseClient !== "function") {
      supabaseClientPromise = Promise.resolve(null);
      return supabaseClientPromise;
    }
    supabaseClientPromise = window
      .getSupabaseClient()
      .catch((error) => {
        console.warn("[Chat] Supabase client unavailable:", error);
        return null;
      });
    return supabaseClientPromise;
  };

  const resolveAuthToken = async () => {
    if (!requiresDashboardAuth) {
      return null;
    }
    if (authToken) {
      return authToken;
    }
    const supabaseClient = await getSupabaseInstance();
    if (!supabaseClient) {
      return null;
    }
    try {
      const { data } = await supabaseClient.auth.getSession();
      authToken = data?.session?.access_token || null;
      return authToken;
    } catch (error) {
      console.warn("[Chat] Unable to fetch Supabase session:", error);
      return null;
    }
  };

  const invalidateAuthToken = () => {
    authToken = null;
  };

  const sendMessage = async () => {
    if (!input) return;
    const userMessage = input.value.trim();
    if (!userMessage || isSending) {
      return;
    }
    if (!restaurantId) {
      appendMessage("Aucun restaurant n'a été sélectionné pour ce chat.", "assistant");
      input.value = "";
      return;
    }

    appendMessage(userMessage, "user");
    input.value = "";
    setSendingState(true);

    // Hide empty state if standalone
    if (isStandalone) {
      const emptyState = document.getElementById("chat-empty-state");
      if (emptyState) emptyState.hidden = true;
    }

    const typingMessage = showTypingIndicator();

    const payload = {
      message: userMessage,
      history: conversationHistory.slice(),
      session_id: ensureSessionId(),
      restaurant_id: restaurantId // Include restaurant_id
    };

    recordHistory("user", userMessage);

    try {
      const token = await resolveAuthToken();
      if (requiresDashboardAuth && !token) {
        throw new Error("AUTH_REQUIRED");
      }

      const requestBody = JSON.stringify(payload);
      const makeRequest = (headers) =>
        fetch("/api/chat", {
          method: "POST",
          headers,
          body: requestBody
        });

      let response = await makeRequest(buildChatHeaders(token));

      if (response.status === 401 && requiresDashboardAuth) {
        invalidateAuthToken();
        const refreshed = await resolveAuthToken();
        if (refreshed) {
          response = await makeRequest(buildChatHeaders(refreshed));
        }
      }

      if (!response.ok) {
        throw new Error(`Erreur HTTP ${response.status}`);
      }

      const data = await response.json();
      const reply = data?.reply || "Désolé, une erreur est survenue. Réessayez plus tard.";
      appendMessage(reply, "assistant");
      recordHistory("assistant", reply);
    } catch (error) {
      console.error(error);
      if (error.message === "AUTH_REQUIRED") {
        appendMessage("Votre session a expiré. Actualisez la page pour relancer le chatbot.", "assistant");
      } else {
        appendMessage("Désolé, une erreur est survenue. Réessayez plus tard.", "assistant");
      }
    } finally {
      if (typingMessage) {
        if (typingMessage === typingIndicatorEl && typingIndicatorEl) {
          typingIndicatorEl.hidden = true;
        } else if (messagesContainer && messagesContainer.contains(typingMessage)) {
          messagesContainer.removeChild(typingMessage);
        }
      }
      if (typingIndicatorEl) {
        typingIndicatorEl.hidden = true;
      }
      setSendingState(false);
    }
  };

  if (sendButton) {
    sendButton.addEventListener("click", (e) => {
      e.preventDefault(); // Prevent form submission if in form
      sendMessage();
    });
  }

  if (input) {
    input.addEventListener("keypress", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });
  }

  // Auto-greet if standalone
  if (isStandalone) {
    greetIfNeeded();
  }

  // Function to load optimized menu from API
  async function loadOptimizedMenu(restaurantId, menuSection, menuEmpty) {
    if (!menuSection) return;

    try {
      const response = await fetch(`/api/menu/optimized/${restaurantId}`);

      if (!response.ok) {
        console.error('Failed to load optimized menu:', response.status);
        // Fallback to empty state
        if (menuEmpty) menuEmpty.hidden = false;
        if (menuSection) menuSection.hidden = true;
        return;
      }

      const data = await response.json();
      displayOptimizedMenu(data.categories, menuSection, menuEmpty);
    } catch (error) {
      console.error('Error loading optimized menu:', error);
      // Fallback to empty state
      if (menuEmpty) menuEmpty.hidden = false;
      if (menuSection) menuSection.hidden = true;
    }
  }

  // Function to display optimized menu
  function displayOptimizedMenu(categories, menuSection, menuEmpty) {
    if (!menuSection || !categories || categories.length === 0) {
      if (menuEmpty) menuEmpty.hidden = false;
      return;
    }

    // Hide empty state and show menu
    if (menuEmpty) menuEmpty.hidden = true;
    menuSection.hidden = false;
    menuSection.innerHTML = '';

    categories.forEach(category => {
      if (!category.items || category.items.length === 0) return;

      const section = document.createElement('div');
      section.className = 'menu-category';

      const title = document.createElement('h3');
      title.className = 'menu-category-title';
      title.textContent = category.name || 'Sans nom';
      section.appendChild(title);

      const itemsList = document.createElement('div');
      itemsList.className = 'menu-items';

      category.items.forEach((item, index) => {
        const itemEl = document.createElement('div');
        itemEl.className = 'menu-item';

        // Add visual indicator for high-stock items (top 2 in category)
        if (index < 2 && item.availability_score >= 75) {
          itemEl.classList.add('high-stock-item');
          const badge = document.createElement('span');
          badge.className = 'stock-badge';
          badge.textContent = '⭐ Disponible';
          badge.title = 'Plat avec ingrédients en stock optimal';
          itemEl.appendChild(badge);
        }

        const itemHeader = document.createElement('div');
        itemHeader.className = 'menu-item-header';

        const itemName = document.createElement('h4');
        itemName.className = 'menu-item-name';
        itemName.textContent = item.name || 'Sans nom';
        itemHeader.appendChild(itemName);

        if (item.menu_price) {
          const itemPrice = document.createElement('span');
          itemPrice.className = 'menu-item-price';
          itemPrice.textContent = `${item.menu_price.toFixed(2)}€`;
          itemHeader.appendChild(itemPrice);
        }

        itemEl.appendChild(itemHeader);

        if (item.description) {
          const itemDesc = document.createElement('p');
          itemDesc.className = 'menu-item-description';
          itemDesc.textContent = item.description;
          itemEl.appendChild(itemDesc);
        }

        itemsList.appendChild(itemEl);
      });

      section.appendChild(itemsList);
      menuSection.appendChild(section);
    });
  }

  // Original function kept for backward compatibility
  function displayMenu(menuDocument, menuSection, menuEmpty) {
    if (!menuSection || !menuDocument) return;

    const menu = typeof menuDocument === 'string' ? JSON.parse(menuDocument) : menuDocument;

    if (!menu.categories || !Array.isArray(menu.categories) || menu.categories.length === 0) {
      return;
    }

    // Hide empty state and show menu
    if (menuEmpty) menuEmpty.hidden = true;
    menuSection.hidden = false;
    menuSection.innerHTML = '';

    menu.categories.forEach(category => {
      if (!category.items || category.items.length === 0) return;

      const section = document.createElement('div');
      section.className = 'menu-category';

      const title = document.createElement('h3');
      title.className = 'menu-category-title';
      title.textContent = category.name || 'Sans nom';
      section.appendChild(title);

      const itemsList = document.createElement('div');
      itemsList.className = 'menu-items';

      category.items.forEach(item => {
        const itemEl = document.createElement('div');
        itemEl.className = 'menu-item';

        const itemHeader = document.createElement('div');
        itemHeader.className = 'menu-item-header';

        const itemName = document.createElement('h4');
        itemName.className = 'menu-item-name';
        itemName.textContent = item.name || 'Sans nom';
        itemHeader.appendChild(itemName);

        if (item.menu_price) {
          const itemPrice = document.createElement('span');
          itemPrice.className = 'menu-item-price';
          itemPrice.textContent = `${item.menu_price.toFixed(2)}€`;
          itemHeader.appendChild(itemPrice);
        }

        itemEl.appendChild(itemHeader);

        if (item.description) {
          const itemDesc = document.createElement('p');
          itemDesc.className = 'menu-item-description';
          itemDesc.textContent = item.description;
          itemEl.appendChild(itemDesc);
        }

        if (item.tags && Array.isArray(item.tags) && item.tags.length > 0) {
          const tagsContainer = document.createElement('div');
          tagsContainer.className = 'menu-item-tags';
          item.tags.forEach(tag => {
            const tagEl = document.createElement('span');
            tagEl.className = 'menu-tag';
            tagEl.textContent = tag;
            tagsContainer.appendChild(tagEl);
          });
          itemEl.appendChild(tagsContainer);
        }

        itemsList.appendChild(itemEl);
      });

      section.appendChild(itemsList);
      menuSection.appendChild(section);
    });
  }
});
