/**
 * OLX Car Finder - Popup Script
 * Handles saving searches and displaying the list
 */

// API Configuration
const API_BASE_URL = 'https://olx-car-finder.dyonathan.workers.dev'; // Production URL

// DOM Elements
const saveForm = document.getElementById('save-form');
const searchNameInput = document.getElementById('search-name');
const checkPeriodSelect = document.getElementById('check-period');
const saveBtn = document.getElementById('save-btn');
const currentUrlInfo = document.getElementById('current-url-info');
const currentUrlSpan = document.getElementById('current-url');
const notOlxWarning = document.getElementById('not-olx-warning');
const searchesList = document.getElementById('searches-list');
const openDashboardLink = document.getElementById('open-dashboard');
const statusSpan = document.getElementById('status');
const scanAllBtn = document.getElementById('scan-all-btn');

let currentTabUrl = null;

// Helper to get headers with auth
async function getAuthHeaders() {
    const stored = await chrome.storage.sync.get('apiToken');
    const token = stored.apiToken || 'change-me-in-prod-please';
    return {
        'Content-Type': 'application/json',
        'X-Access-Token': token
    };
}

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
    await checkCurrentTab();
    await loadSearches();
    setupEventListeners();
});

// Check if current tab is an OLX search
async function checkCurrentTab() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (tab && tab.url && isOlxSearchUrl(tab.url)) {
            currentTabUrl = tab.url;
            currentUrlSpan.textContent = truncateUrl(tab.url);
            currentUrlInfo.classList.remove('hidden');
            notOlxWarning.classList.add('hidden');
            saveBtn.disabled = false;

            // Auto-suggest name from URL
            const suggestedName = extractSearchName(tab.url);
            if (suggestedName && !searchNameInput.value) {
                searchNameInput.placeholder = suggestedName;
            }
        } else {
            currentUrlInfo.classList.add('hidden');
            notOlxWarning.classList.remove('hidden');
            saveBtn.disabled = true;
        }
    } catch (error) {
        console.error('Error checking current tab:', error);
        notOlxWarning.classList.remove('hidden');
        saveBtn.disabled = true;
    }
}

// Check if URL is an OLX search URL
function isOlxSearchUrl(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname.includes('olx.com.br') &&
            (urlObj.pathname.includes('/autos-e-pecas') ||
                urlObj.pathname.includes('/carros-vans-e-utilitarios') ||
                urlObj.searchParams.has('q'));
    } catch {
        return false;
    }
}

// Extract a suggested name from URL
function extractSearchName(url) {
    try {
        const urlObj = new URL(url);
        const params = urlObj.searchParams;
        const parts = [];

        // Region
        const pathParts = urlObj.pathname.split('/').filter(p => p);
        if (pathParts[0] && pathParts[0] !== 'autos-e-pecas') {
            parts.push(pathParts[0].toUpperCase());
        }

        // Price range
        const priceFrom = params.get('pe') || params.get('ps');
        const priceTo = params.get('pf') || params.get('pe');
        if (priceFrom || priceTo) {
            parts.push(`${priceFrom || '0'}-${priceTo || '∞'}k`);
        }

        return parts.length > 0 ? parts.join(' ') : null;
    } catch {
        return null;
    }
}

// Truncate long URLs for display
function truncateUrl(url) {
    return url.length > 50 ? url.substring(0, 50) + '...' : url;
}

// Load saved searches from API
async function loadSearches() {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`${API_BASE_URL}/api/searches`, { headers });
        const result = await response.json();

        if (result.success && result.data) {
            renderSearches(result.data);
            updateStatus('Conectado', false);
        } else {
            throw new Error(result.error || 'Failed to load searches');
        }
    } catch (error) {
        console.error('Error loading searches:', error);
        searchesList.innerHTML = '<div class="empty-state">Erro ao conectar com o servidor</div>';
        updateStatus('Desconectado', true);
    }
}

// Render searches list
function renderSearches(searches) {
    if (searches.length === 0) {
        searchesList.innerHTML = '<div class="empty-state">Nenhuma busca salva ainda</div>';
        return;
    }

    searchesList.innerHTML = searches.map(search => `
    <div class="search-card" data-id="${search.id}">
      <div class="search-card-header">
        <span class="search-name">${escapeHtml(search.name)}</span>
        ${search.new_count ? `<span class="search-badge new">${search.new_count} novos</span>` : ''}
      </div>
      <div class="search-meta">
        <span>📅 ${formatDate(search.last_checked_at)}</span>
        <span>⏰ ${search.check_period_minutes}min</span>
      </div>
      <div class="search-actions">
        <button class="btn btn-secondary btn-sm" data-action="scan" data-id="${search.id}" title="Escanear agora">
          🔍
        </button>
        <button class="btn btn-secondary btn-sm" data-action="open" data-id="${search.id}" title="Abrir na OLX">
          🔗
        </button>
        <button class="btn btn-danger btn-sm" data-action="delete" data-id="${search.id}" title="Excluir">
          🗑️
        </button>
      </div>
    </div>
  `).join('');
}

