// Service Worker - Main orchestration

import { getAllBookmarks, getBookmarksInFolder, updateBookmark, moveToFolder, getOrCreateBrokenFolder, deleteBookmarks } from './bookmark-manager.js';
import { checkUrl } from './url-checker.js';
import { findStaleBookmarks } from './stale-tracker.js';
import { findDuplicates, deleteDuplicates } from './duplicate-finder.js';
import { findEmptyFolders, deleteEmptyFolders } from './folder-cleanup.js';
import { findBadTitles, fetchAndFixTitles } from './title-fixer.js';
import { exportToCSV, exportToJSON, downloadFile } from './export-manager.js';
import { initScheduler, setupScheduledScan, getScheduleSettings, recordScheduledScan, updateBadge, ALARM_NAME } from './scheduler.js';
import { createBackup, getBackups, restoreBackup, deleteBackup } from './backup-manager.js';
import { findArchivedVersions, replaceWithArchived } from './wayback-integration.js';
import { quickFixAll, getIssueSummary } from './quick-fix.js';

// Special URL schemes to skip
const SPECIAL_SCHEMES = ['chrome:', 'chrome-extension:', 'javascript:', 'data:', 'file:', 'about:', 'blob:'];

// Initialize scheduler on load
initScheduler();

// Get settings
async function getSettings() {
    const { settings } = await chrome.storage.local.get('settings');
    return {
        skipSpecialUrls: true,
        autoCreateBrokenFolder: true,
        concurrentRequests: 5,
        ...settings
    };
}

// Check if URL should be skipped
function shouldSkipUrl(url, skipSpecial) {
    if (!url) return true;
    if (skipSpecial && SPECIAL_SCHEMES.some(scheme => url.startsWith(scheme))) return true;
    return false;
}

// Process bookmarks in batches
async function processBatch(bookmarks, concurrency, progressCallback) {
    const results = { fixed: [], broken: [], unchanged: 0 };
    const settings = await getSettings();
    let brokenFolderId = null;

    if (settings.autoCreateBrokenFolder) {
        brokenFolderId = await getOrCreateBrokenFolder();
    }

    let processed = 0;
    const total = bookmarks.length;

    for (let i = 0; i < bookmarks.length; i += concurrency) {
        const batch = bookmarks.slice(i, i + concurrency);

        const batchResults = await Promise.all(batch.map(async (bookmark) => {
            try {
                const result = await checkUrl(bookmark.url);

                if (result.error || result.statusCode >= 400) {
                    if (brokenFolderId) {
                        await moveToFolder(bookmark.id, brokenFolderId);
                    }
                    return { type: 'broken', bookmark, error: result.error || `HTTP ${result.statusCode}` };
                }

                if (result.finalUrl && result.finalUrl !== bookmark.url) {
                    await updateBookmark(bookmark.id, result.finalUrl);
                    return { type: 'fixed', bookmark, newUrl: result.finalUrl };
                }

                return { type: 'unchanged' };
            } catch (error) {
                if (brokenFolderId) {
                    await moveToFolder(bookmark.id, brokenFolderId);
                }
                return { type: 'broken', bookmark, error: error.message };
            }
        }));

        for (const result of batchResults) {
            if (result.type === 'fixed') {
                results.fixed.push({
                    title: result.bookmark.title,
                    oldUrl: result.bookmark.url,
                    newUrl: result.newUrl
                });
            } else if (result.type === 'broken') {
                results.broken.push({
                    title: result.bookmark.title,
                    url: result.bookmark.url,
                    error: result.error
                });
            } else {
                results.unchanged++;
            }
        }

        processed += batch.length;
        progressCallback(processed, total);

        if (i + concurrency < bookmarks.length) {
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }

    return results;
}

// Handle scheduled scan
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === ALARM_NAME) {
        console.log('Running scheduled bookmark scan...');

        const settings = await getSettings();
        let bookmarks = await getAllBookmarks();
        bookmarks = bookmarks.filter(b => b.url && !shouldSkipUrl(b.url, settings.skipSpecialUrls));

        const results = await processBatch(
            bookmarks,
            settings.concurrentRequests,
            () => { } // No progress callback for background scan
        );

        await recordScheduledScan(results);

        // Update badge with issues found
        const issueCount = results.fixed.length + results.broken.length;
        await updateBadge(issueCount);

        console.log(`Scheduled scan complete: ${results.fixed.length} fixed, ${results.broken.length} broken`);
    }
});

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const handlers = {
        'START_SCAN': () => handleScan(message.folderId),
        'FIND_STALE': () => handleFindStale(message.days),
        'DELETE_BOOKMARKS': () => handleDeleteBookmarks(message.ids),
        'FIND_DUPLICATES': () => handleFindDuplicates(),
        'DELETE_DUPLICATES': () => handleDeleteDuplicates(message.groups),
        'FIND_EMPTY_FOLDERS': () => handleFindEmptyFolders(),
        'DELETE_EMPTY_FOLDERS': () => handleDeleteEmptyFolders(message.ids),
        'FIND_BAD_TITLES': () => handleFindBadTitles(),
        'FIX_TITLES': () => handleFixTitles(message.bookmarks),
        'EXPORT': () => handleExport(message.data, message.dataType, message.format),
        'GET_SCHEDULE': () => getScheduleSettings(),
        'SET_SCHEDULE': () => handleSetSchedule(message.days),
        'CLEAR_BADGE': () => updateBadge(0),
        // Backup handlers
        'CREATE_BACKUP': () => handleCreateBackup(message.label),
        'GET_BACKUPS': () => handleGetBackups(),
        'RESTORE_BACKUP': () => handleRestoreBackup(message.backupId),
        'DELETE_BACKUP': () => handleDeleteBackup(message.backupId),
        // Wayback handlers
        'FIND_ARCHIVED': () => handleFindArchived(message.brokenBookmarks),
        'REPLACE_WITH_ARCHIVED': () => handleReplaceWithArchived(message.bookmarkId, message.archivedUrl),
        // Quick fix handlers
        'QUICK_FIX': () => handleQuickFix(),
        'GET_ISSUE_SUMMARY': () => handleGetIssueSummary()
    };

    const handler = handlers[message.type];
    if (handler) {
        handler().then(sendResponse);
        return true;
    }
});

