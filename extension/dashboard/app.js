/**
 * OLX Car Finder - Dashboard Sprint 3
 */

const API_BASE_URL = 'https://olx-car-finder.dyonathan.workers.dev';

// State
let searches = [];
let currentSearchId = 'all';
let currentFilters = {
    brand: '',
    model: '',
    price: null,
    year: null,
    trusted: true,
    newOnly: false
};
let currentSort = 'created_at';
let currentSortOrder = 'desc';
let listingsOffset = 0;
const LISTINGS_LIMIT = 30;

// DOM Elements
const searchSelect = document.getElementById('search-select');
const lastCheck = document.getElementById('last-check');
const openOlxBtn = document.getElementById('open-olx-btn');

// Helper to get headers with auth
async function getAuthHeaders() {
    // In dashboard (web page), we might not have direct access to chrome.storage if not in extension context properly
    // But since this is an extension page, we should.
    try {
        const stored = await chrome.storage.sync.get('apiToken');
        const token = stored.apiToken || 'change-me-in-prod-please';
        return {
            'Content-Type': 'application/json',
            'X-Access-Token': token
        };
    } catch (e) {
        console.warn('Auth token retrieval failed, using default', e);
        return {
            'Content-Type': 'application/json',
            'X-Access-Token': 'change-me-in-prod-please'
        };
    }
}
const scanBtn = document.getElementById('scan-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const settingsClose = document.getElementById('settings-close');
const settingsSave = document.getElementById('settings-save');
const settingsSearchSelect = document.getElementById('settings-search-select');
const settingFrequency = document.getElementById('setting-frequency');
const settingMinGroup = document.getElementById('setting-min-group');
const ignoredBrandsContainer = document.getElementById('ignored-brands');
const ignoredModelsContainer = document.getElementById('ignored-models');

// Filter elements
const filterBrand = document.getElementById('filter-brand');
const filterModel = document.getElementById('filter-model');
const filterPrice = document.getElementById('filter-price');
const filterYear = document.getElementById('filter-year');
const filterTrusted = document.getElementById('filter-trusted');
const filterNewOnly = document.getElementById('filter-new-only');
const clearFiltersBtn = document.getElementById('clear-filters');

// Content elements
const opportunitiesList = document.getElementById('opportunities-list');
const brandsTable = document.getElementById('brands-table').querySelector('tbody');
const modelsTableFull = document.getElementById('models-table-full').querySelector('tbody');
const listingsGrid = document.getElementById('listings-grid');
const listingsCount = document.getElementById('listings-count');
const sortBy = document.getElementById('sort-by');
const loadMoreBtn = document.getElementById('load-more-btn');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    setupEventListeners();
    await loadSearches();
    await loadAllData();
});

