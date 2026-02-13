// Stale Tracker - Find bookmarks not accessed in X days

import { getAllBookmarks } from './bookmark-manager.js';

// Special URL schemes to skip
const SPECIAL_SCHEMES = ['chrome:', 'chrome-extension:', 'javascript:', 'data:', 'file:', 'about:', 'blob:'];

export async function findStaleBookmarks(days, progressCallback) {
    const bookmarks = await getAllBookmarks();
    const staleBookmarks = [];
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);

    let processed = 0;
    const total = bookmarks.length;

    // Process in batches to avoid overwhelming the history API
    const batchSize = 10;

    for (let i = 0; i < bookmarks.length; i += batchSize) {
        const batch = bookmarks.slice(i, i + batchSize);

        await Promise.all(batch.map(async (bookmark) => {
            // Skip special URLs
            if (SPECIAL_SCHEMES.some(scheme => bookmark.url.startsWith(scheme))) {
                return;
            }

            try {
                // Query history for this URL
                const visits = await chrome.history.search({
                    text: bookmark.url,
                    startTime: 0,
                    maxResults: 1
                });

                // Check if URL was found and when it was last visited
                const historyItem = visits.find(v => v.url === bookmark.url);

                if (!historyItem || !historyItem.lastVisitTime) {
                    // Never visited (or history cleared) - consider stale
                    staleBookmarks.push({
                        id: bookmark.id,
                        title: bookmark.title,
                        url: bookmark.url,
                        daysSinceAccess: days + '+' // Unknown, at least the threshold
                    });
                } else if (historyItem.lastVisitTime < cutoff) {
                    // Last visited before cutoff
                    const daysSince = Math.floor((Date.now() - historyItem.lastVisitTime) / (24 * 60 * 60 * 1000));
                    staleBookmarks.push({
                        id: bookmark.id,
                        title: bookmark.title,
                        url: bookmark.url,
                        daysSinceAccess: daysSince
                    });
                }
            } catch (error) {
                console.error(`Failed to check history for ${bookmark.url}:`, error);
            }
        }));

        processed = Math.min(i + batchSize, total);
        progressCallback(processed, total);

        // Small delay between batches
        if (i + batchSize < bookmarks.length) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }

    // Sort by days since access (most stale first)
    staleBookmarks.sort((a, b) => {
        const aDays = typeof a.daysSinceAccess === 'number' ? a.daysSinceAccess : Infinity;
        const bDays = typeof b.daysSinceAccess === 'number' ? b.daysSinceAccess : Infinity;
        return bDays - aDays;
    });

    return staleBookmarks;
}