// Format date for display
function formatDate(dateStr) {
    if (!dateStr) return 'Nunca verificado';
    const date = new Date(dateStr);
    return date.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Update status indicator
function updateStatus(text, isError) {
    statusSpan.textContent = text;
    statusSpan.classList.toggle('error', isError);
}

// Setup event listeners
function setupEventListeners() {
    // Save form submission
    saveForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveSearch();
    });

    // Open dashboard
    openDashboardLink.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html') });
    });

    // Scan all button
    scanAllBtn.addEventListener('click', async () => {
        await scanAllSearches();
    });

    // Event delegation for search card actions
    searchesList.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;

        const action = btn.dataset.action;
        const id = btn.dataset.id;

        if (action === 'open') {
            await openSearchById(id);
        } else if (action === 'delete') {
            await deleteSearchById(id);
        } else if (action === 'scan') {
            await scanSearchById(id, btn);
        }
    });
}

// Save a new search
async function saveSearch() {
    if (!currentTabUrl) return;

    const name = searchNameInput.value.trim();
    if (!name) {
        alert('Por favor, informe um nome para a busca');
        return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Salvando...';

    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`${API_BASE_URL}/api/searches`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                name: name,
                human_url: currentTabUrl,
                check_period_minutes: parseInt(checkPeriodSelect.value)
            })
        });

        const result = await response.json();

        if (result.success) {
            searchNameInput.value = '';
            await loadSearches();

            // Notify service worker to schedule alarm
            chrome.runtime.sendMessage({
                type: 'SEARCH_SAVED',
                search: result.data
            });
        } else {
            throw new Error(result.error || 'Failed to save search');
        }
    } catch (error) {
        console.error('Error saving search:', error);
        alert('Erro ao salvar busca: ' + error.message);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 Salvar Busca';
    }
}

// Open search in OLX
async function openSearchById(id) {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`${API_BASE_URL}/api/searches/${id}`, { headers });
        const result = await response.json();

        if (result.success && result.data) {
            chrome.tabs.create({ url: result.data.human_url });
        }
    } catch (error) {
        console.error('Error opening search:', error);
    }
}

// Delete a search
async function deleteSearchById(id) {
    if (!confirm('Tem certeza que deseja excluir esta busca?')) return;

    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`${API_BASE_URL}/api/searches/${id}`, {
            method: 'DELETE',
            headers
        });

        const result = await response.json();

        if (result.success) {
            await loadSearches();
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('Error deleting search:', error);
        alert('Erro ao excluir busca');
    }
}

// Scan a specific search
async function scanSearchById(id, btn) {
    const originalText = btn.textContent;
    btn.textContent = '⏳';
    btn.disabled = true;

    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`${API_BASE_URL}/api/scan/${id}`, {
            method: 'POST',
            headers
        });

        const result = await response.json();

        if (result.success) {
            const { newCount } = result.data;
            if (newCount > 0) {
                btn.textContent = `✅ ${newCount}`;
                // Play notification sound
                playNotificationSound();
            } else {
                btn.textContent = '✓';
            }
            setTimeout(() => {
                btn.textContent = originalText;
                loadSearches(); // Refresh list
            }, 2000);
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('Error scanning search:', error);
        btn.textContent = '❌';
        setTimeout(() => {
            btn.textContent = originalText;
        }, 2000);
    } finally {
        btn.disabled = false;
    }
}

// Scan all searches
async function scanAllSearches() {
    scanAllBtn.textContent = '⏳ Escaneando...';
    scanAllBtn.disabled = true;

    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`${API_BASE_URL}/api/scan`, {
            method: 'POST',
            headers
        });

        const result = await response.json();

        if (result.success) {
            const totalNew = result.data.reduce((sum, r) => sum + (r.newCount || 0), 0);
            if (totalNew > 0) {
                scanAllBtn.textContent = `✅ ${totalNew} novos!`;
                playNotificationSound();
            } else {
                scanAllBtn.textContent = '✓ Nenhum novo';
            }
            await loadSearches();
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('Error scanning all:', error);
        scanAllBtn.textContent = '❌ Erro';
    } finally {
        setTimeout(() => {
            scanAllBtn.textContent = '🔍 Escanear Todas';
            scanAllBtn.disabled = false;
        }, 3000);
    }
}

// Play notification sound
function playNotificationSound() {
    try {
        const audio = new Audio(chrome.runtime.getURL('sounds/notification.mp3'));
        audio.volume = 0.5;
        audio.play().catch(() => { }); // Ignore errors if sound fails
    } catch (e) {
        // Sound not available
    }
}
