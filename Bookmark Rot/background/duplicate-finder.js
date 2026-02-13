// Duplicate Finder - Find bookmarks with the same URL

import { getAllBookmarks } from './bookmark-manager.js';

export async function findDuplicates(progressCallback) {
    const bookmarks = await getAllBookmarks();
    const urlMap = new Map();

    // Group bookmarks by URL
    for (const bookmark of bookmarks) {
        if (!bookmark.url) continue;

        // Normalize URL (remove trailing slash, lowercase)
        const normalizedUrl = normalizeUrl(bookmark.url);

        if (!urlMap.has(normalizedUrl)) {
            urlMap.set(normalizedUrl, []);
        }
        urlMap.get(normalizedUrl).push(bookmark);
    }

    // Find duplicates (URLs with more than one bookmark)
    const duplicates = [];
    let processed = 0;
    const total = urlMap.size;

    for (const [url, bookmarkList] of urlMap) {
        if (bookmarkList.length > 1) {
            duplicates.push({
                url,
                count: bookmarkList.length,
                bookmarks: bookmarkList.map(b => ({
                    id: b.id,
                    title: b.title,
                    parentId: b.parentId
                }))
            });
        }

        processed++;
        if (processed % 100 === 0) {
            progressCallback(processed, total);
        }
    }

    progressCallback(total, total);

    // Sort by count (most duplicates first)
    duplicates.sort((a, b) => b.count - a.count);

    return duplicates;
}

function normalizeUrl(url) {
    try {
        const parsed = new URL(url);
        // Remove trailing slash, convert to lowercase
        let normalized = parsed.origin + parsed.pathname.replace(/\/$/, '') + parsed.search;
        return normalized.toLowerCase();
    } catch {
        return url.toLowerCase();
    }
}

// Delete duplicate bookmarks, keeping the first one
export async function deleteDuplicates(duplicateGroups, keepFirst = true) {
    let deleted = 0;

    for (const group of duplicateGroups) {
        const toDelete = keepFirst ? group.bookmarks.slice(1) : group.bookmarks;

        for (const bookmark of toDelete) {
            try {
                await chrome.bookmarks.remove(bookmark.id);
                deleted++;
            } catch (error) {
                console.error(`Failed to delete duplicate ${bookmark.id}:`, error);
            }
        }
    }

    return deleted;
}
