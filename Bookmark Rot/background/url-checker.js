// URL Checker - Check URLs for redirects and broken links

const TIMEOUT_MS = 10000;

export async function checkUrl(url) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

        // Use HEAD request (faster, less data)
        const response = await fetch(url, {
            method: 'HEAD',
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        clearTimeout(timeoutId);

        // Some servers don't support HEAD, fallback to GET
        if (response.status === 405) {
            return await checkUrlWithGet(url);
        }

        return {
            finalUrl: response.url,
            statusCode: response.status,
            error: null
        };
    } catch (error) {
        if (error.name === 'AbortError') {
            return { error: 'Timeout', statusCode: 0, finalUrl: null };
        }

        // Network error - try GET as fallback
        try {
            return await checkUrlWithGet(url);
        } catch (e) {
            return { error: error.message, statusCode: 0, finalUrl: null };
        }
    }
}

async function checkUrlWithGet(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        clearTimeout(timeoutId);

        return {
            finalUrl: response.url,
            statusCode: response.status,
            error: null
        };
    } catch (error) {
        clearTimeout(timeoutId);
        return { error: error.message, statusCode: 0, finalUrl: null };
    }
}
