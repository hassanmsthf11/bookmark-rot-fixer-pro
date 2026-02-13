// Backup Manager - Backup and restore bookmarks

const BACKUP_KEY = 'bookmark_backups';
const MAX_BACKUPS = 5;

// Create a full backup of all bookmarks
export async function createBackup(label = 'Manual backup') {
    const tree = await chrome.bookmarks.getTree();

    const backup = {
        id: Date.now().toString(),
        label,
        timestamp: Date.now(),
        date: new Date().toISOString(),
        bookmarkCount: countBookmarks(tree),
        data: tree
    };

    // Get existing backups
    const { [BACKUP_KEY]: backups = [] } = await chrome.storage.local.get(BACKUP_KEY);

    // Add new backup at the beginning
    backups.unshift(backup);

    // Keep only last N backups
    while (backups.length > MAX_BACKUPS) {
        backups.pop();
    }

    await chrome.storage.local.set({ [BACKUP_KEY]: backups });

    return backup;
}

// Get all backups
export async function getBackups() {
    const { [BACKUP_KEY]: backups = [] } = await chrome.storage.local.get(BACKUP_KEY);
    return backups.map(b => ({
        id: b.id,
        label: b.label,
        date: b.date,
        bookmarkCount: b.bookmarkCount
    }));
}

// Restore from a backup
export async function restoreBackup(backupId) {
    const { [BACKUP_KEY]: backups = [] } = await chrome.storage.local.get(BACKUP_KEY);
    const backup = backups.find(b => b.id === backupId);

    if (!backup) {
        throw new Error('Backup not found');
    }

    // Create a backup before restoring (safety net)
    await createBackup('Auto-backup before restore');

    // Get current bookmarks bar and other bookmarks
    const currentTree = await chrome.bookmarks.getTree();
    const root = currentTree[0];

    // Delete all existing bookmarks (except root folders)
    for (const rootFolder of root.children) {
        if (rootFolder.children) {
            for (const child of [...rootFolder.children]) {
                try {
                    if (child.children) {
                        await chrome.bookmarks.removeTree(child.id);
                    } else {
                        await chrome.bookmarks.remove(child.id);
                    }
                } catch (e) {
                    console.error('Error removing bookmark:', e);
                }
            }
        }
    }

    // Restore bookmarks from backup
    const backupRoot = backup.data[0];

    for (let i = 0; i < backupRoot.children.length; i++) {
        const backupFolder = backupRoot.children[i];
        const targetFolder = root.children[i];

        if (backupFolder.children && targetFolder) {
            await restoreChildren(backupFolder.children, targetFolder.id);
        }
    }

    return { restored: backup.bookmarkCount };
}

async function restoreChildren(children, parentId) {
    for (const child of children) {
        try {
            if (child.url) {
                // It's a bookmark
                await chrome.bookmarks.create({
                    parentId,
                    title: child.title,
                    url: child.url
                });
            } else if (child.children) {
                // It's a folder
                const newFolder = await chrome.bookmarks.create({
                    parentId,
                    title: child.title
                });
                await restoreChildren(child.children, newFolder.id);
            }
        } catch (e) {
            console.error('Error restoring bookmark:', e);
        }
    }
}

// Delete a backup
export async function deleteBackup(backupId) {
    const { [BACKUP_KEY]: backups = [] } = await chrome.storage.local.get(BACKUP_KEY);
    const filtered = backups.filter(b => b.id !== backupId);
    await chrome.storage.local.set({ [BACKUP_KEY]: filtered });
}

// Count bookmarks in tree
function countBookmarks(tree) {
    let count = 0;

    function traverse(nodes) {
        for (const node of nodes) {
            if (node.url) count++;
            if (node.children) traverse(node.children);
        }
    }

    traverse(tree);
    return count;
}

// Export backup as JSON file
export function exportBackupAsFile(backup) {
    return JSON.stringify(backup, null, 2);
}
