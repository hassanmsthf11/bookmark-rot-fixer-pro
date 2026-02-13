// Folder Cleanup - Find and remove empty folders

export async function findEmptyFolders() {
    const tree = await chrome.bookmarks.getTree();
    const emptyFolders = [];

    function traverse(nodes, path = []) {
        for (const node of nodes) {
            if (node.children !== undefined) {
                // It's a folder
                const currentPath = [...path, node.title || 'Root'];

                if (node.children.length === 0) {
                    // Empty folder
                    emptyFolders.push({
                        id: node.id,
                        title: node.title || 'Untitled Folder',
                        path: currentPath.join(' / ')
                    });
                } else {
                    // Check children
                    traverse(node.children, currentPath);

                    // Check if all children are empty folders (recursively empty)
                    const allChildrenEmpty = node.children.every(child =>
                        child.children !== undefined && child.children.length === 0
                    );

                    if (allChildrenEmpty && node.children.length > 0) {
                        emptyFolders.push({
                            id: node.id,
                            title: node.title || 'Untitled Folder',
                            path: currentPath.join(' / '),
                            hasEmptySubfolders: true
                        });
                    }
                }
            }
        }
    }

    traverse(tree);
    return emptyFolders;
}

export async function deleteEmptyFolders(folderIds) {
    let deleted = 0;

    // Delete in reverse order to handle nested empty folders
    for (const id of folderIds.reverse()) {
        try {
            await chrome.bookmarks.removeTree(id);
            deleted++;
        } catch (error) {
            console.error(`Failed to delete folder ${id}:`, error);
        }
    }

    return deleted;
}
