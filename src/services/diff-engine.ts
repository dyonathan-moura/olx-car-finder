/**
 * Diff Engine Service
 * Detects new listings and manages alerts
 */

import { Env, Listing, Alert, SavedSearchRow } from '../types';

// Maximum seen_ids per search (cap to prevent unlimited growth)
const SEEN_IDS_CAP = 2000;

/**
 * Get all seen IDs for a search
 */
export async function getSeenIds(env: Env, searchId: string): Promise<Set<string>> {
    const { results } = await env.DB.prepare(
        'SELECT list_id FROM seen_ids WHERE search_id = ?'
    ).bind(searchId).all<{ list_id: string }>();

    return new Set(results.map(r => r.list_id));
}

/**
 * Add new IDs to seen_ids table, respecting the cap
 */
export async function addSeenIds(
    env: Env,
    searchId: string,
    newIds: string[]
): Promise<void> {
    if (newIds.length === 0) return;

    // Insert new IDs
    const insertStmt = env.DB.prepare(
        'INSERT OR IGNORE INTO seen_ids (search_id, list_id) VALUES (?, ?)'
    );

    const batch = newIds.map(id => insertStmt.bind(searchId, id));
    await env.DB.batch(batch);

    // Enforce cap: delete oldest entries if over limit
    await env.DB.prepare(`
    DELETE FROM seen_ids 
    WHERE search_id = ? 
    AND id NOT IN (
      SELECT id FROM seen_ids 
      WHERE search_id = ? 
      ORDER BY first_seen_at DESC 
      LIMIT ?
    )
  `).bind(searchId, searchId, SEEN_IDS_CAP).run();
}

/**
 * Compute diff between current listings and seen IDs
 */
export function computeDiff(
    currentListings: Listing[],
    seenIds: Set<string>
): Listing[] {
    return currentListings.filter(listing => !seenIds.has(listing.list_id));
}

/**
 * Check whitelist/blacklist filters
 */
export function applyModelFilters(
    listings: Listing[],
    whitelist: string[],
    blacklist: string[]
): Listing[] {
    let filtered = listings;

    // Apply whitelist (only if not empty)
    if (whitelist.length > 0) {
        const whitelistLower = whitelist.map(m => m.toLowerCase());
        filtered = filtered.filter(listing => {
            if (!listing.model) return false;
            return whitelistLower.some(w => listing.model!.toLowerCase().includes(w));
        });
    }

    // Apply blacklist
    if (blacklist.length > 0) {
        const blacklistLower = blacklist.map(m => m.toLowerCase());
        filtered = filtered.filter(listing => {
            if (!listing.model) return true; // Keep if no model (can't be blacklisted)
            return !blacklistLower.some(b => listing.model!.toLowerCase().includes(b));
        });
    }

    return filtered;
}

/**
 * Create alerts for new listings
 */
export async function createAlerts(
    env: Env,
    searchId: string,
    newListings: Listing[]
): Promise<Alert[]> {
    if (newListings.length === 0) return [];

    const alerts: Alert[] = [];
    const now = new Date().toISOString();

    const insertStmt = env.DB.prepare(`
    INSERT INTO alerts (search_id, list_id, subject, price, municipality, neighbourhood, ad_url, model, thumbnail_url, mileage, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)
  `);

    const batch = newListings.map(listing => {
        const alert: Alert = {
            id: 0, // Will be set by DB
            search_id: searchId,
            list_id: listing.list_id,
            subject: listing.subject,
            price: listing.price,
            municipality: listing.municipality,
            neighbourhood: listing.neighbourhood,
            ad_url: listing.ad_url,
            model: listing.model,
            thumbnail_url: listing.thumbnail_url,
            mileage: listing.mileage,
            status: 'new',
            created_at: now,
        };
        alerts.push(alert);

        return insertStmt.bind(
            searchId,
            listing.list_id,
            listing.subject,
            listing.price,
            listing.municipality,
            listing.neighbourhood,
            listing.ad_url,
            listing.model,
            listing.thumbnail_url,
            listing.mileage,
            now
        );
    });

    await env.DB.batch(batch);

    return alerts;
}

/**
 * Update search's last_checked_at timestamp
 */
export async function updateSearchTimestamp(env: Env, searchId: string): Promise<void> {
    await env.DB.prepare(
        "UPDATE saved_searches SET last_checked_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).bind(searchId).run();
}

/**
 * Main scan function: orchestrates fetching, diffing, and alert creation
 */
export async function scanSearch(
    env: Env,
    search: SavedSearchRow
): Promise<{ newCount: number; totalScanned: number; alerts: Alert[] }> {
    // Import dynamically to avoid circular deps
    const { fetchAllPages } = await import('./olx-fetcher');

    console.log(`Starting scan for search: ${search.name} (${search.id})`);

    // Fetch current listings with reliability stats
    const stats = await fetchAllPages(search.human_url, search.id);
    const { listings, sp_min, sp_max, stop_reason, duration_ms, requests_count, first_list_id, error_message } = stats;

    // Log execution stats
    try {
        await env.DB.prepare(`
            INSERT INTO execution_logs 
            (search_id, sp_min, sp_max, listings_count, new_listings_count, first_list_id, stop_reason, duration_ms, requests_count, error_message, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).bind(
            search.id,
            sp_min,
            sp_max,
            listings.length,
            0, // Placeholder, updated below
            first_list_id,
            stop_reason,
            duration_ms,
            requests_count,
            error_message || null
        ).run();
    } catch (err) {
        console.error('Failed to log execution stats:', err);
    }

    if (listings.length === 0) {
        console.log('No listings found, updating timestamp only');
        await updateSearchTimestamp(env, search.id);
        return { newCount: 0, totalScanned: 0, alerts: [] };
    }

    // Get seen IDs
    const seenIds = await getSeenIds(env, search.id);

    // Compute diff
    let newListings = computeDiff(listings, seenIds);

    // Apply filters
    const whitelist = JSON.parse(search.model_whitelist || '[]');
    const blacklist = JSON.parse(search.model_blacklist || '[]');
    newListings = applyModelFilters(newListings, whitelist, blacklist);

    console.log(`Found ${newListings.length} new listings (after filters)`);

    // Update log with actual new count
    // (We could update the row we just inserted, but for simplicity/perf we might just accept 0 or use a second query if critical. 
    // Actually, let's keep it simple. If we want new_listings_count to be accurate, we should have calculated it before logging or update it now.
    // Let's fire-and-forget an update for correctness)
    if (newListings.length > 0) {
        env.DB.prepare(`
            UPDATE execution_logs SET new_listings_count = ? WHERE search_id = ? AND created_at > datetime('now', '-1 minute') ORDER BY created_at DESC LIMIT 1
        `).bind(newListings.length, search.id).run().catch(() => { });
    }

    // Add all current IDs to seen (not just new ones, to track everything)
    const allIds = listings.map(l => l.list_id);
    await addSeenIds(env, search.id, allIds);

    // Create alerts for new listings
    const alerts = await createAlerts(env, search.id, newListings);

    // Update timestamp
    await updateSearchTimestamp(env, search.id);

    return {
        newCount: newListings.length,
        totalScanned: listings.length,
        alerts,
    };
}
