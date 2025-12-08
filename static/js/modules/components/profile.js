import { state } from "../core/state.js";
import { getAccessToken } from "../core/auth.js";
import { updateUIWithUserData, showToast } from "./ui.js";

// --- Profile Logic ---

export function bindProfileForm() {
    const form = document.getElementById("profile-form");
    if (!form) {
        return;
    }
    form.addEventListener("submit", handleProfileSubmit);
    form.addEventListener("reset", () => {
        window.requestAnimationFrame(() => {
            if (state.snapshot?.profile) {
                updateProfileFormFields(state.snapshot.profile);
            } else if (state.snapshot?.user) {
                updateProfileFormFields(state.snapshot.user);
            }
            clearProfileErrors();
            setProfileMessage("");
        });
    });
}

async function handleProfileSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitBtn = form.querySelector("button[type='submit']");
    setProfileMessage("");
    clearProfileErrors();

    const payload = {
        full_name: (document.getElementById("profile-full-name")?.value || "").trim(),
        company_name: (document.getElementById("profile-company")?.value || "").trim(),
        country: (document.getElementById("profile-country")?.value || "").trim(),
        phone_number: (document.getElementById("profile-phone")?.value || "").trim(),
        timezone: document.getElementById("profile-timezone")?.value || "",
    };

    const errors = {};
    if (!payload.full_name) {
        errors.full_name = "Indiquez votre nom complet.";
    }
    if (!payload.phone_number) {
        errors.phone_number = "Le numéro de téléphone est requis.";
    } else if (!isValidPhoneNumber(payload.phone_number)) {
        errors.phone_number = "Entrez un numéro valide (10 à 15 chiffres).";
    }
    if (!payload.timezone) {
        errors.timezone = "Choisissez un fuseau horaire.";
    }

    const cleanPayload = Object.fromEntries(
        Object.entries(payload).filter(([, value]) => value && typeof value === "string")
    );

    if (Object.keys(errors).length) {
        Object.entries(errors).forEach(([key, message]) => setProfileFieldError(key, message));
        setProfileMessage("Merci de corriger les champs en surbrillance.", "error");
        return;
    }

    if (!Object.keys(cleanPayload).length) {
        setProfileMessage("Aucune information à mettre à jour.");
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
    }

    try {
        const token = await getAccessToken();
        const response = await fetch("/api/dashboard/profile", {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(cleanPayload),
        });

        const payloadResponse = await response.json().catch(() => ({}));
        if (!response.ok) {
            const detail = payloadResponse && payloadResponse.detail ? payloadResponse.detail : null;
            throw new Error(detail || "Impossible de mettre à jour le profil.");
        }

        if (state.snapshot) {
            state.snapshot.profile = payloadResponse;
            if (state.snapshot.user) {
                const userDetails = state.snapshot.user;
                userDetails.fullName = payloadResponse.full_name || userDetails.fullName;
                userDetails.first_name = payloadResponse.first_name || userDetails.first_name;
                userDetails.last_name = payloadResponse.last_name || userDetails.last_name;
                userDetails.phone_number = payloadResponse.phone_number || userDetails.phone_number;
                userDetails.timezone = payloadResponse.timezone || userDetails.timezone;
            }
        }
        updateProfileFormFields(payloadResponse);
        if (state.snapshot?.user) {
            updateUIWithUserData(state.snapshot.user);
        }
        setProfileMessage("Profil mis à jour avec succès.", "success");
        showToast("Profil mis à jour.");
    } catch (error) {
        console.error("Profile update failed", error);
        setProfileMessage(error.message || "Erreur lors de la mise à jour.", "error");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
        }
    }
}

export function updateProfileFormFields(data) {
    if (!data) {
        return;
    }
    const fields = {
        "profile-full-name": data.full_name || data.fullName || "",
        "profile-email": data.email || "",
        "profile-company": data.company_name || "",
        "profile-country": data.country || "",
        "profile-phone": data.phone_number || "",
        "profile-timezone": data.timezone || "",
    };

    Object.entries(fields).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) {
            el.value = value;
            if (id === "profile-email") {
                el.disabled = true;
                el.title = "L'email ne peut pas être modifié.";
            }
        }
    });
}

