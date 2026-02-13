// Export Manager - Export scan results and bookmark data

export function exportToCSV(data, type) {
    let csv = '';

    switch (type) {
        case 'scan':
            csv = 'Status,Title,Original URL,New URL,Error\n';
            for (const item of data.fixed) {
                csv += `Fixed,"${escapeCSV(item.title)}","${escapeCSV(item.oldUrl)}","${escapeCSV(item.newUrl)}",\n`;
            }
            for (const item of data.broken) {
                csv += `Broken,"${escapeCSV(item.title)}","${escapeCSV(item.url)}",,"${escapeCSV(item.error || '')}"\n`;
            }
            break;

        case 'duplicates':
            csv = 'URL,Count,Bookmark Titles\n';
            for (const group of data) {
                const titles = group.bookmarks.map(b => b.title).join(' | ');
                csv += `"${escapeCSV(group.url)}",${group.count},"${escapeCSV(titles)}"\n`;
            }
            break;

        case 'stale':
            csv = 'Title,URL,Days Since Access\n';
            for (const item of data) {
                csv += `"${escapeCSV(item.title)}","${escapeCSV(item.url)}",${item.daysSinceAccess}\n`;
            }
            break;

        case 'titles':
            csv = 'Status,Old Title,New Title,URL\n';
            for (const item of data.fixed) {
                csv += `Fixed,"${escapeCSV(item.oldTitle)}","${escapeCSV(item.newTitle)}","${escapeCSV(item.url)}"\n`;
            }
            for (const item of data.failed) {
                csv += `Failed,"${escapeCSV(item.title)}",,"${escapeCSV(item.url)}"\n`;
            }
            break;
    }

    return csv;
}

export function exportToJSON(data, type) {
    return JSON.stringify({
        type,
        exportedAt: new Date().toISOString(),
        data
    }, null, 2);
}

function escapeCSV(str) {
    if (!str) return '';
    return str.replace(/"/g, '""');
}

export function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);

    chrome.downloads.download({
        url,
        filename,
        saveAs: true
    });
}
