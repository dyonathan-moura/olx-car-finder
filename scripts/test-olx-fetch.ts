// Script to test OLX data fetching and see properties
// Run with: npx tsx scripts/test-olx-fetch.ts

const OLX_BASE_URL = 'https://www.olx.com.br';

async function extractBuildId(): Promise<string> {
    const response = await fetch(`${OLX_BASE_URL}/autos-e-pecas/carros-vans-e-utilitarios/estado-rs`, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    });
    const html = await response.text();
    const match = html.match(/"buildId":"([^"]+)"/);
    if (!match) throw new Error('Could not find buildId');
    return match[1];
}

async function fetchOlxPage(buildId: string) {
    const url = `${OLX_BASE_URL}/_next/data/${buildId}/autos-e-pecas/carros-vans-e-utilitarios/estado-rs.json?ps=20000&pe=35000`;
    console.log('Fetching:', url);

    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
        }
    });

    if (!response.ok) {
        console.error('Failed:', response.status, response.statusText);
        return;
    }

    const data = await response.json();
    const ads = data?.pageProps?.ads || [];

    console.log('\n=== FOUND', ads.length, 'ADS ===\n');

    // Show first 3 ads with all their properties
    for (let i = 0; i < Math.min(3, ads.length); i++) {
        const ad = ads[i];
        console.log(`\n--- AD ${i + 1}: ${ad.subject} ---`);
        console.log('Price:', ad.price);
        console.log('URL:', ad.url);
        console.log('\nPROPERTIES:');
        if (ad.properties) {
            ad.properties.forEach((p: any) => {
                console.log(`  ${p.label}: ${p.value}`);
            });
        } else {
            console.log('  (no properties)');
        }
        console.log('\nALL KEYS:', Object.keys(ad));
    }
}

async function main() {
    try {
        console.log('Extracting buildId...');
        const buildId = await extractBuildId();
        console.log('BuildId:', buildId);
        await fetchOlxPage(buildId);
    } catch (error) {
        console.error('Error:', error);
    }
}

main();
