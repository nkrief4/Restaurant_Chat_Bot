export const state = {
    supabase: null,
    session: null,
    token: null,
    snapshot: null,
    restaurants: [],
    editingId: null,
    isUploadingMenu: false,
    filters: {
        startDate: null,
        endDate: null,
    },
    statistics: {
        startDate: null,
        endDate: null,
        activeRangePreset: 7,
        selectedRestaurants: [],
        availableRestaurants: [],
        isFetching: false,
        hasInitialized: false,
    },
    isFetchingSnapshot: false,
    overview: {
        restaurantId: null,
        restaurantName: "",
        history: [],
        isSending: false,
        hasManualSelection: false,
    },
    chatbot: {
        restaurantId: null,
        restaurantName: "",
        hasManualSelection: false,
        history: [],
        isSending: false,
        sessionId: null,
        hasInteracted: false,
    },
    chatTesterWindow: null,
    isLaunchingChat: false,
    restaurantForms: {
        activeTab: "edit",
    },
    stockData: [],
    activeStockRestaurantId: null,
    categoryStore: {},
    purchasingRange: {
        startDate: null,
        endDate: null,
    },
};

// Runtime states that were previously top-level variables but are effectively global state
export const selectionLoadingState = {
    pending: 0,
};
