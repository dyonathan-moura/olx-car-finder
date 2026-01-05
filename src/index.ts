/**
 * OLX Car Finder - Cloudflare Worker Entry Point
 * 
 * API Routes:
 * - GET    /api/searches          - List all saved searches
 * - POST   /api/searches          - Create a new search
 * - GET    /api/searches/:id      - Get a specific search
 * - PUT    /api/searches/:id      - Update a search
 * - DELETE /api/searches/:id      - Delete a search
 * - GET    /api/searches/:id/alerts - Get alerts for a search
 * - POST   /api/scan              - Trigger manual scan for all searches
 * - POST   /api/scan/:id          - Trigger manual scan for a specific search
 */

import { Env, ApiResponse, CreateSearchRequest, UpdateSearchRequest, SavedSearch, SavedSearchRow, Alert } from './types';

// Generate UUID for new searches
function generateId(): string {
    return crypto.randomUUID();
}

// CORS headers for browser extension
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

// JSON response helper
function jsonResponse<T>(data: ApiResponse<T>, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
        },
    });
}

// Parse SavedSearchRow to SavedSearch
function parseSearch(row: SavedSearchRow): SavedSearch {
    return {
        ...row,
        model_whitelist: JSON.parse(row.model_whitelist || '[]'),
        model_blacklist: JSON.parse(row.model_blacklist || '[]'),
    };
}

// Route handlers
async function handleGetSearches(env: Env): Promise<Response> {
    try {
        const { results } = await env.DB.prepare(
            'SELECT * FROM saved_searches ORDER BY created_at DESC'
        ).all<SavedSearchRow>();

        const searches = results.map(parseSearch);
        return jsonResponse({ success: true, data: searches });
    } catch (error) {
        return jsonResponse({ success: false, error: String(error) }, 500);
    }
}

async function handleCreateSearch(request: Request, env: Env): Promise<Response> {
    try {
        const body: CreateSearchRequest = await request.json();

        if (!body.name || !body.human_url) {
            return jsonResponse({ success: false, error: 'name and human_url are required' }, 400);
        }

        const id = generateId();
        const checkPeriod = body.check_period_minutes || 60;

        await env.DB.prepare(
            `INSERT INTO saved_searches (id, name, human_url, check_period_minutes)
       VALUES (?, ?, ?, ?)`
        ).bind(id, body.name, body.human_url, checkPeriod).run();

        const { results } = await env.DB.prepare(
            'SELECT * FROM saved_searches WHERE id = ?'
        ).bind(id).all<SavedSearchRow>();

        return jsonResponse({ success: true, data: parseSearch(results[0]) }, 201);
    } catch (error) {
        return jsonResponse({ success: false, error: String(error) }, 500);
    }
}

async function handleGetSearch(id: string, env: Env): Promise<Response> {
    try {
        const { results } = await env.DB.prepare(
            'SELECT * FROM saved_searches WHERE id = ?'
        ).bind(id).all<SavedSearchRow>();

        if (results.length === 0) {
            return jsonResponse({ success: false, error: 'Search not found' }, 404);
        }

        return jsonResponse({ success: true, data: parseSearch(results[0]) });
    } catch (error) {
        return jsonResponse({ success: false, error: String(error) }, 500);
    }
}

async function handleUpdateSearch(id: string, request: Request, env: Env): Promise<Response> {
    try {
        const body: UpdateSearchRequest = await request.json();
        const updates: string[] = [];
        const values: unknown[] = [];

        if (body.name !== undefined) {
            updates.push('name = ?');
            values.push(body.name);
        }
        if (body.check_period_minutes !== undefined) {
            updates.push('check_period_minutes = ?');
            values.push(body.check_period_minutes);
        }
        if (body.model_whitelist !== undefined) {
            updates.push('model_whitelist = ?');
            values.push(JSON.stringify(body.model_whitelist));
        }
        if (body.model_blacklist !== undefined) {
            updates.push('model_blacklist = ?');
            values.push(JSON.stringify(body.model_blacklist));
        }

        if (updates.length === 0) {
            return jsonResponse({ success: false, error: 'No fields to update' }, 400);
        }

        updates.push("updated_at = datetime('now')");
        values.push(id);

        await env.DB.prepare(
            `UPDATE saved_searches SET ${updates.join(', ')} WHERE id = ?`
        ).bind(...values).run();

        const { results } = await env.DB.prepare(
            'SELECT * FROM saved_searches WHERE id = ?'
        ).bind(id).all<SavedSearchRow>();

        if (results.length === 0) {
            return jsonResponse({ success: false, error: 'Search not found' }, 404);
        }

        return jsonResponse({ success: true, data: parseSearch(results[0]) });
    } catch (error) {
        return jsonResponse({ success: false, error: String(error) }, 500);
    }
}

