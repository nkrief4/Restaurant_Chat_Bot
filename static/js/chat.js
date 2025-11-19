(function () {
  const MAX_HISTORY = 12;
  const DEFAULT_RESTAURANT_NAME = 'Restaurant en cours de chargement…';
  const UNAVAILABLE_RESTAURANT_NAME = 'Restaurant indisponible';
  let overlayTimeoutId = null;

  const state = {
    supabase: null,
    session: null,
    userId: null,
    tenantId: null,
    restaurants: [],
    restaurantId: null,
    restaurantName: DEFAULT_RESTAURANT_NAME,
    hasPreselectedRestaurant: false,
    history: [],
    isSending: false,
    sessionId: null,
    hasInteracted: false,
    menuDocument: null,
  };

  document.addEventListener('DOMContentLoaded', () => {
    initialize().catch((error) => {
      console.error('Chat page initialization failed', error);
      showStatus("Impossible de charger le chatbot. Vérifiez votre connexion et réessayez.", true);
      disableChatForm();
      setLoadingOverlayVisible(false);
    });
  });

  async function initialize() {
    setLoadingOverlayVisible(true);
    try {
      state.supabase = await window.getSupabaseClient();
      bindAuthListener();
      await ensureAuthenticated();
      await loadTenantContext();
      bindLogout();

      const context = getRestaurantContextFromUrl();
      state.hasPreselectedRestaurant = Boolean(context.id);

      if (!state.hasPreselectedRestaurant) {
        await loadRestaurantDirectory();
      }

      setActiveRestaurant(context.id, context.name, { updateUrl: false });

      if (!state.restaurantId && state.restaurants.length) {
        const first = state.restaurants[0];
        setActiveRestaurant(first.id, first.display_name || first.name || 'Votre restaurant');
      }

      bindRestaurantSelector();
      bindSuggestionChips();
      bindClearChat();
      renderMenuDocument();

      if (!state.restaurantId) {
        showStatus('Impossible de retrouver ce restaurant pour le moment. Merci de réessayer plus tard.', true);
        disableChatForm();
        return;
      }

    try {
      await loadRestaurantDetails();
    } catch (error) {
      console.warn('Unable to load restaurant details', error);
    }
    const restaurantConfirmed = Boolean(state.menuDocument);

    bindChatForm();
    toggleEmptyState(true);
    showStatus(`Vous échangez avec l'assistant de ${state.restaurantName}.`);
    focusInput();
    } finally {
      setLoadingOverlayVisible(false);
    }
  }

  function createSessionId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    const random = Math.random().toString(16).slice(2, 10);
    return `${Date.now().toString(36)}-${random}`;
  }

  function startChatSession() {
    state.sessionId = createSessionId();
  }

  function ensureChatSession() {
    if (!state.sessionId) {
      startChatSession();
    }
    return state.sessionId;
  }

  function resetChatSession() {
    state.sessionId = null;
  }

  function bindAuthListener() {
    state.supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        window.location.href = '/login';
        return;
      }
      state.session = session;
      updateUserEmail(session.user?.email);
    });
  }

  async function ensureAuthenticated() {
    const { data, error } = await state.supabase.auth.getSession();
    if (error || !data?.session) {
      window.location.href = '/login';
      throw error || new Error('AUTH_REQUIRED');
    }
    state.session = data.session;
    state.userId = data.session.user?.id || null;
    updateUserEmail(data.session.user?.email);
  }

  async function loadTenantContext() {
    const userId = state.session?.user?.id;
    if (!userId) {
      return;
    }
    const { data, error } = await state.supabase
      .from('user_tenants')
      .select('tenant_id')
      .eq('user_id', userId)
      .limit(1);

    if (error) {
      console.error('Unable to fetch tenant context', error);
      showStatus("Impossible d'identifier votre espace restaurateur.", true);
      return;
    }

    const tenantId = data?.[0]?.tenant_id;
    if (!tenantId) {
      showStatus('Aucun tenant associé à ce compte. Contactez un administrateur.', true);
      return;
    }
    state.tenantId = tenantId;
  }

  async function loadRestaurantDirectory() {
    let query = state.supabase
      .from('restaurants')
      .select('id,display_name,name,tenant_id,menu_document');
    if (state.tenantId) {
      query = query.eq('tenant_id', state.tenantId);
    }
    query = query.order('display_name', { ascending: true });
    const { data, error } = await query;

    if (error) {
      console.error('Unable to fetch restaurants', error);
      showStatus("Impossible de récupérer vos restaurants.", true);
      return;
    }
    state.restaurants = data || [];
    if (state.restaurantId && !getRestaurantFromCache(state.restaurantId)) {
      showStatus(
        'Le restaurant indiqué n’est plus disponible. Veuillez rescanner le QR code ou appeler un membre de l’équipe.',
        true
      );
      setActiveRestaurant(null, '', { updateUrl: true });
    }
    populateRestaurantSelector();
  }

  function populateRestaurantSelector() {
    const select = document.getElementById('restaurant-selector');
    if (!select) {
      return;
    }
    select.innerHTML = '';

    if (!state.restaurants.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Aucun restaurant';
      select.appendChild(option);
      select.disabled = true;
      return;
    }

    state.restaurants.forEach((restaurant) => {
      const option = document.createElement('option');
      option.value = restaurant.id;
      option.textContent = restaurant.display_name || restaurant.name || 'Sans nom';
      select.appendChild(option);
    });

    select.disabled = false;
    if (state.restaurantId) {
      select.value = state.restaurantId;
    }
  }

  function bindRestaurantSelector() {
    const select = document.getElementById('restaurant-selector');
    if (!select) {
      return;
    }
    select.addEventListener('change', async (event) => {
      const newId = event.target.value;
      if (!newId) {
        setActiveRestaurant(null, '', { updateUrl: true });
        state.history = [];
        clearThread();
        showStatus('Impossible de charger ce restaurant pour le moment.', true);
        disableChatForm();
        return;
      }

      setActiveRestaurant(newId, getRestaurantNameFromCache(newId));
      state.history = [];
      clearThread();
      showStatus('Chargement du chatbot…');
      enableChatForm();
      try {
        await loadRestaurantDetails();
        showStatus(`Vous échangez avec l'assistant de ${state.restaurantName}.`);
        focusInput();
      } catch (error) {
        console.error('Unable to load restaurant after selection', error);
        showStatus("Impossible de charger cet établissement.", true);
      }
    });
  }

  function bindLogout() {
    const logoutBtn = document.getElementById('logout-btn');
    if (!logoutBtn) {
      return;
    }
    logoutBtn.addEventListener('click', async () => {
      await state.supabase.auth.signOut();
      window.location.href = '/login';
    });
  }

  function bindChatForm() {
    const form = document.getElementById('chat-form');
    if (!form) {
      return;
    }
    form.addEventListener('submit', handleSendMessage);
    const input = document.getElementById('chat-input');
    if (input) {
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          if (typeof form.requestSubmit === 'function') {
            form.requestSubmit();
          } else {
            form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
          }
        }
      });
    }
  }

  function bindSuggestionChips() {
    document.querySelectorAll('[data-suggestion]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const suggestion = chip.dataset.suggestion || '';
        fillInputWithSuggestion(suggestion);
      });
    });
  }

  function bindClearChat() {
    const button = document.getElementById('clear-chat');
    if (!button) {
      return;
    }
    button.addEventListener('click', () => {
      state.history = [];
      clearThread();
      if (state.restaurantId) {
        startChatSession();
      } else {
        resetChatSession();
      }
      showStatus('Conversation réinitialisée. Posez une nouvelle question.');
      focusInput();
    });
  }

  function fillInputWithSuggestion(text) {
    const input = document.getElementById('chat-input');
    if (!input) {
      return;
    }
    input.value = text;
    focusInput();
  }

  function getRestaurantContextFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const id = (params.get('restaurant_id') || '').trim();
    const name = (params.get('restaurant_name') || '').trim();
    return {
      id,
      name: name || 'ce restaurant',
    };
  }

  function setActiveRestaurant(id, fallbackName, options = { updateUrl: true }) {
    const previousId = state.restaurantId;
    state.restaurantId = id || null;
    if (!state.restaurantId) {
      state.restaurantName = UNAVAILABLE_RESTAURANT_NAME;
      state.history = [];
      resetChatSession();
      updateRestaurantName(state.restaurantName);
      state.menuDocument = null;
      renderMenuDocument();
      const select = document.getElementById('restaurant-selector');
      if (select) {
        select.value = '';
      }
      clearThread();
      disableChatForm();
      return;
    }

    let cachedRecord = getRestaurantFromCache(state.restaurantId);
    if (!cachedRecord) {
      const stored = readChatLaunchCache(state.restaurantId);
      if (stored) {
        cacheRestaurantRecord(stored);
        cachedRecord = stored;
      }
    }
    const cachedName = cachedRecord ? cachedRecord.display_name || cachedRecord.name : null;
    const resolvedName = cachedName || fallbackName || 'Votre restaurant';
    state.restaurantName = resolvedName;
    updateRestaurantName(resolvedName);
    state.menuDocument = normalizeMenuDocument(cachedRecord?.menu_document);
    renderMenuDocument();

    if (previousId !== state.restaurantId) {
      startChatSession();
    }

    const select = document.getElementById('restaurant-selector');
    if (select) {
      select.value = state.restaurantId;
    }

    if (options.updateUrl !== false) {
      const params = new URLSearchParams(window.location.search);
      params.set('restaurant_id', state.restaurantId);
      params.set('restaurant_name', state.restaurantName);
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState({}, '', newUrl);
    }
  }

  function getRestaurantNameFromCache(id) {
    const record = getRestaurantFromCache(id);
    if (!record) {
      return null;
    }
    return record.display_name || record.name || null;
  }

  function getRestaurantFromCache(id) {
    if (!id) {
      return null;
    }
    return state.restaurants.find((restaurant) => restaurant.id === id) || null;
  }

  async function loadRestaurantDetails() {
    if (!state.restaurantId) {
      state.menuDocument = null;
      renderMenuDocument();
      return;
    }

    updateMenuBadge('Synchronisation…');

    const cached = getRestaurantFromCache(state.restaurantId);
    if (cached) {
      applyRestaurantRecord(cached);
    }

    try {
      const record = await fetchPublicRestaurantDetails(state.restaurantId);
      const normalizedRecord = {
        id: record?.id || state.restaurantId,
        display_name: record?.display_name || record?.name || cached?.display_name || cached?.name,
        name: record?.name || cached?.name,
        menu_document: record?.menu_document,
      };
      cacheRestaurantRecord(normalizedRecord);
      rememberChatLaunchCache(normalizedRecord);
      applyRestaurantRecord(normalizedRecord);
      updateMenuBadge('Carte synchronisée');
      return;
    } catch (error) {
      console.warn('Unable to fetch public restaurant details', error);
    }

    if (!state.supabase) {
      updateMenuBadge('Carte indisponible');
      return;
    }

    const { data, error } = await state.supabase
      .from('restaurants')
      .select('id,display_name,name,menu_document')
      .eq('id', state.restaurantId)
      .single();

    if (error) {
      updateMenuBadge('Carte indisponible');
      return;
    }
    if (!data) {
      updateMenuBadge('Carte indisponible');
      return;
    }

    cacheRestaurantRecord(data);
    rememberChatLaunchCache(data);
    applyRestaurantRecord(data);
  }

  function cacheRestaurantRecord(record) {
    if (!record || !record.id) {
      return;
    }
    const index = state.restaurants.findIndex((entry) => entry.id === record.id);
    if (index >= 0) {
      state.restaurants[index] = { ...state.restaurants[index], ...record };
    } else {
      state.restaurants.push(record);
    }
  }

  function readChatLaunchCache(restaurantId) {
    if (typeof window === 'undefined' || !window.localStorage || !restaurantId) {
      return null;
    }
    try {
      const raw = window.localStorage.getItem(`restaubot-chat-${restaurantId}`);
      if (!raw) {
        return null;
      }
      const payload = JSON.parse(raw);
      return {
        id: payload.id || restaurantId,
        display_name: payload.display_name || payload.name || '',
        name: payload.name || payload.display_name || '',
        menu_document: payload.menu_document || null,
      };
    } catch (error) {
      console.warn('Unable to read cached chat context', error);
      return null;
    }
  }

  function rememberChatLaunchCache(record) {
    if (typeof window === 'undefined' || !window.localStorage || !record || !record.id) {
      return;
    }
    try {
      const payload = {
        id: record.id,
        display_name: record.display_name || record.name || '',
        name: record.name || record.display_name || '',
        menu_document: record.menu_document || null,
        cached_at: Date.now(),
      };
      window.localStorage.setItem(`restaubot-chat-${record.id}`, JSON.stringify(payload));
    } catch (error) {
      console.warn('Unable to persist chat cache', error);
    }
  }

  function applyRestaurantRecord(record) {
    if (!record) {
      return;
    }
    const resolvedName = record.display_name || record.name || state.restaurantName;
    state.restaurantName = resolvedName;
    state.menuDocument = normalizeMenuDocument(record.menu_document);
    updateRestaurantName(resolvedName);
    renderMenuDocument();
    if (state.menuDocument) {
      updateMenuBadge('Carte synchronisée');
    } else {
      updateMenuBadge('Carte indisponible');
    }
  }

  async function handleSendMessage(event) {
    event.preventDefault();
    if (state.isSending || !state.restaurantId) {
      if (!state.restaurantId) {
        showStatus('Impossible de démarrer la discussion pour ce restaurant pour le moment.', true);
      }
      return;
    }

    const input = document.getElementById('chat-input');
    if (!input) {
      return;
    }
    const message = input.value.trim();
    if (!message) {
      return;
    }

    appendMessage(message, 'user');
    input.value = '';
    state.hasInteracted = true;
    setSendingState(true);

    const historySnapshot = state.history.slice(-MAX_HISTORY);
    const pendingUserEntry = { role: 'user', content: message };
    const sessionId = ensureChatSession();

    try {
      const reply = await requestChatCompletion(message, historySnapshot, sessionId);
      const assistantElements = appendMessage('', 'assistant', { skipFormat: true, returnElements: true });
      await streamAssistantReply(assistantElements?.body || null, reply);
      pushToHistory(pendingUserEntry);
      pushToHistory({ role: 'assistant', content: reply });
    } catch (error) {
      console.error('Chat request failed', error);
      appendMessage('Désolé, une erreur est survenue. Réessayez plus tard.', 'assistant');
    } finally {
      setSendingState(false);
    }
  }

  async function requestChatCompletion(message, historySnapshot, sessionId) {
    const token = state.session?.access_token;
    if (!token) {
      window.location.href = '/login';
      throw new Error('AUTH_REQUIRED');
    }

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        restaurant_id: state.restaurantId,
        message,
        history: historySnapshot,
        session_id: sessionId,
      }),
    });

    const payload = await safeJson(response);
    if (!response.ok) {
      const detail = payload?.detail || `Erreur HTTP ${response.status}`;
      throw new Error(detail);
    }

    const reply = (payload?.reply || 'Réponse indisponible.').toString();
    if (!reply.trim()) {
      return 'Réponse indisponible.';
    }
    return reply.trim();
  }

  async function fetchPublicRestaurantDetails(restaurantId) {
    if (!restaurantId) {
      throw new Error('RESTAURANT_ID_REQUIRED');
    }

    const response = await fetch(`/api/public/restaurants/${encodeURIComponent(restaurantId)}`);
    const payload = await safeJson(response);
    if (!response.ok) {
      const detail = payload?.detail || `Erreur HTTP ${response.status}`;
      throw new Error(detail);
    }
    return payload;
  }

  function pushToHistory(entry) {
    if (!entry?.content) {
      return;
    }
    state.history.push(entry);
    if (state.history.length > MAX_HISTORY) {
      state.history.splice(0, state.history.length - MAX_HISTORY);
    }
  }

  function appendMessage(text, role, options = {}) {
    const container = document.getElementById('chat-messages');
    if (!container) {
      return;
    }
    const item = document.createElement('div');
    item.className = `chat-message ${role}`;
    const label = role === 'assistant' ? 'RestauBot' : 'Vous';
    const avatar = document.createElement('div');
    avatar.className = 'chat-message-avatar';
    avatar.textContent = role === 'assistant' ? 'RB' : 'Vous';

    const content = document.createElement('div');
    content.className = 'chat-message-content';

    const author = document.createElement('div');
    author.className = 'chat-message-author';
    author.textContent = label;

    const body = document.createElement('div');
    body.className = 'chat-message-body';
    const rawText = (text || '').toString();
    if (options.skipFormat) {
      body.textContent = rawText;
    } else if (rawText) {
      body.innerHTML = formatMessage(rawText);
    }

    content.append(author, body);
    item.append(avatar, content);
    container.appendChild(item);
    container.scrollTop = container.scrollHeight;
    toggleEmptyState(false);
    if (options.returnElements) {
      return { item, body };
    }
    return null;
  }

  function streamAssistantReply(target, text) {
    return streamRichContent(target, text, formatMessage);
  }

  // Animate replies to mimic a live stream even without server-sent chunks.
  function streamRichContent(target, text, formatter) {
    return new Promise((resolve) => {
      if (!target) {
        resolve();
        return;
      }
      const fullText = (text || '').toString();
      if (!fullText) {
        target.classList.remove('is-streaming');
        target.innerHTML = typeof formatter === 'function' ? formatter('') : '';
        resolve();
        return;
      }

      const characters = Array.from(fullText);
      const chunkSize = 4;
      const baseDelay = 18;
      let index = 0;
      let buffer = '';

      target.classList.add('is-streaming');
      target.textContent = '';

      const write = () => {
        const chunk = characters.slice(index, index + chunkSize).join('');
        buffer += chunk;
        target.textContent = buffer;
        index += chunkSize;
        if (index < characters.length) {
          const jitter = Math.random() * 40;
          window.setTimeout(write, baseDelay + jitter);
        } else {
          target.classList.remove('is-streaming');
          if (typeof formatter === 'function') {
            target.innerHTML = formatter(buffer);
          } else {
            target.textContent = buffer;
          }
          resolve();
        }
      };

      write();
    });
  }

  function clearThread() {
    const container = document.getElementById('chat-messages');
    if (container) {
      container.innerHTML = '';
    }
    toggleEmptyState(true);
    state.hasInteracted = false;
  }

  function renderMenuDocument() {
    const container = document.getElementById('menu-sections');
    const emptyState = document.getElementById('menu-empty-state');
    if (!container || !emptyState) {
      return;
    }

    const title = emptyState.querySelector('h3');
    const description = emptyState.querySelector('p');
    
    // Masquer par défaut
    container.hidden = true;
    emptyState.hidden = true;

    // Vérifier si le chargement est en cours
    if (state.menuDocument === undefined) {
      updateMenuBadge('Chargement...');
      return;
    }

    const menuDocument = normalizeMenuDocument(state.menuDocument);
    const categories = buildMenuSections(menuDocument);
    container.innerHTML = '';

    if (!categories.length) {
      container.hidden = true;
      emptyState.hidden = false;
      
      if (!state.restaurantId) {
        if (title) title.textContent = 'Restaurant indisponible';
        if (description) description.textContent = 'Impossible de retrouver ce restaurant pour afficher la carte.';
        updateMenuBadge('En attente');
      } else {
        if (title) title.textContent = 'Carte non disponible';
        if (description) description.textContent = 'La carte n\'est pas encore disponible pour ce restaurant.';
        updateMenuBadge('Carte non publiée');
      }
      return;
    }

    categories.forEach((category) => {
      const element = createMenuCategoryElement(category);
      if (element) {
        container.appendChild(element);
      }
    });
    container.hidden = false;
    emptyState.hidden = true;
    const sectionsLabel = categories.length > 1 ? 'sections' : 'section';
    updateMenuBadge(`${categories.length} ${sectionsLabel} actives`);
  }

  function buildMenuSections(menuDocument) {
    if (!menuDocument || typeof menuDocument !== 'object') {
      return [];
    }
    const categories = Array.isArray(menuDocument.categories) ? menuDocument.categories : [];
    return categories
      .map((category) => normalizeMenuCategory(category))
      .filter(Boolean);
  }

  function normalizeMenuCategory(category) {
    if (!category || typeof category !== 'object') {
      return null;
    }
    const name = typeof category.name === 'string' ? category.name.trim() : '';
    const description = typeof category.description === 'string' ? category.description.trim() : '';
    const items = Array.isArray(category.items)
      ? category.items.map((item) => normalizeMenuItem(item)).filter(Boolean)
      : [];
    if (!name && !description && !items.length) {
      return null;
    }
    return {
      name,
      description,
      items,
    };
  }

  function normalizeMenuItem(item) {
    if (!item || typeof item !== 'object') {
      return null;
    }
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const description = typeof item.description === 'string' ? item.description.trim() : '';
    const tags = Array.isArray(item.tags)
      ? item.tags.map((tag) => (typeof tag === 'string' ? tag.trim() : '')).filter(Boolean)
      : [];
    const contains = Array.isArray(item.contains)
      ? item.contains.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean)
      : [];
    const priceLabel = typeof item.price_label === 'string' ? item.price_label.trim() : '';
    const priceTextCandidate = typeof item.price_text === 'string' ? item.price_text.trim() : '';
    const priceAsString = typeof item.price === 'string' ? item.price.trim() : '';
    const priceNumber = typeof item.price === 'number' && Number.isFinite(item.price) ? item.price : null;
    const priceText = priceTextCandidate || (priceNumber === null ? priceAsString : '');

    if (!name && !description && !priceLabel && !priceText && !tags.length && !contains.length) {
      return null;
    }

    return {
      name,
      description,
      tags,
      contains,
      price_label: priceLabel,
      price: priceNumber,
      price_text: priceText,
    };
  }

  function createMenuCategoryElement(category) {
    const section = document.createElement('section');
    section.className = 'menu-category';

    const header = document.createElement('div');
    header.className = 'menu-category-header';

    const heading = document.createElement('div');
    const label = document.createElement('p');
    label.className = 'status-label';
    label.textContent = 'Section';
    const title = document.createElement('h3');
    title.textContent = category.name || 'Suggestion du chef';
    heading.append(label, title);

    const count = document.createElement('span');
    count.className = 'menu-category-count';
    const items = Array.isArray(category.items) ? category.items : [];
    if (items.length) {
      count.textContent = `${items.length} ${items.length > 1 ? 'propositions' : 'proposition'}`;
    } else {
      count.textContent = 'Aucun plat encore';
    }

    header.append(heading, count);
    section.appendChild(header);

    const categoryDescription = typeof category.description === 'string' ? category.description : '';
    if (categoryDescription) {
      const description = document.createElement('p');
      description.className = 'menu-category-description';
      description.textContent = categoryDescription;
      section.appendChild(description);
    }

    const list = document.createElement('div');
    list.className = 'menu-items';
    items.forEach((item) => {
      const element = createMenuItemElement(item);
      if (element) {
        list.appendChild(element);
      }
    });

    if (list.childElementCount > 0) {
      section.appendChild(list);
    }

    return section;
  }

  function createMenuItemElement(item) {
    if (!item) {
      return null;
    }
    const itemName = typeof item.name === 'string' ? item.name : '';
    const itemDescription = typeof item.description === 'string' ? item.description : '';
    const hasContent = itemName || itemDescription;
    if (!hasContent) {
      return null;
    }

    const element = document.createElement('article');
    element.className = 'menu-item';

    const text = document.createElement('div');
    text.className = 'menu-item-text';

    const title = document.createElement('h4');
    title.textContent = itemName || 'Suggestion';
    text.appendChild(title);

    if (itemDescription) {
      const description = document.createElement('p');
      description.textContent = itemDescription;
      text.appendChild(description);
    }

    const tags = Array.isArray(item.tags) ? item.tags : [];
    if (tags.length) {
      const chips = document.createElement('div');
      chips.className = 'menu-item-tags';
      tags.forEach((tag) => {
        const chip = document.createElement('span');
        chip.className = 'menu-item-tag';
        chip.textContent = tag;
        chips.appendChild(chip);
      });
      text.appendChild(chips);
    }

    const contains = Array.isArray(item.contains) ? item.contains : [];
    if (contains.length) {
      const allergens = document.createElement('p');
      allergens.className = 'menu-item-allergens';
      allergens.textContent = `Allergènes: ${contains.join(', ')}`;
      text.appendChild(allergens);
    }

    element.appendChild(text);

    const priceLabel = resolveMenuPrice(item);
    if (priceLabel) {
      const price = document.createElement('div');
      price.className = 'menu-item-price';
      price.textContent = priceLabel;
      element.appendChild(price);
    }

    return element;
  }

  function resolveMenuPrice(item) {
    if (!item) {
      return '';
    }
    const label = typeof item.price_label === 'string' ? item.price_label.trim() : '';
    if (label) {
      return label;
    }
    if (typeof item.price === 'number' && Number.isFinite(item.price)) {
      return formatMenuPrice(item.price);
    }
    if (typeof item.price_text === 'string' && item.price_text.trim()) {
      return item.price_text.trim();
    }
    if (typeof item.price === 'string' && item.price.trim()) {
      return item.price.trim();
    }
    return '';
  }

  function formatMenuPrice(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return '';
    }
    try {
      return new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
      }).format(value);
    } catch (_error) {
      return `${value} €`;
    }
  }

  function normalizeMenuDocument(value) {
    if (!value) {
      return null;
    }
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch (_error) {
        return null;
      }
    }
    if (typeof value === 'object') {
      return value;
    }
    return null;
  }

  function updateMenuBadge(text) {
    const badge = document.getElementById('menu-updated-at');
    if (badge) {
      badge.textContent = text || '';
    }
  }

  function setLoadingOverlayVisible(isVisible) {
    const overlay = document.getElementById('chat-loading-overlay');
    if (!overlay) {
      return;
    }
    if (isVisible) {
      overlay.hidden = false;
      overlay.setAttribute('aria-hidden', 'false');
      if (overlayTimeoutId) {
        window.clearTimeout(overlayTimeoutId);
      }
      overlayTimeoutId = window.setTimeout(() => {
        overlay.hidden = true;
        overlay.setAttribute('aria-hidden', 'true');
      }, 20000);
    } else {
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
      if (overlayTimeoutId) {
        window.clearTimeout(overlayTimeoutId);
        overlayTimeoutId = null;
      }
    }
  }

  function formatMessage(text) {
    const safe = escapeHtml(text);
    const blocks = safe.split(/\n{2,}/g).map((block) => {
      const withBreaks = block.replace(/\n/g, '<br />');
      return `<p>${withBreaks}</p>`;
    });
    return blocks.join('') || `<p>${safe}</p>`;
  }

  function escapeHtml(value) {
    return (value || '')
      .toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setSendingState(isSending) {
    state.isSending = isSending;
    const button = document.getElementById('chat-send');
    const input = document.getElementById('chat-input');
    if (button) {
      button.disabled = isSending;
    }
    if (input) {
      input.disabled = isSending;
      if (!isSending) {
        input.focus();
      }
    }
    showTypingIndicator(isSending);
  }

  function disableChatForm() {
    const button = document.getElementById('chat-send');
    const input = document.getElementById('chat-input');
    if (button) {
      button.disabled = true;
    }
    if (input) {
      input.disabled = true;
    }
    showTypingIndicator(false);
  }

  function enableChatForm() {
    const button = document.getElementById('chat-send');
    const input = document.getElementById('chat-input');
    if (button) {
      button.disabled = false;
    }
    if (input) {
      input.disabled = false;
    }
    showTypingIndicator(false);
  }

  function showStatus(message, isError = false) {
    const target = document.getElementById('chat-status');
    if (!target) {
      return;
    }
    target.textContent = message;
    target.classList.toggle('error', Boolean(isError));
  }

  function showTypingIndicator(isVisible) {
    const indicator = document.getElementById('typing-indicator');
    if (!indicator) {
      return;
    }
    const shouldShow = Boolean(isVisible && state.hasInteracted);
    indicator.hidden = !shouldShow;
    indicator.setAttribute('aria-hidden', (!shouldShow).toString());
    indicator.style.display = shouldShow ? 'inline-flex' : 'none';
    indicator.classList.toggle('is-visible', shouldShow);

    const textEl = indicator.querySelector("[data-role='typing-text']");
    if (textEl) {
      if (!textEl.dataset.defaultText) {
        textEl.dataset.defaultText = textEl.textContent || 'RestauBot rédige une réponse';
      }
      if (shouldShow) {
        const hideName =
          !state.restaurantName ||
          state.restaurantName === DEFAULT_RESTAURANT_NAME ||
          state.restaurantName === UNAVAILABLE_RESTAURANT_NAME;
        const assistantName = hideName ? 'RestauBot' : state.restaurantName;
        textEl.textContent = `${assistantName} rédige une réponse`;
      } else {
        textEl.textContent = textEl.dataset.defaultText;
      }
    }
  }

  function toggleEmptyState(shouldShow) {
    const empty = document.getElementById('chat-empty-state');
    const thread = document.getElementById('chat-messages');
    if (empty) {
      empty.hidden = !shouldShow;
    }
    if (thread) {
      thread.classList.toggle('is-empty', shouldShow);
    }
  }

  function focusInput() {
    const input = document.getElementById('chat-input');
    if (input) {
      input.focus();
    }
  }

  async function safeJson(response) {
    try {
      return await response.json();
    } catch (error) {
      console.warn('Unable to parse JSON response', error);
      return null;
    }
  }

  function updateUserEmail(email) {
    const target = document.getElementById('user-email');
    if (target) {
      target.textContent = email || '';
    }
  }

  function updateRestaurantName(name) {
    const nameEl = document.getElementById('chat-restaurant-name');
    const resolvedName = name || DEFAULT_RESTAURANT_NAME;
    if (nameEl) {
      nameEl.textContent = resolvedName;
    }
    if (typeof document !== 'undefined') {
      const baseTitle = 'RestauBot | Chatbot du restaurant';
      if (
        resolvedName &&
        resolvedName !== DEFAULT_RESTAURANT_NAME &&
        resolvedName !== UNAVAILABLE_RESTAURANT_NAME
      ) {
        document.title = `RestauBot | ${resolvedName}`;
      } else {
        document.title = baseTitle;
      }
    }
  }
})();