function setProfileFieldError(fieldKey, message) {
    const map = {
        full_name: "profile-full-name",
        phone_number: "profile-phone",
        timezone: "profile-timezone",
    };
    const id = map[fieldKey];
    if (!id) {
        return;
    }
    const el = document.getElementById(id);
    if (el) {
        el.classList.add("error-border");
        // Could add error message below field if UI supports it
    }
}

function clearProfileErrors() {
    const ids = ["profile-full-name", "profile-phone", "profile-timezone"];
    ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.remove("error-border");
        }
    });
}

function setProfileMessage(text, type = "info") {
    const el = document.getElementById("profile-form-message");
    if (!el) {
        return;
    }
    el.textContent = text;
    el.className = `form-message ${type}`;
}

function isValidPhoneNumber(phone) {
    const re = /^\+?[0-9\s\-]{10,15}$/;
    return re.test(phone);
}

// --- Stock Thresholds Management ---

let currentThresholdRestaurantId = null;

export async function loadStockThresholds() {
    const container = document.getElementById('stock-thresholds-container');
    const restaurantNameEl = document.getElementById('threshold-active-restaurant');

    if (!container) return;

    // Try multiple sources to get the active restaurant
    let restaurantId = state.overview?.restaurantId;
    let restaurantName = state.overview?.restaurantName;

    // Fallback: check if there's a global restaurant picker value
    if (!restaurantId) {
        const globalPicker = document.getElementById('global-restaurant-picker');
        if (globalPicker && globalPicker.value) {
            restaurantId = globalPicker.value;
            const selectedOption = globalPicker.options[globalPicker.selectedIndex];
            restaurantName = selectedOption?.text || 'Restaurant sélectionné';
        }
    }

    // Fallback: use first restaurant from state
    if (!restaurantId && state.restaurants && state.restaurants.length > 0) {
        restaurantId = state.restaurants[0].id;
        restaurantName = state.restaurants[0].display_name || state.restaurants[0].name;
    }

    if (!restaurantId) {
        container.innerHTML = '<p class="text-center muted">Sélectionnez un restaurant via le sélecteur global en haut de la page.</p>';
        if (restaurantNameEl) {
            restaurantNameEl.textContent = 'Aucun';
            restaurantNameEl.style.color = '#94a3b8';
        }
        return;
    }

    // Update restaurant name display
    if (restaurantNameEl) {
        restaurantNameEl.textContent = restaurantName || 'Restaurant sélectionné';
        restaurantNameEl.style.color = '#1e40af';
    }

    // Only reload if restaurant changed
    if (currentThresholdRestaurantId === restaurantId) {
        return;
    }

    currentThresholdRestaurantId = restaurantId;

    // Show loading state
    container.innerHTML = `
        <div class="loading-state">
            <span class="loading-spinner"></span>
            <p>Chargement des catégories...</p>
        </div>
    `;

    try {
        const token = await getAccessToken();
        const response = await fetch(`/api/ingredient-categories?restaurant_id=${restaurantId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Impossible de charger les catégories');
        }

        const categories = await response.json();
        renderThresholdCards(categories);
    } catch (error) {
        console.error('Error loading thresholds:', error);
        container.innerHTML = '<p class="text-center error">Erreur lors du chargement des catégories.</p>';
    }
}

// Listen for restaurant changes
document.addEventListener('restaurantChanged', (event) => {
    if (event.detail && event.detail.restaurantId) {
        // Check if we're on the profile section
        const profileSection = document.getElementById('profile');
        if (profileSection && profileSection.classList.contains('active-section')) {
            loadStockThresholds();
        }
    }
});

// Also listen for activeRestaurantChange event
document.addEventListener('activeRestaurantChange', (event) => {
    if (event.detail && event.detail.id) {
        // Check if we're on the profile section
        const profileSection = document.getElementById('profile');
        if (profileSection && profileSection.classList.contains('active-section')) {
            // Reset current restaurant to force reload
            currentThresholdRestaurantId = null;
            loadStockThresholds();
        }
    }
});


function renderThresholdCards(categories) {
    const container = document.getElementById('stock-thresholds-container');
    const template = document.getElementById('threshold-card-template');

    if (!container || !template) return;

    container.innerHTML = '';

    if (categories.length === 0) {
        container.innerHTML = '<p class="text-center muted">Aucune catégorie trouvée.</p>';
        return;
    }

    categories.forEach(category => {
        const clone = template.content.cloneNode(true);

        // Set category info
        clone.querySelector('.threshold-category-name').textContent = category.name;
        clone.querySelector('.threshold-category-description').textContent = category.description || '';

        // Set threshold values (convert to percentage)
        clone.querySelector('.threshold-percent.critical').textContent = `${Math.round(category.critical_threshold * 100)}%`;
        clone.querySelector('.threshold-percent.low').textContent = `${Math.round(category.low_threshold * 100)}%`;
        clone.querySelector('.threshold-percent.ok').textContent = `${Math.round(category.ok_threshold * 100)}%`;

        // Set input values
        clone.querySelector('.threshold-input-critical').value = Math.round(category.critical_threshold * 100);
        clone.querySelector('.threshold-input-low').value = Math.round(category.low_threshold * 100);
        clone.querySelector('.threshold-input-ok').value = Math.round(category.ok_threshold * 100);

        const card = clone.querySelector('.threshold-card');
        card.dataset.categoryId = category.id;

        // Bind events
        const editBtn = clone.querySelector('.threshold-edit-btn');
        const cancelBtn = clone.querySelector('.threshold-cancel-btn');
        const saveBtn = clone.querySelector('.threshold-save-btn');

        editBtn.addEventListener('click', () => toggleThresholdEdit(card, true));
        cancelBtn.addEventListener('click', () => toggleThresholdEdit(card, false));
        saveBtn.addEventListener('click', () => saveThresholds(card, category.id));

        container.appendChild(clone);
    });
}

function toggleThresholdEdit(card, isEditing) {
    const values = card.querySelector('.threshold-values');
    const form = card.querySelector('.threshold-edit-form');
    const editBtn = card.querySelector('.threshold-edit-btn');

    if (isEditing) {
        values.hidden = true;
        form.hidden = false;
        editBtn.hidden = true;
    } else {
        values.hidden = false;
        form.hidden = true;
        editBtn.hidden = false;

        // Reset feedback
        const feedback = card.querySelector('.threshold-feedback');
        if (feedback) {
            feedback.textContent = '';
            feedback.className = 'threshold-feedback';
        }
    }
}

async function saveThresholds(card, categoryId) {
    const criticalInput = card.querySelector('.threshold-input-critical');
    const lowInput = card.querySelector('.threshold-input-low');
    const okInput = card.querySelector('.threshold-input-ok');
    const feedback = card.querySelector('.threshold-feedback');
    const saveBtn = card.querySelector('.threshold-save-btn');

    // Get values as decimals
    const critical = parseFloat(criticalInput.value) / 100;
    const low = parseFloat(lowInput.value) / 100;
    const ok = parseFloat(okInput.value) / 100;

    // Validation
    if (critical >= low) {
        feedback.textContent = 'Le seuil critique doit être inférieur au seuil faible.';
        feedback.className = 'threshold-feedback error';
        return;
    }

    if (low >= ok) {
        feedback.textContent = 'Le seuil faible doit être inférieur au seuil bon.';
        feedback.className = 'threshold-feedback error';
        return;
    }

    saveBtn.disabled = true;
    feedback.textContent = 'Enregistrement...';
    feedback.className = 'threshold-feedback';

    try {
        const token = await getAccessToken();
        const response = await fetch(`/api/ingredient-categories/${categoryId}/thresholds`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                critical_threshold: critical,
                low_threshold: low,
                ok_threshold: ok
            })
        });

        if (!response.ok) {
            throw new Error('Impossible de mettre à jour les seuils');
        }

        const updated = await response.json();

        // Update display values
        card.querySelector('.threshold-percent.critical').textContent = `${Math.round(updated.critical_threshold * 100)}%`;
        card.querySelector('.threshold-percent.low').textContent = `${Math.round(updated.low_threshold * 100)}%`;
        card.querySelector('.threshold-percent.ok').textContent = `${Math.round(updated.ok_threshold * 100)}%`;

        feedback.textContent = 'Seuils mis à jour avec succès !';
        feedback.className = 'threshold-feedback success';

        setTimeout(() => {
            toggleThresholdEdit(card, false);
        }, 1500);

        showToast('Seuils de stock mis à jour');
    } catch (error) {
        console.error('Error saving thresholds:', error);
        feedback.textContent = error.message || 'Erreur lors de la mise à jour';
        feedback.className = 'threshold-feedback error';
    } finally {
        saveBtn.disabled = false;
    }
}