// Setup event listeners
function setupEventListeners() {
    // Search select
    searchSelect.addEventListener('change', async () => {
        currentSearchId = searchSelect.value || 'all';
        await loadAllData();
    });

    // Open OLX
    openOlxBtn.addEventListener('click', () => {
        const search = searches.find(s => s.id === currentSearchId);
        if (search) {
            window.open(search.human_url, '_blank');
        }
    });

    // Scan
    scanBtn.addEventListener('click', async () => {
        scanBtn.disabled = true;
        scanBtn.textContent = '⏳ Escaneando...';
        try {
            const endpoint = currentSearchId === 'all'
                ? `${API_BASE_URL}/api/scan`
                : `${API_BASE_URL}/api/scan/${currentSearchId}`;
            const headers = await getAuthHeaders();
            await fetch(endpoint, { method: 'POST', headers });
            await loadAllData();
        } catch (e) {
            console.error('Scan failed:', e);
        } finally {
            scanBtn.disabled = false;
            scanBtn.textContent = '🔍 Rechecar';
        }
    });

    // Settings modal
    settingsBtn.addEventListener('click', () => {
        openSettingsModal();
    });
    settingsClose.addEventListener('click', () => settingsModal.classList.remove('active'));
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) settingsModal.classList.remove('active');
    });

    // Settings search select change
    settingsSearchSelect.addEventListener('change', () => {
        loadSettingsForSearch(settingsSearchSelect.value);
    });

    // Settings save
    settingsSave.addEventListener('click', async () => {
        await saveSettings();
    });

    // Filters
    filterBrand.addEventListener('change', async () => {
        currentFilters.brand = filterBrand.value;
        await loadOpportunities();
        await loadListings(true);
    });

    filterModel.addEventListener('change', async () => {
        currentFilters.model = filterModel.value;
        await loadOpportunities();
        await loadListings(true);
    });

    filterPrice.addEventListener('input', debounce(async () => {
        currentFilters.price = filterPrice.value ? parseInt(filterPrice.value) : null;
        await loadListings(true);
    }, 500));

    filterYear.addEventListener('input', debounce(async () => {
        currentFilters.year = filterYear.value ? parseInt(filterYear.value) : null;
        await loadListings(true);
    }, 500));

    filterTrusted.addEventListener('change', async () => {
        currentFilters.trusted = filterTrusted.checked;
        await loadOpportunities();
    });

    filterNewOnly.addEventListener('change', async () => {
        currentFilters.newOnly = filterNewOnly.checked;
        await loadListings(true);
    });

    clearFiltersBtn.addEventListener('click', async () => {
        filterBrand.value = '';
        filterModel.value = '';
        filterPrice.value = '';
        filterYear.value = '';
        filterTrusted.checked = true;
        filterNewOnly.checked = false;
        currentFilters = { brand: '', model: '', price: null, year: null, trusted: true, newOnly: false };
        await loadOpportunities();
        await loadListings(true);
    });

    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`${btn.dataset.tab}-tab`).classList.add('active');
        });
    });

    // Sort
    sortBy.addEventListener('change', async () => {
        currentSort = sortBy.value;
        currentSortOrder = sortBy.value === 'price' ? 'asc' : 'desc';
        await loadListings(true);
    });

    // Load more
    loadMoreBtn.addEventListener('click', async () => {
        listingsOffset += LISTINGS_LIMIT;
        await loadListings(false);
    });

    // Table sorting
    document.querySelectorAll('.ranking-table th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const table = th.closest('table');
            const tbody = table.querySelector('tbody');
            const rows = Array.from(tbody.querySelectorAll('tr'));
            const sortKey = th.dataset.sort;
            const isAsc = th.classList.contains('sorted-asc');

            // Remove sort classes from all
            table.querySelectorAll('th').forEach(h => h.classList.remove('sorted-asc', 'sorted-desc'));
            th.classList.add(isAsc ? 'sorted-desc' : 'sorted-asc');

            rows.sort((a, b) => {
                const aVal = a.querySelector(`[data-${sortKey}]`)?.dataset[sortKey] || a.cells[th.cellIndex].textContent;
                const bVal = b.querySelector(`[data-${sortKey}]`)?.dataset[sortKey] || b.cells[th.cellIndex].textContent;
                const aNum = parseFloat(aVal) || 0;
                const bNum = parseFloat(bVal) || 0;
                return isAsc ? aNum - bNum : bNum - aNum;
            });

            rows.forEach(row => tbody.appendChild(row));
        });
    });

    // Event delegation for actions
    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;

        const action = btn.dataset.action;
        const id = btn.dataset.id;
        const value = btn.dataset.value;

        switch (action) {
            case 'open':
                window.open(btn.dataset.url, '_blank');
                break;
            case 'ignore-brand':
                await toggleIgnored('brand', value);
                break;
            case 'ignore-model':
                await toggleIgnored('model', value);
                break;
            case 'remove-trusted':
                filterTrusted.checked = false;
                filterTrusted.dispatchEvent(new Event('change'));
                break;
            case 'filter-brand':
                filterBrand.value = value;
                currentFilters.brand = value;
                await loadOpportunities();
                await loadListings(true);
                break;
            case 'filter-model':
                filterModel.value = value;
                currentFilters.model = value;
                await loadOpportunities();
                await loadListings(true);
                break;
            case 'toggle-favorite':
                await toggleFavorite(id, btn.dataset.status);
                break;
        }
    });
}

// Load searches
async function loadSearches() {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`${API_BASE_URL}/api/searches`, { headers });
        const result = await response.json();
        if (result.success) {
            searches = result.data;
            searchSelect.innerHTML = '<option value="all">📊 Todas as buscas</option>' +
                searches.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
        }
    } catch (e) {
        console.error('Failed to load searches:', e);
    }
}

