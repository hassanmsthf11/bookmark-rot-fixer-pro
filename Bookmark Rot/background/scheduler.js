// Scheduler - Auto scan bookmarks on schedule

const ALARM_NAME = 'bookmark-rot-scheduled-scan';

export async function setupScheduledScan(intervalDays) {
    // Clear existing alarm
    await chrome.alarms.clear(ALARM_NAME);

    if (intervalDays > 0) {
        // Create new alarm
        chrome.alarms.create(ALARM_NAME, {
            delayInMinutes: 1, // First run after 1 minute
            periodInMinutes: intervalDays * 24 * 60
        });

        // Save setting
        await chrome.storage.local.set({ scheduledScanInterval: intervalDays });
    } else {
        await chrome.storage.local.remove('scheduledScanInterval');
    }
}

export async function getScheduleSettings() {
    const { scheduledScanInterval, lastScheduledScan } = await chrome.storage.local.get([
        'scheduledScanInterval',
        'lastScheduledScan'
    ]);

    return {
        intervalDays: scheduledScanInterval || 0,
        lastScan: lastScheduledScan || null
    };
}

export async function recordScheduledScan(results) {
    await chrome.storage.local.set({
        lastScheduledScan: {
            timestamp: Date.now(),
            fixed: results.fixed.length,
            broken: results.broken.length,
            unchanged: results.unchanged
        }
    });
}

// Update badge with issue count
export async function updateBadge(issueCount) {
    if (issueCount > 0) {
        await chrome.action.setBadgeText({ text: String(issueCount) });
        await chrome.action.setBadgeBackgroundColor({ color: '#ef4444' }); // Red
    } else {
        await chrome.action.setBadgeText({ text: '' });
    }
}

// Initialize alarms on extension load
export async function initScheduler() {
    const { scheduledScanInterval } = await chrome.storage.local.get('scheduledScanInterval');

    if (scheduledScanInterval && scheduledScanInterval > 0) {
        const alarm = await chrome.alarms.get(ALARM_NAME);

        if (!alarm) {
            // Recreate alarm if it doesn't exist
            chrome.alarms.create(ALARM_NAME, {
                periodInMinutes: scheduledScanInterval * 24 * 60
            });
        }
    }
}

export { ALARM_NAME };
