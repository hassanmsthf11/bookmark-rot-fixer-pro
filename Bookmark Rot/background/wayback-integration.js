// Wayback Machine Integration - Find archived versions of broken URLs

const WAYBACK_API = 'https://archive.org/wayback/available';

// Check if a URL has an archived version
export async function findArchivedVersion(url) {
    try {
        const response = await fetch(`${WAYBACK_API}?url=${encodeURIComponent(url)}`);
        const data = await response.json();

        if (data.archived_snapshots && data.archived_snapshots.closest) {
            const snapshot = data.archived_snapshots.closest;
            return {
                available: true,
                url: snapshot.url,
                timestamp: snapshot.timestamp,
                date: formatWaybackDate(snapshot.timestamp)
            };
        }

        return { available: false };
    } catch (error) {
        console.error('Wayback API error:', error);
        return { available: false, error: error.message };
    }
}

// Check multiple URLs for archived versions
export async function findArchivedVersions(brokenBookmarks, progressCallback) {
    const results = [];
    const total = brokenBookmarks.length;

    for (let i = 0; i < brokenBookmarks.length; i++) {
        const bookmark = brokenBookmarks[i];

        try {
            const archived = await findArchivedVersion(bookmark.url);

            if (archived.available) {
                results.push({
                    bookmark,
                    archived
                });
            }
        } catch (error) {
            console.error(`Failed to check ${bookmark.url}:`, error);
        }

        progressCallback(i + 1, total);

        // Small delay to avoid rate limiting
        if (i < brokenBookmarks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }

    return results;
}

// Update bookmark to use archived URL
export async function replaceWithArchived(bookmarkId, archivedUrl) {
    await chrome.bookmarks.update(bookmarkId, { url: archivedUrl });
}

// Format Wayback timestamp to readable date
function formatWaybackDate(timestamp) {
    // Timestamp format: YYYYMMDDHHmmss
    const year = timestamp.substring(0, 4);
    const month = timestamp.substring(4, 6);
    const day = timestamp.substring(6, 8);
    return `${year}-${month}-${day}`;
}

// Generate Wayback Machine URL for manual viewing
export function getWaybackUrl(url) {
    return `https://web.archive.org/web/*/${url}`;
}