async function handleScan(folderId) {
    try {
        const settings = await getSettings();

        let bookmarks;
        if (folderId) {
            bookmarks = await getBookmarksInFolder(folderId);
        } else {
            bookmarks = await getAllBookmarks();
        }

        bookmarks = bookmarks.filter(b => b.url && !shouldSkipUrl(b.url, settings.skipSpecialUrls));

        const results = await processBatch(
            bookmarks,
            settings.concurrentRequests,
            (current, total) => {
                chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', current, total }).catch(() => { });
            }
        );

        return { success: true, results };
    } catch (error) {
        console.error('Scan error:', error);
        return { success: false, error: error.message };
    }
}

async function handleFindStale(days) {
    try {
        const staleBookmarks = await findStaleBookmarks(days, (current, total) => {
            chrome.runtime.sendMessage({ type: 'STALE_PROGRESS', current, total }).catch(() => { });
        });

        return { success: true, staleBookmarks };
    } catch (error) {
        console.error('Stale check error:', error);
        return { success: false, error: error.message };
    }
}

async function handleDeleteBookmarks(ids) {
    try {
        await deleteBookmarks(ids);
        return { success: true };
    } catch (error) {
        console.error('Delete error:', error);
        return { success: false, error: error.message };
    }
}

async function handleFindDuplicates() {
    try {
        const duplicates = await findDuplicates((current, total) => {
            chrome.runtime.sendMessage({ type: 'DUPLICATE_PROGRESS', current, total }).catch(() => { });
        });

        return { success: true, duplicates };
    } catch (error) {
        console.error('Duplicate finder error:', error);
        return { success: false, error: error.message };
    }
}

async function handleDeleteDuplicates(groups) {
    try {
        const deleted = await deleteDuplicates(groups);
        return { success: true, deleted };
    } catch (error) {
        console.error('Delete duplicates error:', error);
        return { success: false, error: error.message };
    }
}

async function handleFindEmptyFolders() {
    try {
        const folders = await findEmptyFolders();
        return { success: true, folders };
    } catch (error) {
        console.error('Find empty folders error:', error);
        return { success: false, error: error.message };
    }
}