async function handleDeleteSearch(id: string, env: Env): Promise<Response> {
    try {
        const result = await env.DB.prepare(
            'DELETE FROM saved_searches WHERE id = ?'
        ).bind(id).run();

        if (result.meta.changes === 0) {
            return jsonResponse({ success: false, error: 'Search not found' }, 404);
        }

        return jsonResponse({ success: true, data: { deleted: id } });
    } catch (error) {
        return jsonResponse({ success: false, error: String(error) }, 500);
    }
}

async function handleGetAlerts(searchId: string, env: Env): Promise<Response> {
    try {
        const { results } = await env.DB.prepare(
            `SELECT * FROM alerts WHERE search_id = ? ORDER BY created_at DESC LIMIT 100`
        ).bind(searchId).all<Alert>();

        return jsonResponse({ success: true, data: results });
    } catch (error) {
        return jsonResponse({ success: false, error: String(error) }, 500);
    }
}

// Get model statistics for a search (or all searches if searchId is 'all')
async function handleGetModels(searchId: string, env: Env): Promise<Response> {
    try {
        let modelStats;

        if (searchId === 'all') {
            // Get model counts from ALL alerts
            const { results } = await env.DB.prepare(`
                SELECT 
                    COALESCE(model, 'Desconhecido') as model,
                    COUNT(*) as count,
                    MIN(CAST(REPLACE(REPLACE(REPLACE(price, 'R$ ', ''), '.', ''), ',', '') AS INTEGER)) as min_price,
                    MAX(CAST(REPLACE(REPLACE(REPLACE(price, 'R$ ', ''), '.', ''), ',', '') AS INTEGER)) as max_price
                FROM alerts 
                GROUP BY model 
                ORDER BY count DESC
                LIMIT 50
            `).all<{ model: string; count: number; min_price: number; max_price: number }>();
            modelStats = results;
        } else {
            // Get model counts from specific search
            const { results } = await env.DB.prepare(`
                SELECT 
                    COALESCE(model, 'Desconhecido') as model,
                    COUNT(*) as count,
                    MIN(CAST(REPLACE(REPLACE(REPLACE(price, 'R$ ', ''), '.', ''), ',', '') AS INTEGER)) as min_price,
                    MAX(CAST(REPLACE(REPLACE(REPLACE(price, 'R$ ', ''), '.', ''), ',', '') AS INTEGER)) as max_price
                FROM alerts 
                WHERE search_id = ?
                GROUP BY model 
                ORDER BY count DESC
                LIMIT 50
            `).bind(searchId).all<{ model: string; count: number; min_price: number; max_price: number }>();
            modelStats = results;
        }

        // Get whitelist/blacklist (only for specific search)
        let whitelist: string[] = [];
        let blacklist: string[] = [];

        if (searchId !== 'all') {
            const { results: searchResults } = await env.DB.prepare(
                'SELECT model_whitelist, model_blacklist FROM saved_searches WHERE id = ?'
            ).bind(searchId).all<{ model_whitelist: string; model_blacklist: string }>();

            whitelist = searchResults[0] ? JSON.parse(searchResults[0].model_whitelist || '[]') : [];
            blacklist = searchResults[0] ? JSON.parse(searchResults[0].model_blacklist || '[]') : [];
        }

        return jsonResponse({
            success: true,
            data: {
                models: modelStats,
                whitelist,
                blacklist,
                total: modelStats.reduce((sum, m) => sum + m.count, 0)
            }
        });
    } catch (error) {
        return jsonResponse({ success: false, error: String(error) }, 500);
    }
}

