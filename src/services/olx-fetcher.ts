/**
 * OLX Fetcher Service
 * Handles fetching and parsing OLX search results from Next.js JSON endpoints
 */

import { OlxAd, OlxSearchResponse, Listing, ExecutionLog } from '../types';

// Constants
const MAX_PAGES = 5;
const OLX_BASE_URL = 'https://www.olx.com.br';
const BUILD_ID_CACHE_TTL = 60 * 60 * 1000; // 1 hour in milliseconds

// BuildId cache
interface BuildIdCacheEntry {
    buildId: string;
    timestamp: number;
}
const buildIdCache = new Map<string, BuildIdCacheEntry>();

/**
 * Get cached buildId or extract from page
 */
export async function getBuildId(humanUrl: string): Promise<string | null> {
    const urlHost = new URL(humanUrl).origin;
    const cached = buildIdCache.get(urlHost);

    if (cached && Date.now() - cached.timestamp < BUILD_ID_CACHE_TTL) {
        console.log(`Using cached buildId for ${urlHost}`);
        return cached.buildId;
    }

    const buildId = await extractBuildId(humanUrl);
    if (buildId) {
        buildIdCache.set(urlHost, { buildId, timestamp: Date.now() });
        console.log(`Cached buildId for ${urlHost}: ${buildId}`);
    }
    return buildId;
}

/**
 * Extract buildId from OLX page HTML
 * The buildId is required to construct the _next/data URL
 */
export async function extractBuildId(humanUrl: string): Promise<string | null> {
    try {
        const response = await fetch(humanUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
            },
        });

        if (!response.ok) {
            console.error(`Failed to fetch OLX page: ${response.status}`);
            return null;
        }

        const html = await response.text();

        // Look for buildId in the HTML
        // Pattern 1: "buildId":"xxxxx"
        const buildIdMatch = html.match(/"buildId"\s*:\s*"([^"]+)"/);
        if (buildIdMatch) {
            return buildIdMatch[1];
        }

        // Pattern 2: /_next/static/xxxxx/_buildManifest.js
        const manifestMatch = html.match(/_next\/static\/([^/]+)\/_buildManifest\.js/);
        if (manifestMatch) {
            return manifestMatch[1];
        }

        console.error('Could not find buildId in page');
        return null;
    } catch (error) {
        console.error('Error extracting buildId:', error);
        return null;
    }
}

/**
 * Convert human URL to Next.js data URL
 */
export function buildDataUrl(humanUrl: string, buildId: string, page: number = 1): string {
    try {
        const url = new URL(humanUrl);
        const pathname = url.pathname;

        // Build the _next/data path
        // Example: /autos-e-pecas/carros-vans-e-utilitarios/estado-rs -> same path + .json
        let dataPath = pathname;
        if (!dataPath.endsWith('.json')) {
            dataPath = dataPath + '.json';
        }

        // Construct the full data URL
        const dataUrl = new URL(`/_next/data/${buildId}${dataPath}`, OLX_BASE_URL);

        // Copy search params
        url.searchParams.forEach((value, key) => {
            dataUrl.searchParams.set(key, value);
        });

        // Set page number
        if (page > 1) {
            dataUrl.searchParams.set('sp', String(page));
        }

        return dataUrl.toString();
    } catch (error) {
        console.error('Error building data URL:', error);
        throw error;
    }
}

/**
 * Fetch a single page of results from OLX
 */
/**
 * Fetch a single page of results from OLX
 * Returns the raw parsed data or null if error
 * Throws error on 404 (likely expired buildId) to trigger retry
 */
export async function fetchPage(dataUrl: string): Promise<{ ads: OlxAd[], status: number }> {
    try {
        const response = await fetch(dataUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Referer': OLX_BASE_URL,
            },
        });

        // 404 usually means buildId is stale
        if (response.status === 404) {
            console.warn(`Fetch returned 404 for ${dataUrl}`);
            return { ads: [], status: 404 };
        }

        if (!response.ok) {
            console.error(`Failed to fetch page: ${response.status}`);
            return { ads: [], status: response.status };
        }

        const data: OlxSearchResponse = await response.json();
        const ads = data?.pageProps?.ads || [];

        return { ads: ads.filter(ad => ad.listId && ad.url), status: 200 };
    } catch (error) {
        console.error('Error fetching page:', error);
        return { ads: [], status: 500 };
    }
}