// Load all data
async function loadAllData() {
    await Promise.all([
        loadOpportunities(),
        loadBrands(),
        loadModels(),
        loadListings(true)
    ]);
    updateLastCheck();
}

// Load opportunities
async function loadOpportunities() {
    opportunitiesList.innerHTML = '<div class="loading">Carregando oportunidades...</div>';

    try {
        const params = new URLSearchParams();
        if (currentFilters.brand) params.set('brand', currentFilters.brand);
        if (currentFilters.model) params.set('model', currentFilters.model);

        // Trusted filter
        const minGroupSize = filterTrusted.checked ? '5' : '2';
        params.set('min_group_size', minGroupSize);

        params.set('limit', '10');

        const headers = await getAuthHeaders();
        const response = await fetch(`${API_BASE_URL}/api/searches/${currentSearchId}/opportunities?${params}`, { headers });
        const result = await response.json();

        if (result.success && result.data?.length > 0) {
            opportunitiesList.innerHTML = result.data.map(opp => `
                <div class="opportunity-card">
                    <div class="opportunity-header">
                        <span class="opportunity-model">${escapeHtml(opp.model || 'Desconhecido')}</span>
                        <span class="opportunity-badge">↓${opp.pctBelowMedian}%</span>
                    </div>
                    <div class="opportunity-price">${opp.price || 'Preço não informado'}</div>
                    <div class="opportunity-details">
                        ${opp.municipality || ''} ${opp.neighbourhood ? '• ' + opp.neighbourhood : ''}
                    </div>
                    <div class="opportunity-badges">
                        <span class="badge badge-success">↓${opp.pctBelowMedian}% vs mediana</span>
                        ${isRecent(opp.created_at) ? '<span class="badge badge-new">Novo</span>' : ''}
                    </div>
                    <div class="opportunity-actions">
                        <button class="btn btn-primary btn-sm" data-action="open" data-url="${opp.ad_url}">Abrir</button>
                        <button class="btn btn-icon btn-sm ${opp.status === 'favorite' ? 'active' : ''}" data-action="toggle-favorite" data-id="${opp.id}" data-status="${opp.status}" title="Favoritar">
                            ${opp.status === 'favorite' ? '⭐' : '☆'}
                        </button>
                        <button class="btn btn-secondary btn-sm" data-action="ignore-brand" data-value="${opp.brand}">Ignorar marca</button>
                        <button class="btn btn-secondary btn-sm" data-action="ignore-model" data-value="${opp.model}">Ignorar modelo</button>
                    </div>
                </div>
            `).join('');
        } else {
            opportunitiesList.innerHTML = `
                <div class="empty-state">
                    <p>Sem oportunidades destacadas com os filtros atuais.</p>
                    <button class="btn btn-text" data-action="remove-trusted">
                        Remover "grupos confiáveis"
                    </button>
                </div>
            `;
        }
    } catch (e) {
        console.error('Failed to load opportunities:', e);
        opportunitiesList.innerHTML = '<div class="empty-state">Erro ao carregar oportunidades</div>';
    }
}

// Load brands
async function loadBrands() {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`${API_BASE_URL}/api/searches/${currentSearchId}/brands`, { headers });
        const result = await response.json();

        if (result.success && result.data?.brands) {
            const brands = result.data.brands;

            // Populate filter
            filterBrand.innerHTML = '<option value="">Todas</option>' +
                brands.map(b => `<option value="${escapeHtml(b.brand)}">${escapeHtml(b.brand)}</option>`).join('');

            // Populate table
            brandsTable.innerHTML = brands.map(b => `
                <tr>
                    <td>
                        <a href="#" data-action="filter-brand" data-value="${escapeHtml(b.brand)}">${escapeHtml(b.brand)}</a>
                    </td>
                    <td data-count="${b.count}">${b.count}</td>
                    <td>${b.percentage}%</td>
                    <td>
                        <button class="btn btn-danger btn-sm" data-action="ignore-brand" data-value="${escapeHtml(b.brand)}">
                            Ignorar
                        </button>
                    </td>
                </tr>
            `).join('');
        }
    } catch (e) {
        console.error('Failed to load brands:', e);
    }
}