// Helper to parse price string to number
function parsePrice(priceStr: string | null): number {
    if (!priceStr) return 0;
    // Remove "R$", spaces, and dots (thousands separator)
    // Example: "R$ 10.000,00" -> "10000,00"
    let clean = priceStr.replace(/[R$\s.]/g, '');
    // Replace comma with dot (decimal separator) and parse
    // "10000,00" -> "10000.00" -> 10000
    clean = clean.replace(',', '.');
    return parseFloat(clean) || 0;
}

// Helper to extract brand from model string (first word)
function extractBrand(model: string | null): string {
    if (!model) return 'Desconhecido';
    const parts = model.trim().split(/\s+/);
    return parts[0] || 'Desconhecido';
}

// Get top opportunities (ads below median price)
async function handleGetOpportunities(searchId: string, params: URLSearchParams, env: Env): Promise<Response> {
    try {
        const limit = parseInt(params.get('limit') || '20', 10);
        const brand = params.get('brand');
        const model = params.get('model');

        // Get min_group_size
        let minGroupSize = 3;
        if (searchId !== 'all') {
            const search = await env.DB.prepare('SELECT min_group_size FROM saved_searches WHERE id = ?')
                .bind(searchId)
                .first<{ min_group_size: number }>();
            if (search?.min_group_size) {
                minGroupSize = search.min_group_size;
            }
        }

        // Get all alerts for this search
        let query = `SELECT * FROM alerts WHERE search_id = ?`;
        const bindings: (string | number)[] = [searchId === 'all' ? '' : searchId];

        if (searchId === 'all') {
            query = `SELECT * FROM alerts WHERE 1=1`;
            bindings.length = 0;
        }

        if (brand) {
            query += ` AND model LIKE ?`;
            bindings.push(`${brand}%`);
        }
        if (model) {
            query += ` AND model LIKE ?`;
            bindings.push(`%${model}%`);
        }

        query += ` ORDER BY created_at DESC`;

        const stmt = env.DB.prepare(query);
        const { results: alerts } = bindings.length > 0
            ? await stmt.bind(...bindings).all<Alert>()
            : await stmt.all<Alert>();

        // Calculate median prices AND mileage per model
        const modelPrices = new Map<string, number[]>();
        const modelMileages = new Map<string, number[]>();

        for (const alert of alerts) {
            const mdl = alert.model || 'Desconhecido';
            const price = parsePrice(alert.price);

            if (price > 0) {
                if (!modelPrices.has(mdl)) modelPrices.set(mdl, []);
                modelPrices.get(mdl)!.push(price);
            }

            if (alert.mileage && alert.mileage > 0) {
                if (!modelMileages.has(mdl)) modelMileages.set(mdl, []);
                modelMileages.get(mdl)!.push(alert.mileage);
            }
        }

        const modelPriceMedians = new Map<string, number>();
        const modelKmMedians = new Map<string, number>();

        // Helper for median
        const getMedian = (arr: number[]) => {
            arr.sort((a, b) => a - b);
            const mid = Math.floor(arr.length / 2);
            return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
        };

        for (const [mdl, prices] of modelPrices) {
            if (prices.length >= minGroupSize) {
                modelPriceMedians.set(mdl, getMedian(prices));
            }
        }
        for (const [mdl, kms] of modelMileages) {
            if (kms.length >= minGroupSize) {
                modelKmMedians.set(mdl, getMedian(kms));
            }
        }

        // Score opportunities
        const opportunities = alerts
            .map(alert => {
                const mdl = alert.model || 'Desconhecido';
                const price = parsePrice(alert.price);
                const medianPrice = modelPriceMedians.get(mdl);
                const medianKm = modelKmMedians.get(mdl);
                const km = alert.mileage || 0;

                if (!medianPrice || price <= 0) return null;

                const priceRatio = price / medianPrice;
                const kmRatio = (medianKm && km > 0) ? km / medianKm : 1;

                // Rules: 
                // 1. Price <= 0.92 median
                // 2. Price <= 0.95 median AND Km <= 0.90 median

                let isOpportunity = false;
                let explanations: string[] = [];
                let badges: string[] = [];

                if (priceRatio <= 0.92) {
                    isOpportunity = true;
                    const pctBelow = Math.round((1 - priceRatio) * 100);
                    explanations.push(`${pctBelow}% abaixo do preço médio`);
                    badges.push('💰 Preço Bom');
                } else if (priceRatio <= 0.95 && medianKm && km > 0 && kmRatio <= 0.90) {
                    isOpportunity = true;
                    explanations.push('Preço e KM abaixo da média');
                    badges.push('💎 Achado');
                }

                if (!isOpportunity) return null;

                // Add KM explanation if good
                if (medianKm && km > 0 && kmRatio <= 0.85) {
                    badges.push('📉 Baixo KM');
                }

                // Add Recency badge
                const created = new Date(alert.created_at);
                const now = new Date();
                const hoursAgo = (now.getTime() - created.getTime()) / (1000 * 60 * 60);
                if (hoursAgo < 24) {
                    badges.push('🆕 Novo');
                }

                // Calculate score (higher is better)
                // Score = price discount % + (km discount % / 2)
                let score = (1 - priceRatio) * 100;
                if (medianKm && km > 0) {
                    score += ((1 - kmRatio) * 100) / 2;
                }

                return {
                    ...alert,
                    brand: extractBrand(alert.model),
                    median: medianPrice,
                    pctBelowMedian: Math.round((1 - priceRatio) * 100),
                    score: score,
                    explanation: explanations.join('. '),
                    badges: badges
                };
            })
            .filter(Boolean)
            .sort((a, b) => (b?.score || 0) - (a?.score || 0))
            .slice(0, limit);

        return jsonResponse({ success: true, data: opportunities });
    } catch (error) {
        return jsonResponse({ success: false, error: String(error) }, 500);
    }
}

