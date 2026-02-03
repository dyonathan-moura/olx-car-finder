// Type definitions for OLX Car Finder

export interface Env {
    DB: D1Database;
    API_TOKEN: string;
}

export interface SavedSearch {
    id: string;
    name: string;
    human_url: string;
    check_period_minutes: number;
    model_whitelist: string[];
    model_blacklist: string[];
    last_checked_at: string | null;
    last_sp_scanned: number;
    created_at: string;
    updated_at: string;
}

export interface SavedSearchRow {
    id: string;
    name: string;
    human_url: string;
    check_period_minutes: number;
    model_whitelist: string;  // JSON string
    model_blacklist: string;  // JSON string
    last_checked_at: string | null;
    last_sp_scanned: number;
    created_at: string;
    updated_at: string;
}

export interface SeenId {
    id: number;
    search_id: string;
    list_id: string;
    first_seen_at: string;
}

export interface ExecutionLog {
    id: number;
    search_id: string;
    sp_min: number;
    sp_max: number;
    listings_count: number;
    new_listings_count: number;
    first_list_id: string | null;
    stop_reason: 'completed' | 'limit' | 'loop' | 'error' | 'empty' | 'budget';
    duration_ms: number;
    requests_count: number;
    error_message?: string;
    created_at: string;
}

export interface Alert {
    id: number;
    search_id: string;
    list_id: string;
    subject: string | null;
    price: string | null;
    municipality: string | null;
    neighbourhood: string | null;
    ad_url: string;
    model: string | null;
    thumbnail_url: string | null;
    mileage: number | null;
    status: 'new' | 'seen' | 'opened' | 'muted' | 'favorite';
    created_at: string;
    explanation?: string; // New: Explanation for ranking/opportunity
    badges?: string[];    // New: Visual badges (e.g., "Oportunidade", "KM Baixo")
}

export interface Listing {
    list_id: string;
    search_id: string;
    subject: string | null;
    price: string | null;
    municipality: string | null;
    neighbourhood: string | null;
    ad_url: string;
    brand: string | null;
    model: string | null;
    date_ts: string | null;
    thumbnail_url: string | null;
    mileage: number | null;
    collected_at: string;
}

// OLX API response types
export interface OlxAdProperty {
    name?: string;   // e.g., 'vehicle_brand', 'vehicle_model', 'regdate', 'mileage'
    label: string;   // Display label
    value: string;   // The actual value
}

export interface OlxAd {
    listId: number;
    subject: string;
    url: string;
    price?: string;
    location?: {
        municipality?: string;
        neighbourhood?: string;
    };
    properties?: OlxAdProperty[];
    thumbnail?: string;
    images?: Array<{
        original: string;
        originalWebp: string;
        thumbnail?: string;
    }>;
    date?: string;
}

export interface OlxSearchResponse {
    pageProps?: {
        ads?: OlxAd[];
    };
}

// API request/response types
export interface CreateSearchRequest {
    name: string;
    human_url: string;
    check_period_minutes?: number;
}

export interface UpdateSearchRequest {
    name?: string;
    check_period_minutes?: number;
    model_whitelist?: string[];
    model_blacklist?: string[];
}

export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
}