// Load models
async function loadModels() {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`${API_BASE_URL}/api/searches/${currentSearchId}/models`, { headers });
        const result = await response.json();

        if (result.success && result.data?.models) {
            const models = result.data.models;

            // Populate filter
            filterModel.innerHTML = '<option value="">Todos</option>' +
                models.map(m => `<option value="${escapeHtml(m.model)}">${escapeHtml(m.model)}</option>`).join('');

            // Populate custom card list
            const container = document.getElementById('models-tab');
            if (models.length === 0) {
                container.innerHTML = '<div class="empty-state">Nenhum modelo encontrado</div>';
                return;
            }

            const cardListHTML = `
                <div class="model-card-list">
                    ${models.map(m => {
                const priceRange = m.min_price
                    ? `${formatPrice(m.min_price)} - ${formatPrice(m.max_price)}`
                    : 'Sem preço';
                const thumbHTML = m.thumbnail_url
                    ? `<img src="${m.thumbnail_url}" class="model-thumb" alt="${escapeHtml(m.model)}" loading="lazy">`
                    : `<div class="model-thumb-placeholder">🚗</div>`;

                return `
                        <div class="model-card-item">
                            <div class="model-thumb-container">
                                ${thumbHTML}
                            </div>
                            <div class="model-info-content">
                                <div class="model-card-title" title="${escapeHtml(m.model)}">
                                    <a href="#" data-action="filter-model" data-value="${escapeHtml(m.model)}" style="color:inherit;text-decoration:none;">
                                        ${escapeHtml(m.model)}
                                    </a>
                                </div>
                                <div class="model-card-stats">
                                    <span class="model-stat-pill" title="Quantidade">
                                        📄 ${m.count}
                                    </span>
                                    <span class="model-stat-pill" title="Faixa de Preço">
                                        💰 ${priceRange}
                                    </span>
                                </div>
                            </div>
                            <div class="model-card-actions">
                                <button class="btn btn-sm btn-secondary" data-action="filter-model" data-value="${escapeHtml(m.model)}" title="Ver anúncios">
                                    Ver Lista
                                </button>
                                <button class="btn btn-icon btn-sm text-danger" data-action="ignore-model" data-value="${escapeHtml(m.model)}" title="Ignorar modelo">
                                    🚫
                                </button>
                            </div>
                        </div>
                        `;
            }).join('')}
                </div>
            `;

            container.innerHTML = cardListHTML;
        }
    } catch (e) {
        console.error('Failed to load models:', e);
    }
}

// Load listings
async function loadListings(reset = false) {
    if (reset) {
        listingsOffset = 0;
        listingsGrid.innerHTML = '<div class="loading">Carregando anúncios...</div>';
    }

    try {
        const params = new URLSearchParams();
        if (currentFilters.brand) params.set('brand', currentFilters.brand);
        if (currentFilters.model) params.set('model', currentFilters.model);
        if (currentFilters.newOnly) params.set('newOnly', 'true');
        params.set('sort', currentSort);
        params.set('order', currentSortOrder);
        params.set('limit', LISTINGS_LIMIT);
        params.set('offset', listingsOffset);

        const headers = await getAuthHeaders();
        const response = await fetch(`${API_BASE_URL}/api/searches/${currentSearchId}/listings?${params}`, { headers });
        const result = await response.json();

        if (result.success && result.data) {
            const { listings, total } = result.data;

            listingsCount.textContent = `Mostrando ${Math.min(listingsOffset + listings.length, total)} de ${total}`;

            const html = listings.map(l => {
                const thumbHTML = l.thumbnail_url
                    ? `<img src="${l.thumbnail_url}" class="listing-thumb" alt="${escapeHtml(l.model)}" loading="lazy">`
                    : `<div class="listing-thumb-placeholder">🚗</div>`;

                return `
                <div class="listing-card">
                    <div class="listing-thumb-container">
                        ${thumbHTML}
                    </div>
                    <div class="listing-info">
                        <div class="listing-title">${escapeHtml(l.subject || l.model || 'Sem título')}</div>
                        <div class="listing-meta">
                            <span class="listing-price">${l.price || '-'}</span>
                            <span>${l.municipality || ''}</span>
                            <span>${formatDate(l.created_at)}</span>
                        </div>
                    </div>
                    <div class="listing-actions">
                        <button class="btn btn-primary btn-sm" data-action="open" data-url="${l.ad_url}">Abrir</button>
                        <button class="btn btn-icon btn-sm ${l.status === 'favorite' ? 'active' : ''}" data-action="toggle-favorite" data-id="${l.id}" data-status="${l.status}" title="Favoritar">
                            ${l.status === 'favorite' ? '⭐' : '☆'}
                        </button>
                    </div>
                </div>
            `}).join('');

            if (reset) {
                listingsGrid.innerHTML = html || '<div class="empty-state">Nenhum anúncio encontrado</div>';
            } else {
                listingsGrid.insertAdjacentHTML('beforeend', html);
            }

            loadMoreBtn.style.display = listingsOffset + listings.length < total ? 'inline-block' : 'none';
        }
    } catch (e) {
        console.error('Failed to load listings:', e);
        if (reset) {
            listingsGrid.innerHTML = '<div class="empty-state">Erro ao carregar anúncios</div>';
        }
    }
}