// Get brand distribution
async function handleGetBrands(searchId: string, env: Env): Promise<Response> {
    try {
        const query = searchId === 'all'
            ? `SELECT model FROM alerts`
            : `SELECT model FROM alerts WHERE search_id = ?`;

        const stmt = env.DB.prepare(query);
        const { results } = searchId === 'all'
            ? await stmt.all<{ model: string }>()
            : await stmt.bind(searchId).all<{ model: string }>();

        // Aggregate by brand (first word of model)
        const brandCounts = new Map<string, number>();
        for (const row of results) {
            const brand = extractBrand(row.model);
            brandCounts.set(brand, (brandCounts.get(brand) || 0) + 1);
        }

        const total = results.length;
        const brands = Array.from(brandCounts.entries())
            .map(([brand, count]) => ({
                brand,
                count,
                percentage: Math.round((count / total) * 100)
            }))
            .sort((a, b) => b.count - a.count);

        return jsonResponse({ success: true, data: { brands, total } });
    } catch (error) {
        return jsonResponse({ success: false, error: String(error) }, 500);
    }
}

// Get filtered listings with sorting
async function handleGetListings(searchId: string, params: URLSearchParams, env: Env): Promise<Response> {
    try {
        const limit = parseInt(params.get('limit') || '50', 10);
        const offset = parseInt(params.get('offset') || '0', 10);
        const brand = params.get('brand');
        const model = params.get('model');
        const sortBy = params.get('sort') || 'created_at';
        const sortOrder = params.get('order') || 'desc';

        // Build query
        let query = searchId === 'all'
            ? `SELECT * FROM alerts WHERE 1=1`
            : `SELECT * FROM alerts WHERE search_id = ?`;
        const bindings: (string | number)[] = searchId === 'all' ? [] : [searchId];

        if (brand) {
            query += ` AND model LIKE ?`;
            bindings.push(`${brand}%`);
        }
        if (model) {
            query += ` AND model LIKE ?`;
            bindings.push(`%${model}%`);
        }

        // Validate sort column
        const validSorts = ['created_at', 'price', 'model', 'municipality'];
        const safeSort = validSorts.includes(sortBy) ? sortBy : 'created_at';
        const safeOrder = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

        query += ` ORDER BY ${safeSort} ${safeOrder} LIMIT ? OFFSET ?`;
        bindings.push(limit, offset);

        const stmt = env.DB.prepare(query);
        const { results } = await stmt.bind(...bindings).all<Alert>();

        // Get total count
        let countQuery = searchId === 'all'
            ? `SELECT COUNT(*) as total FROM alerts WHERE 1=1`
            : `SELECT COUNT(*) as total FROM alerts WHERE search_id = ?`;
        const countBindings: string[] = searchId === 'all' ? [] : [searchId];

        if (brand) {
            countQuery += ` AND model LIKE ?`;
            countBindings.push(`${brand}%`);
        }
        if (model) {
            countQuery += ` AND model LIKE ?`;
            countBindings.push(`%${model}%`);
        }

        const countStmt = env.DB.prepare(countQuery);
        const countResult = countBindings.length > 0
            ? await countStmt.bind(...countBindings).first<{ total: number }>()
            : await countStmt.first<{ total: number }>();

        return jsonResponse({
            success: true,
            data: {
                listings: results.map(a => ({ ...a, brand: extractBrand(a.model) })),
                total: countResult?.total || 0,
                limit,
                offset
            }
        });
    } catch (error) {
        return jsonResponse({ success: false, error: String(error) }, 500);
    }
}