/**
 * Parse OLX ad to our Listing format
 */
export function parseAd(ad: OlxAd, searchId: string): Listing {
    // Try to extract model from properties
    let model: string | null = null;
    if (ad.properties) {
        const modelProp = ad.properties.find(p =>
            p.label.toLowerCase().includes('modelo') ||
            p.label.toLowerCase().includes('model')
        );
        if (modelProp) {
            model = modelProp.value;
        }
    }

    // Fallback: extract model from subject (first word after brand)
    if (!model && ad.subject) {
        model = extractModelFromSubject(ad.subject);
    }

    // Extract mileage
    let mileage: number | null = null;
    if (ad.properties) {
        const mileageProp = ad.properties.find(p =>
            p.label.toLowerCase().includes('quilômet') ||
            p.label.toLowerCase().includes('mileage') ||
            p.label.toLowerCase().includes('km')
        );
        if (mileageProp) {
            // Remove non-digits and parse
            const clean = mileageProp.value.replace(/\D/g, '');
            mileage = parseInt(clean, 10) || null;
        }
    }

    return {
        list_id: String(ad.listId),
        search_id: searchId,
        subject: ad.subject || null,
        price: ad.price || null,
        municipality: ad.location?.municipality || null,
        neighbourhood: ad.location?.neighbourhood || null,
        ad_url: ad.url.startsWith('http') ? ad.url : `${OLX_BASE_URL}${ad.url}`,
        model: model,
        date_ts: ad.date || null,
        thumbnail_url: ad.thumbnail || null,
        mileage: mileage,
        collected_at: new Date().toISOString(),
    };
}

export function extractModelFromSubject(subject: string): string | null {
    let text = subject.trim();

    // Remove common noise words (case insensitive)
    const noise = /^(vendo|troco|compro|alugo|financio|repasso|barato|urgente|oportunidade|novo|lindo|top)\s+/i;
    text = text.replace(noise, '');

    const words = text.split(/\s+/);

    // Filter out years (4 digits starting with 19 or 20) and engine sizes (1.0, 1.4, etc)
    const cleanWords = words.filter(w =>
        !/^(19|20)\d{2}$/.test(w) && // Years
        !/^\d\.\d$/.test(w)           // Engine 1.0, 1.6
    );

    if (cleanWords.length >= 1) {
        // Take up to 2 words, but stop if 2nd word looks like a spec (4p, flex, auto)
        const specs = /^(4p|2p|flex|auto|manual|aut|mt|at)$/i;

        if (cleanWords.length >= 2 && !specs.test(cleanWords[1])) {
            return cleanWords.slice(0, 2).join(' ');
        } else {
            return cleanWords[0];
        }
    }
    return null;
}

/**
 * Fetch all pages for a search (up to MAX_PAGES)
 */
export interface FetchStats {
    listings: Listing[];
    sp_min: number;
    sp_max: number;
    stop_reason: ExecutionLog['stop_reason'];
    duration_ms: number;
    requests_count: number;
    first_list_id: string | null;
    error_message?: string;
}

/**
 * Fetch all pages for a search with reliability features:
 * - Autocura de buildId (retry on 404)
 * - Anti-loop protection
 * - Detailed stats
 */