// Toggle ignored brand/model
async function toggleIgnored(type, value) {
    let targetSearchId = currentSearchId;

    // If viewing all searches, ask which one to apply to
    if (currentSearchId === 'all') {
        if (searches.length === 0) {
            alert('Nenhuma busca salva');
            return;
        }
        if (searches.length === 1) {
            targetSearchId = searches[0].id;
        } else {
            // Show selection prompt
            const options = searches.map((s, i) => `${i + 1}. ${s.name}`).join('\n');
            const choice = prompt(`Selecione a busca para ignorar "${value}":\n\n${options}\n\nDigite o número:`);
            if (!choice) return;
            const index = parseInt(choice, 10) - 1;
            if (isNaN(index) || index < 0 || index >= searches.length) {
                alert('Opção inválida');
                return;
            }
            targetSearchId = searches[index].id;
        }
    }

    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`${API_BASE_URL}/api/searches/${targetSearchId}`, { headers });
        const result = await response.json();
        if (!result.success) return;

        const search = result.data;
        const field = type === 'brand' ? 'ignored_brands' : 'ignored_models';
        let list = [];

        // Parse existing list
        try {
            list = typeof search[field] === 'string' ? JSON.parse(search[field]) : (search[field] || []);
        } catch (e) {
            list = [];
        }

        if (list.includes(value)) {
            list = list.filter(v => v !== value);
        } else {
            list.push(value);
        }

        await fetch(`${API_BASE_URL}/api/searches/${targetSearchId}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ [field]: list })
        });

        alert(`${type === 'brand' ? 'Marca' : 'Modelo'} "${value}" ${list.includes(value) ? 'ignorado' : 'removido da lista de ignorados'}`);
        await loadAllData();
    } catch (e) {
        console.error('Failed to toggle ignored:', e);
        alert('Erro ao salvar');
    }
}

// Toggle favorite
async function toggleFavorite(id, currentStatus) {
    const newStatus = currentStatus === 'favorite' ? 'seen' : 'favorite';
    const oldIcon = currentStatus === 'favorite' ? '⭐' : '☆';

    // Optimistic update (UI only)
    const btns = document.querySelectorAll(`button[data-id="${id}"]`);
    btns.forEach(btn => {
        btn.dataset.status = newStatus;
        btn.innerHTML = newStatus === 'favorite' ? '⭐' : '☆';
        btn.classList.toggle('active', newStatus === 'favorite');
    });

    try {
        const headers = await getAuthHeaders();
        await fetch(`${API_BASE_URL}/api/alerts/${id}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ status: newStatus })
        });

        // Reload to sync state only if needed (optional)
        // await loadListings(false); 
    } catch (e) {
        console.error('Failed to toggle favorite:', e);
        // Revert UI
        btns.forEach(btn => {
            btn.dataset.status = currentStatus;
            btn.innerHTML = oldIcon;
            btn.classList.toggle('active', currentStatus === 'favorite');
        });
    }
}

