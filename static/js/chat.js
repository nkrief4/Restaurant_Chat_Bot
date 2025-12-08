document.addEventListener("DOMContentLoaded", () => {
  // Check if we are on the standalone chat page
  const isStandalone = document.body.classList.contains("chat-experience");

  let messagesContainer, input, sendButton, chatWindow, bubble;
  let restaurantId = null;
  let restaurantName = "Restaurant";

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
    input = document.getElementById("chat-input");
    sendButton = document.getElementById("chat-send");
    const titleEl = document.getElementById("chat-restaurant-name");
    if (titleEl) titleEl.textContent = restaurantName;

    // Update status
    const statusEl = document.getElementById("chat-status");
    if (statusEl) statusEl.innerHTML = '<span class="status-dot"></span><span>En ligne</span>';

    // Load menu from localStorage cache if available
    const menuSection = document.getElementById("menu-sections");
    const menuEmpty = document.getElementById("menu-empty-state");

    if (restaurantId && window.localStorage) {
      try {
        const cachedData = window.localStorage.getItem(`restaubot-chat-${restaurantId}`);
        if (cachedData) {
          const data = JSON.parse(cachedData);
          if (data.menu_document) {
            displayMenu(data.menu_document, menuSection, menuEmpty);
          }
        }
      } catch (error) {
        console.warn('Could not load menu from cache:', error);
      }
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

    const message = document.createElement("div");
    message.className = `message ${role}`;
    const content = document.createElement("div");
    content.innerHTML = formatMessageText(text);
    const timestamp = document.createElement("small");
    timestamp.textContent = new Date().toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit"
    });
    message.appendChild(content);
    message.appendChild(timestamp);
    messagesContainer.appendChild(message);
    if (messagesContainer.childNodes.length > 50) {
      messagesContainer.removeChild(messagesContainer.firstChild);
    }
    scrollToBottom();
    return message;
  };

  const showTypingIndicator = () => {
    if (!messagesContainer) return;

    const message = document.createElement("div");
    message.className = "message assistant";
    const indicator = document.createElement("div");
    indicator.className = "typing-indicator";
    indicator.innerHTML = "<span></span><span></span><span></span>";
    message.appendChild(indicator);
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

  const sendMessage = async () => {
    if (!input) return;
    const userMessage = input.value.trim();
    if (!userMessage || isSending) {
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
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Erreur HTTP ${response.status}`);
      }

      const data = await response.json();
      if (messagesContainer && typingMessage && messagesContainer.contains(typingMessage)) {
        messagesContainer.removeChild(typingMessage);
      }
      const reply = data?.reply || "Désolé, une erreur est survenue. Réessayez plus tard.";
      appendMessage(reply, "assistant");
      recordHistory("assistant", reply);
    } catch (error) {
      console.error(error);
      if (messagesContainer && typingMessage && messagesContainer.contains(typingMessage)) {
        messagesContainer.removeChild(typingMessage);
      }
      appendMessage("Désolé, une erreur est survenue. Réessayez plus tard.", "assistant");
    } finally {
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

  // Function to display menu
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

        if (item.price) {
          const itemPrice = document.createElement('span');
          itemPrice.className = 'menu-item-price';
          itemPrice.textContent = `${item.price}€`;
          itemHeader.appendChild(itemPrice);
        }

        itemEl.appendChild(itemHeader);

        if (item.description) {
          const itemDesc = document.createElement('p');
          itemDesc.className = 'menu-item-description';
          itemDesc.textContent = item.description;
          itemEl.appendChild(itemDesc);
        }

        if (item.tags && item.tags.length > 0) {
          const tagsEl = document.createElement('div');
          tagsEl.className = 'menu-item-tags';
          item.tags.forEach(tag => {
            const tagSpan = document.createElement('span');
            tagSpan.className = 'menu-tag';
            tagSpan.textContent = tag;
            tagsEl.appendChild(tagSpan);
          });
          itemEl.appendChild(tagsEl);
        }

        itemsList.appendChild(itemEl);
      });

      section.appendChild(itemsList);
      menuSection.appendChild(section);
    });
  }
});