export async function fetchAllPages(
    humanUrl: string,
    searchId: string,
    maxPages: number = MAX_PAGES
): Promise<FetchStats> {
    const startTime = Date.now();
    const listings: Listing[] = [];
    const seenIds = new Set<string>();
    let requestsCount = 0;
    let stopReason: ExecutionLog['stop_reason'] = 'completed';
    let errorMessage: string | undefined;

    // Track first listing ID of each page to detect loops/stuck state
    // Map<pageNumber, firstListId>
    const pageFirstIds = new Map<number, string>();

    // Initial buildId
    let buildId = await getBuildId(humanUrl);
    requestsCount++; // buildId fetch counts as request roughly (HTML fetch)

    if (!buildId) {
        return {
            listings: [],
            sp_min: 0,
            sp_max: 0,
            stop_reason: 'error',
            error_message: 'Could not resolve buildId',
            duration_ms: Date.now() - startTime,
            requests_count: requestsCount,
            first_list_id: null
        };
    }

    let page = 1;
    let retryCount = 0;
    const MAX_RETRIES = 1;

    for (; page <= maxPages; page++) {
        const dataUrl = buildDataUrl(humanUrl, buildId, page);
        console.log(`Fetching page ${page}: ${dataUrl}`);
        requestsCount++;

        const { ads, status } = await fetchPage(dataUrl);

        // --- Autocura de buildId ---
        if (status === 404 && retryCount < MAX_RETRIES) {
            console.warn(`Page ${page} returned 404. Attempting to refresh buildId...`);

            // Force refresh buildId from live page
            const newBuildId = await extractBuildId(humanUrl);
            requestsCount++; // extra request

            if (newBuildId && newBuildId !== buildId) {
                console.log(`Recovered with new buildId: ${newBuildId}`);
                buildId = newBuildId;

                // Update cache
                const urlHost = new URL(humanUrl).origin;
                buildIdCache.set(urlHost, { buildId, timestamp: Date.now() });

                // Retry current page
                page--;
                retryCount++;
                continue;
            } else {
                console.error('Failed to recover buildId or buildId is same');
                stopReason = 'error';
                errorMessage = 'BuildId expired and refresh failed';
                break;
            }
        } else if (status === 404) {
            stopReason = 'error';
            errorMessage = 'Page 404 (likely buildId) after retry';
            break;
        }

        if (status !== 200 && status !== 404) {
            console.error(`Page ${page} error status ${status}`);
            // If transient error, maybe we continue? For now stop.
            stopReason = 'error';
            errorMessage = `HTTP ${status}`;
            break;
        }

        if (ads.length === 0) {
            console.log(`Page ${page} returned no ads, stopping`);
            stopReason = page === 1 ? 'empty' : 'completed';
            break;
        }

        // --- Anti-loop protection ---
        const firstId = String(ads[0].listId);

        // Check if we saw this firstId in ANY previous page (not just page 1)
        // This detects if pagination is broken (returning page 1 content for page 2)
        let loopDetected = false;
        for (const [p, fid] of pageFirstIds.entries()) {
            if (fid === firstId) {
                console.warn(`Anti-loop: Page ${page} has same first listing as page ${p}`);
                stopReason = 'loop';
                loopDetected = true;
                break;
            }
        }
        if (loopDetected) break;

        pageFirstIds.set(page, firstId);

        // Parse and dedupe
        let addedCount = 0;
        for (const ad of ads) {
            const listId = String(ad.listId);
            if (!seenIds.has(listId)) {
                seenIds.add(listId);
                listings.push(parseAd(ad, searchId));
                addedCount++;
            }
        }

        // If we fetched a full page but added nothing? (Maybe all dupes?)
        // Could be a stop condition, but let's trust maxPages limit.

        // Small delay
        if (page < maxPages) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    // Determine final stop reason if loop finished naturally
    if (page > maxPages && stopReason === 'completed') {
        stopReason = 'limit';
    }

    const duration = Date.now() - startTime;
    console.log(`Scan complete: ${listings.length} listings. Stop: ${stopReason}. Duration: ${duration}ms`);

    return {
        listings,
        sp_min: 1,
        sp_max: Math.min(page, maxPages), // page might be maxPages + 1 if loop completed
        stop_reason: stopReason,
        duration_ms: duration,
        requests_count: requestsCount,
        first_list_id: pageFirstIds.get(1) || null,
        error_message: errorMessage
    };
}
