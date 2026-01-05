/**
 * OLX Car Finder - Service Worker
 * Handles background tasks: alarms, notifications, badge, and API communication
 */

// API Configuration
const API_BASE_URL = 'https://olx-car-finder.dyonathan.workers.dev'; // Production URL

// Alarm name prefix
const ALARM_PREFIX = 'olx-scan-';

// Badge state
let totalNewCount = 0;

// Initialize on install
chrome.runtime.onInstalled.addListener(async () => {
    console.log('OLX Car Finder installed');
    await scheduleAllAlarms();
    await updateBadge();
});

// Handle startup
chrome.runtime.onStartup.addListener(async () => {
    console.log('OLX Car Finder startup');
    await updateBadge();
});

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name.startsWith(ALARM_PREFIX)) {
        const searchId = alarm.name.replace(ALARM_PREFIX, '');
        console.log(`Alarm triggered for search: ${searchId}`);
        await scanSearch(searchId);
    }
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SEARCH_SAVED') {
        scheduleAlarm(message.search);
        sendResponse({ success: true });
    } else if (message.type === 'CLEAR_BADGE') {
        clearBadge();
        sendResponse({ success: true });
    } else if (message.type === 'GET_BADGE_COUNT') {
        sendResponse({ count: totalNewCount });
    }
    return true;
});

// Helper to get headers with auth
async function getAuthHeaders() {
    const stored = await chrome.storage.sync.get('apiToken');
    const token = stored.apiToken || 'change-me-in-prod-please';
    return {
        'Content-Type': 'application/json',
        'X-Access-Token': token
    };
}

// Schedule alarms for all saved searches
async function scheduleAllAlarms() {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`${API_BASE_URL}/api/searches`, { headers });
        const result = await response.json();

        if (result.success && result.data) {
            // Clear all existing alarms
            await chrome.alarms.clearAll();

            // Schedule new alarms
            for (const search of result.data) {
                await scheduleAlarm(search);
            }

            console.log(`Scheduled ${result.data.length} search alarms`);
        }
    } catch (error) {
        console.error('Error scheduling alarms:', error);
    }
}

// Schedule alarm for a single search
async function scheduleAlarm(search) {
    const alarmName = `${ALARM_PREFIX}${search.id}`;

    await chrome.alarms.create(alarmName, {
        delayInMinutes: 1, // First check in 1 minute
        periodInMinutes: search.check_period_minutes || 60
    });

    console.log(`Scheduled alarm for "${search.name}" every ${search.check_period_minutes} minutes`);
}

// Scan a single search for new ads
async function scanSearch(searchId) {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`${API_BASE_URL}/api/scan/${searchId}`, {
            method: 'POST',
            headers
        });

        const result = await response.json();

        if (result.success && result.data && result.data.newCount > 0) {
            await showNotification(searchId, result.data);
            await incrementBadge(result.data.newCount);
        }
    } catch (error) {
        console.error(`Error scanning search ${searchId}:`, error);
    }
}

// Show notification for new ads
async function showNotification(searchId, data) {
    const notificationId = `new-ads-${searchId}-${Date.now()}`;

    // Create notification with action buttons
    await chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: `🚗 ${data.searchName || 'OLX Car Finder'}`,
        message: `${data.newCount} novos anúncios encontrados!`,
        priority: 2,
        requireInteraction: true,
        buttons: [
            { title: '🔗 Abrir anúncio' },
            { title: '📊 Dashboard' }
        ]
    });

    // Store notification data for click handling
    await chrome.storage.local.set({
        [`notification-${notificationId}`]: {
            searchId,
            newAds: data.newAds
        }
    });
}

// Badge management
async function updateBadge() {
    try {
        // Get count of new alerts from storage or API
        const stored = await chrome.storage.local.get('newAlertCount');
        totalNewCount = stored.newAlertCount || 0;
        await setBadge(totalNewCount);
    } catch (error) {
        console.error('Error updating badge:', error);
    }
}

async function incrementBadge(count) {
    totalNewCount += count;
    await chrome.storage.local.set({ newAlertCount: totalNewCount });
    await setBadge(totalNewCount);
}

async function clearBadge() {
    totalNewCount = 0;
    await chrome.storage.local.set({ newAlertCount: 0 });
    await setBadge(0);
}

async function setBadge(count) {
    if (count > 0) {
        await chrome.action.setBadgeText({ text: String(count > 99 ? '99+' : count) });
        await chrome.action.setBadgeBackgroundColor({ color: '#FF4444' });
    } else {
        await chrome.action.setBadgeText({ text: '' });
    }
}

// Handle notification clicks
chrome.notifications.onClicked.addListener(async (notificationId) => {
    if (notificationId.startsWith('new-ads-')) {
        const stored = await chrome.storage.local.get(`notification-${notificationId}`);
        const data = stored[`notification-${notificationId}`];

        if (data && data.newAds && data.newAds.length > 0) {
            // Open first new ad
            chrome.tabs.create({ url: data.newAds[0].ad_url });
        } else {
            // Open dashboard
            chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html') });
        }

        // Clear notification
        chrome.notifications.clear(notificationId);
        await chrome.storage.local.remove(`notification-${notificationId}`);
    }
});

// Handle notification button clicks
chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
    const stored = await chrome.storage.local.get(`notification-${notificationId}`);
    const data = stored[`notification-${notificationId}`];

    if (buttonIndex === 0) {
        // Button 0: Open first ad
        if (data && data.newAds && data.newAds.length > 0) {
            chrome.tabs.create({ url: data.newAds[0].ad_url });
        }
    } else if (buttonIndex === 1) {
        // Button 1: Open dashboard
        chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html') });
    }

    chrome.notifications.clear(notificationId);
    await chrome.storage.local.remove(`notification-${notificationId}`);
});

console.log('OLX Car Finder service worker loaded');