async function handleDeleteEmptyFolders(ids) {
    try {
        const deleted = await deleteEmptyFolders(ids);
        return { success: true, deleted };
    } catch (error) {
        console.error('Delete folders error:', error);
        return { success: false, error: error.message };
    }
}

async function handleFindBadTitles() {
    try {
        const badTitles = await findBadTitles((current, total) => {
            chrome.runtime.sendMessage({ type: 'TITLE_PROGRESS', current, total }).catch(() => { });
        });

        return { success: true, badTitles };
    } catch (error) {
        console.error('Find bad titles error:', error);
        return { success: false, error: error.message };
    }
}

async function handleFixTitles(bookmarks) {
    try {
        const results = await fetchAndFixTitles(bookmarks, (current, total) => {
            chrome.runtime.sendMessage({ type: 'TITLE_FIX_PROGRESS', current, total }).catch(() => { });
        });

        return { success: true, results };
    } catch (error) {
        console.error('Fix titles error:', error);
        return { success: false, error: error.message };
    }
}

async function handleExport(data, dataType, format) {
    try {
        const timestamp = new Date().toISOString().split('T')[0];
        let content, filename, mimeType;

        if (format === 'csv') {
            content = exportToCSV(data, dataType);
            filename = `bookmark-rot-${dataType}-${timestamp}.csv`;
            mimeType = 'text/csv';
        } else {
            content = exportToJSON(data, dataType);
            filename = `bookmark-rot-${dataType}-${timestamp}.json`;
            mimeType = 'application/json';
        }

        downloadFile(content, filename, mimeType);
        return { success: true };
    } catch (error) {
        console.error('Export error:', error);
        return { success: false, error: error.message };
    }
}

async function handleSetSchedule(days) {
    try {
        await setupScheduledScan(days);
        return { success: true };
    } catch (error) {
        console.error('Schedule error:', error);
        return { success: false, error: error.message };
    }
}

// Backup handlers
async function handleCreateBackup(label) {
    try {
        const backup = await createBackup(label || 'Manual backup');
        return { success: true, backup };
    } catch (error) {
        console.error('Create backup error:', error);
        return { success: false, error: error.message };
    }
}

async function handleGetBackups() {
    try {
        const backups = await getBackups();
        return { success: true, backups };
    } catch (error) {
        console.error('Get backups error:', error);
        return { success: false, error: error.message };
    }
}

async function handleRestoreBackup(backupId) {
    try {
        const result = await restoreBackup(backupId);
        return { success: true, ...result };
    } catch (error) {
        console.error('Restore backup error:', error);
        return { success: false, error: error.message };
    }
}

async function handleDeleteBackup(backupId) {
    try {
        await deleteBackup(backupId);
        return { success: true };
    } catch (error) {
        console.error('Delete backup error:', error);
        return { success: false, error: error.message };
    }
}

// Wayback handlers
async function handleFindArchived(brokenBookmarks) {
    try {
        const results = await findArchivedVersions(brokenBookmarks, (current, total) => {
            chrome.runtime.sendMessage({ type: 'WAYBACK_PROGRESS', current, total }).catch(() => { });
        });
        return { success: true, results };
    } catch (error) {
        console.error('Find archived error:', error);
        return { success: false, error: error.message };
    }
}

async function handleReplaceWithArchived(bookmarkId, archivedUrl) {
    try {
        await replaceWithArchived(bookmarkId, archivedUrl);
        return { success: true };
    } catch (error) {
        console.error('Replace with archived error:', error);
        return { success: false, error: error.message };
    }
}

// Quick fix handlers
async function handleQuickFix() {
    try {
        const results = await quickFixAll((status, step, total) => {
            chrome.runtime.sendMessage({ type: 'QUICK_FIX_PROGRESS', status, step, total }).catch(() => { });
        });
        return { success: true, results };
    } catch (error) {
        console.error('Quick fix error:', error);
        return { success: false, error: error.message };
    }
}

async function handleGetIssueSummary() {
    try {
        const summary = await getIssueSummary();
        return { success: true, summary };
    } catch (error) {
        console.error('Get issue summary error:', error);
        return { success: false, error: error.message };
    }
}

console.log('Bookmark Rot Fixer Pro service worker loaded');
