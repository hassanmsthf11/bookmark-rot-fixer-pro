// Title Fixer - Fetch proper page titles for bookmarks

import { getAllBookmarks } from './bookmark-manager.js';

const TIMEOUT_MS = 8000;

export async function findBadTitles(progressCallback) {
    const bookmarks = await getAllBookmarks();
    const badTitles = [];

    const total = bookmarks.length;
    let processed = 0;

    for (const bookmark of bookmarks) {
        processed++;

        if (!bookmark.url || bookmark.url.startsWith('chrome:') ||
            bookmark.url.startsWith('javascript:') || bookmark.url.startsWith('data:')) {
            continue;
        }

        // Check for bad titles
        const isBad = isBadTitle(bookmark.title, bookmark.url);

        if (isBad) {
            badTitles.push({
                id: bookmark.id,
                title: bookmark.title,
                url: bookmark.url,
                reason: isBad
            });
        }

        if (processed % 50 === 0) {
            progressCallback(processed, total);
        }
    }

    progressCallback(total, total);
    return badTitles;
}

function isBadTitle(title, url) {
    if (!title || title.trim() === '') return 'Empty title';

    const trimmed = title.trim().toLowerCase();

    // Check for generic titles
    const genericTitles = [
        'untitled', 'new tab', 'loading', 'page', 'document',
        'home', 'index', 'welcome', '404', 'error'
    ];

    if (genericTitles.includes(trimmed)) return 'Generic title';

    // Check if title is just the URL or domain
    try {
        const parsed = new URL(url);
        if (trimmed === url.toLowerCase() ||
            trimmed === parsed.hostname.toLowerCase() ||
            trimmed === parsed.hostname.replace('www.', '').toLowerCase()) {
            return 'Title is just URL/domain';
        }
    } catch { }

    // Check for very short titles (less than 3 chars)
    if (trimmed.length < 3) return 'Too short';

    return null;
}

export async function fetchAndFixTitles(bookmarks, progressCallback) {
    const results = { fixed: [], failed: [] };
    let processed = 0;
    const total = bookmarks.length;

    // Process in batches
    const batchSize = 3;

    for (let i = 0; i < bookmarks.length; i += batchSize) {
        const batch = bookmarks.slice(i, i + batchSize);

        await Promise.all(batch.map(async (bookmark) => {
            try {
                const newTitle = await fetchPageTitle(bookmark.url);

                if (newTitle && newTitle !== bookmark.title) {
                    await chrome.bookmarks.update(bookmark.id, { title: newTitle });
                    results.fixed.push({
                        id: bookmark.id,
                        oldTitle: bookmark.title,
                        newTitle,
                        url: bookmark.url
                    });
                } else {
                    results.failed.push({
                        id: bookmark.id,
                        title: bookmark.title,
                        url: bookmark.url,
                        reason: 'Could not fetch title'
                    });
                }
            } catch (error) {
                results.failed.push({
                    id: bookmark.id,
                    title: bookmark.title,
                    url: bookmark.url,
                    reason: error.message
                });
            }
        }));

        processed = Math.min(i + batchSize, total);
        progressCallback(processed, total);

        // Delay between batches
        if (i + batchSize < bookmarks.length) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    return results;
}

async function fetchPageTitle(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            method: 'GET',
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        clearTimeout(timeoutId);

        if (!response.ok) return null;

        const html = await response.text();

        // Extract title from HTML
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch && titleMatch[1]) {
            return titleMatch[1].trim().substring(0, 200); // Limit length
        }

        // Try og:title
        const ogMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
        if (ogMatch && ogMatch[1]) {
            return ogMatch[1].trim().substring(0, 200);
        }

        return null;
    } catch (error) {
        clearTimeout(timeoutId);
        return null;
    }
}