// Update last check time
function updateLastCheck() {
    const search = searches.find(s => s.id === currentSearchId);
    if (search?.last_checked_at) {
        const date = new Date(search.last_checked_at);
        lastCheck.textContent = `Última: ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    } else {
        lastCheck.textContent = 'Última: --:--';
    }
}

// Utility functions
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function formatPrice(value) {
    if (!value) return '-';
    return `R$ ${(value / 1000).toFixed(0)}k`;
}

function isRecent(dateStr) {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    const now = new Date();
    const diffHours = (now - date) / (1000 * 60 * 60);
    return diffHours < 24;
}

function debounce(fn, ms) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), ms);
    };
}

// Settings Functions
function openSettingsModal() {
    // Populate search select
    settingsSearchSelect.innerHTML = '<option value="">Selecione uma busca</option>' +
        searches.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');

    // If a specific search is selected, load it
    if (currentSearchId !== 'all') {
        settingsSearchSelect.value = currentSearchId;
        loadSettingsForSearch(currentSearchId);
    } else if (searches.length === 1) {
        settingsSearchSelect.value = searches[0].id;
        loadSettingsForSearch(searches[0].id);
    } else {
        // Clear settings
        settingFrequency.value = '60';
        settingMinGroup.value = '5';
        ignoredBrandsContainer.innerHTML = '<span style="color: var(--text-muted)">Selecione uma busca acima</span>';
        ignoredModelsContainer.innerHTML = '<span style="color: var(--text-muted)">Selecione uma busca acima</span>';
    }

    settingsModal.classList.add('active');
}

async function loadSettingsForSearch(searchId) {
    if (!searchId) {
        ignoredBrandsContainer.innerHTML = '<span style="color: var(--text-muted)">Selecione uma busca</span>';
        ignoredModelsContainer.innerHTML = '<span style="color: var(--text-muted)">Selecione uma busca</span>';
        return;
    }

    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`${API_BASE_URL}/api/searches/${searchId}`, { headers });
        const result = await response.json();

        if (result.success && result.data) {
            const search = result.data;

            // Frequency
            settingFrequency.value = search.check_period_minutes || '60';

            // Min group size
            settingMinGroup.value = search.min_group_size || '5';

            // Ignored brands
            let ignoredBrands = [];
            try {
                ignoredBrands = typeof search.ignored_brands === 'string'
                    ? JSON.parse(search.ignored_brands)
                    : (search.ignored_brands || []);
            } catch (e) { ignoredBrands = []; }

            renderChips(ignoredBrandsContainer, ignoredBrands, 'brand');

            // Ignored models
            let ignoredModels = [];
            try {
                ignoredModels = typeof search.ignored_models === 'string'
                    ? JSON.parse(search.ignored_models)
                    : (search.ignored_models || []);
            } catch (e) { ignoredModels = []; }

            renderChips(ignoredModelsContainer, ignoredModels, 'model');
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
    }
}

function renderChips(container, items, type) {
    if (!items || items.length === 0) {
        container.innerHTML = '<span style="color: var(--text-muted)">Nenhum item ignorado</span>';
        return;
    }

    container.innerHTML = items.map(item => `
        <span class="chip">
            ${escapeHtml(item)}
            <button class="chip-remove" data-action="remove-chip" data-type="${type}" data-value="${escapeHtml(item)}">&times;</button>
        </span>
    `).join('');
}

async function saveSettings() {
    const searchId = settingsSearchSelect.value;
    if (!searchId) {
        alert('Selecione uma busca para salvar as configurações');
        return;
    }

    try {
        // Get current ignored lists from chips
        const ignoredBrands = Array.from(ignoredBrandsContainer.querySelectorAll('.chip'))
            .map(chip => chip.textContent.trim().replace('×', '').trim());
        const ignoredModels = Array.from(ignoredModelsContainer.querySelectorAll('.chip'))
            .map(chip => chip.textContent.trim().replace('×', '').trim());

        const settings = {
            check_period_minutes: parseInt(settingFrequency.value, 10),
            min_group_size: parseInt(settingMinGroup.value, 10),
            ignored_brands: ignoredBrands,
            ignored_models: ignoredModels
        };

        const headers = await getAuthHeaders();
        const response = await fetch(`${API_BASE_URL}/api/searches/${searchId}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify(settings)
        });

        const result = await response.json();
        if (result.success) {
            alert('Configurações salvas com sucesso!');
            settingsModal.classList.remove('active');
            await loadAllData();
        } else {
            alert('Erro ao salvar: ' + (result.error || 'Desconhecido'));
        }
    } catch (e) {
        console.error('Failed to save settings:', e);
        alert('Erro ao salvar configurações');
    }
}

// Handle chip removal
document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="remove-chip"]');
    if (!btn) return;

    const chip = btn.closest('.chip');
    if (chip) {
        chip.remove();
    }
});