async function handleUpdateAlert(id: string, request: Request, env: Env): Promise<Response> {
    try {
        const body: { status: Alert['status'] } = await request.json();

        if (!['new', 'seen', 'opened', 'muted', 'favorite'].includes(body.status)) {
            return jsonResponse({ success: false, error: 'Invalid status' }, 400);
        }

        await env.DB.prepare(
            'UPDATE alerts SET status = ? WHERE id = ?'
        ).bind(body.status, id).run();

        return jsonResponse({ success: true, data: { id, status: body.status } });
    } catch (error) {
        return jsonResponse({ success: false, error: String(error) }, 500);
    }
}

// Main request handler
async function handleRequest(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Handle CORS preflight
    if (method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    // Authentication
    const { authenticate } = await import('./middleware/auth');
    const authResponse = authenticate(request, env);
    if (authResponse) return authResponse;

    // API Routes
    if (path === '/api/searches') {
        if (method === 'GET') return handleGetSearches(env);
        if (method === 'POST') return handleCreateSearch(request, env);
    }

    // Match /api/searches/:id
    const searchMatch = path.match(/^\/api\/searches\/([^/]+)$/);
    if (searchMatch) {
        const id = searchMatch[1];
        if (method === 'GET') return handleGetSearch(id, env);
        if (method === 'PUT') return handleUpdateSearch(id, request, env);
        if (method === 'DELETE') return handleDeleteSearch(id, env);
    }

    // Match /api/searches/:id/alerts
    const alertsMatch = path.match(/^\/api\/searches\/([^/]+)\/alerts$/);
    if (alertsMatch) {
        const id = alertsMatch[1];
        if (method === 'GET') return handleGetAlerts(id, env);
    }

    // Match /api/searches/:id/models (get model statistics)
    const modelsMatch = path.match(/^\/api\/searches\/([^/]+)\/models$/);
    if (modelsMatch) {
        const id = modelsMatch[1];
        if (method === 'GET') return handleGetModels(id, env);
    }

    // Match /api/searches/:id/opportunities (get top opportunities)
    const opportunitiesMatch = path.match(/^\/api\/searches\/([^/]+)\/opportunities$/);
    if (opportunitiesMatch) {
        const id = opportunitiesMatch[1];
        if (method === 'GET') return handleGetOpportunities(id, url.searchParams, env);
    }

    // Match /api/searches/:id/brands (get brand distribution)
    const brandsMatch = path.match(/^\/api\/searches\/([^/]+)\/brands$/);
    if (brandsMatch) {
        const id = brandsMatch[1];
        if (method === 'GET') return handleGetBrands(id, env);
    }

    // Match /api/searches/:id/listings (get filtered listings)
    const listingsMatch = path.match(/^\/api\/searches\/([^/]+)\/listings$/);
    if (listingsMatch) {
        const id = listingsMatch[1];
        if (method === 'GET') return handleGetListings(id, url.searchParams, env);
    }

    // Match /api/alerts/:id (update alert status)
    const alertMatch = path.match(/^\/api\/alerts\/([^/]+)$/);
    if (alertMatch) {
        const id = alertMatch[1];
        if (method === 'PUT') return handleUpdateAlert(id, request, env);
    }

    // Match /api/scan (scan all searches)
    if (path === '/api/scan' && method === 'POST') {
        return handleScanAll(env);
    }

    // Match /api/scan/:id (scan specific search)
    const scanMatch = path.match(/^\/api\/scan\/([^/]+)$/);
    if (scanMatch && method === 'POST') {
        const id = scanMatch[1];
        return handleScanOne(id, env);
    }

    // Health check
    if (path === '/health') {
        return jsonResponse({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
    }

    // 404 for unmatched routes
    // Match /api/migrate-models (fix existing data)
    if (path === '/api/migrate-models' && method === 'POST') {
        return handleMigrateModels(env);
    }

    return jsonResponse({ success: false, error: 'Not Found' }, 404);
}

async function handleMigrateModels(env: Env): Promise<Response> {
    try {
        const { extractModelFromSubject } = await import('./services/olx-fetcher');

        // Fetch all alerts
        const { results: alerts } = await env.DB.prepare('SELECT id, subject, model FROM alerts').all<Alert>();

        let updated = 0;
        const stmt = env.DB.prepare('UPDATE alerts SET model = ? WHERE id = ?');

        // Process in batches if possible, but simplest is sequential here for safety
        for (const alert of alerts) {
            if (alert.subject) {
                const newModel = extractModelFromSubject(alert.subject);
                if (newModel && newModel !== alert.model) {
                    await stmt.bind(newModel, alert.id).run();
                    updated++;
                }
            }
        }

        return jsonResponse({ success: true, data: { updated, total: alerts.length } });
    } catch (error) {
        return jsonResponse({ success: false, error: String(error) }, 500);
    }
}

// Scan all searches
async function handleScanAll(env: Env): Promise<Response> {
    try {
        const { scanSearch } = await import('./services/diff-engine');

        const { results } = await env.DB.prepare(
            'SELECT * FROM saved_searches'
        ).all<SavedSearchRow>();

        const scanResults = [];
        for (const search of results) {
            try {
                const result = await scanSearch(env, search);
                scanResults.push({
                    searchId: search.id,
                    searchName: search.name,
                    ...result,
                });
            } catch (error) {
                console.error(`Error scanning ${search.name}:`, error);
                scanResults.push({
                    searchId: search.id,
                    searchName: search.name,
                    error: String(error),
                });
            }
        }

        return jsonResponse({ success: true, data: scanResults });
    } catch (error) {
        return jsonResponse({ success: false, error: String(error) }, 500);
    }
}

// Scan a specific search
async function handleScanOne(id: string, env: Env): Promise<Response> {
    try {
        const { scanSearch } = await import('./services/diff-engine');

        const { results } = await env.DB.prepare(
            'SELECT * FROM saved_searches WHERE id = ?'
        ).bind(id).all<SavedSearchRow>();

        if (results.length === 0) {
            return jsonResponse({ success: false, error: 'Search not found' }, 404);
        }

        const search = results[0];
        const result = await scanSearch(env, search);

        return jsonResponse({
            success: true,
            data: {
                searchId: search.id,
                searchName: search.name,
                newCount: result.newCount,
                totalScanned: result.totalScanned,
                newAds: result.alerts.map(a => ({
                    list_id: a.list_id,
                    subject: a.subject,
                    price: a.price,
                    ad_url: a.ad_url,
                })),
            },
        });
    } catch (error) {
        return jsonResponse({ success: false, error: String(error) }, 500);
    }
}

// Scheduled handler for periodic scanning
async function handleScheduled(env: Env): Promise<void> {
    console.log('Scheduled scan triggered at', new Date().toISOString());

    try {
        const { scanSearch } = await import('./services/diff-engine');

        const { results } = await env.DB.prepare(
            'SELECT * FROM saved_searches'
        ).all<SavedSearchRow>();

        console.log(`Found ${results.length} searches to scan`);

        for (const search of results) {
            try {
                const result = await scanSearch(env, search);
                console.log(`Scanned ${search.name}: ${result.newCount} new listings`);
            } catch (error) {
                console.error(`Error scanning ${search.name}:`, error);
            }
        }
    } catch (error) {
        console.error('Scheduled scan error:', error);
    }
}

// Worker exports
export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        return handleRequest(request, env);
    },

    async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
        ctx.waitUntil(handleScheduled(env));
    },
};
