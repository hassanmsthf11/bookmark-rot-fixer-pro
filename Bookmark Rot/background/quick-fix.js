// Quick Fix - One-click fix all issues

import { getAllBookmarks, getOrCreateBrokenFolder, moveToFolder, updateBookmark } from './bookmark-manager.js';
import { checkUrl } from './url-checker.js';
import { findDuplicates, deleteDuplicates } from './duplicate-finder.js';
import { findEmptyFolders, deleteEmptyFolders } from './folder-cleanup.js';
import { createBackup } from './backup-manager.js';

const SPECIAL_SCHEMES = ['chrome:', 'chrome-extension:', 'javascript:', 'data:', 'file:', 'about:', 'blob:'];

export async function quickFixAll(progressCallback) {
    const results = {
        backupCreated: false,
        redirectsFixed: 0,
        brokenMoved: 0,
        duplicatesDeleted: 0,
        emptyFoldersDeleted: 0,
        errors: []
    };

    try {
        // Step 1: Create backup first
        progressCallback('Creating backup...', 0, 4);
        await createBackup('Auto-backup before Quick Fix');
        results.backupCreated = true;

        // Step 2: Fix redirects and handle broken links
        progressCallback('Fixing redirects & broken links...', 1, 4);
        const scanResults = await fixRedirectsAndBroken();
        results.redirectsFixed = scanResults.fixed;
        results.brokenMoved = scanResults.broken;

        // Step 3: Delete duplicates
        progressCallback('Removing duplicates...', 2, 4);
        const duplicates = await findDuplicates(() => { });
        if (duplicates.length > 0) {
            results.duplicatesDeleted = await deleteDuplicates(duplicates, true);
        }

        // Step 4: Clean empty folders
        progressCallback('Cleaning empty folders...', 3, 4);
        const emptyFolders = await findEmptyFolders();
        if (emptyFolders.length > 0) {
            results.emptyFoldersDeleted = await deleteEmptyFolders(emptyFolders.map(f => f.id));
        }

        progressCallback('Complete!', 4, 4);

    } catch (error) {
        results.errors.push(error.message);
    }

    return results;
}

async function fixRedirectsAndBroken() {
    const bookmarks = await getAllBookmarks();
    const brokenFolderId = await getOrCreateBrokenFolder();

    let fixed = 0;
    let broken = 0;

    // Filter valid URLs
    const validBookmarks = bookmarks.filter(b =>
        b.url && !SPECIAL_SCHEMES.some(s => b.url.startsWith(s))
    );

    // Process in batches
    const batchSize = 5;

    for (let i = 0; i < validBookmarks.length; i += batchSize) {
        const batch = validBookmarks.slice(i, i + batchSize);

        await Promise.all(batch.map(async (bookmark) => {
            try {
                const result = await checkUrl(bookmark.url);

                if (result.error || result.statusCode >= 400) {
                    // Broken - move to folder
                    await moveToFolder(bookmark.id, brokenFolderId);
                    broken++;
                } else if (result.finalUrl && result.finalUrl !== bookmark.url) {
                    // Redirect - update URL
                    await updateBookmark(bookmark.id, result.finalUrl);
                    fixed++;
                }
            } catch (error) {
                // Network error - treat as broken
                try {
                    await moveToFolder(bookmark.id, brokenFolderId);
                    broken++;
                } catch { }
            }
        }));

        // Delay between batches
        if (i + batchSize < validBookmarks.length) {
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }

    return { fixed, broken };
}

// Get summary of issues without fixing
export async function getIssueSummary() {
    const bookmarks = await getAllBookmarks();
    const duplicates = await findDuplicates(() => { });
    const emptyFolders = await findEmptyFolders();

    const duplicateCount = duplicates.reduce((sum, g) => sum + g.count - 1, 0);

    return {
        totalBookmarks: bookmarks.length,
        duplicates: duplicateCount,
        duplicateGroups: duplicates.length,
        emptyFolders: emptyFolders.length
    };
}
