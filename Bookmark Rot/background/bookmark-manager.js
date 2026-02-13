// Bookmark Manager - CRUD operations for bookmarks

const BROKEN_FOLDER_NAME = '🔴 Broken Links';

// Get all bookmarks recursively
export async function getAllBookmarks() {
    const tree = await chrome.bookmarks.getTree();
    const bookmarks = [];

    function traverse(nodes) {
        for (const node of nodes) {
            if (node.url) {
                bookmarks.push(node);
            }
            if (node.children) {
                traverse(node.children);
            }
        }
    }

    traverse(tree);
    return bookmarks;
}

// Get bookmarks in a specific folder (recursive)
export async function getBookmarksInFolder(folderId) {
    const subTree = await chrome.bookmarks.getSubTree(folderId);
    const bookmarks = [];

    function traverse(nodes) {
        for (const node of nodes) {
            if (node.url) {
                bookmarks.push(node);
            }
            if (node.children) {
                traverse(node.children);
            }
        }
    }

    traverse(subTree);
    return bookmarks;
}

// Update a bookmark's URL
export async function updateBookmark(id, newUrl) {
    await chrome.bookmarks.update(id, { url: newUrl });
}

// Move bookmark to a folder
export async function moveToFolder(bookmarkId, folderId) {
    await chrome.bookmarks.move(bookmarkId, { parentId: folderId });
}

// Get or create the "Broken Links" folder
export async function getOrCreateBrokenFolder() {
    const tree = await chrome.bookmarks.getTree();
    const bookmarksBar = tree[0].children.find(c => c.id === '1') || tree[0].children[0];

    // Check if folder already exists
    if (bookmarksBar.children) {
        const existing = bookmarksBar.children.find(c => c.title === BROKEN_FOLDER_NAME && !c.url);
        if (existing) {
            return existing.id;
        }
    }

    // Create folder
    const folder = await chrome.bookmarks.create({
        parentId: bookmarksBar.id,
        title: BROKEN_FOLDER_NAME
    });

    return folder.id;
}

// Delete multiple bookmarks
export async function deleteBookmarks(ids) {
    for (const id of ids) {
        try {
            await chrome.bookmarks.remove(id);
        } catch (error) {
            console.error(`Failed to delete bookmark ${id}:`, error);
        }
    }
}

// Get all folders (for folder picker)
export async function getAllFolders() {
    const tree = await chrome.bookmarks.getTree();
    const folders = [];

    function traverse(nodes, depth = 0) {
        for (const node of nodes) {
            if (node.children) {
                folders.push({
                    id: node.id,
                    title: node.title || 'Root',
                    depth
                });
                traverse(node.children, depth + 1);
            }
        }
    }

    traverse(tree);
    return folders;
}
