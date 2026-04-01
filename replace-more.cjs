const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
    fs.readdirSync(dir).forEach(f => {
        let dirPath = path.join(dir, f);
        let isDirectory = fs.statSync(dirPath).isDirectory();
        isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
    });
}

walkDir('./src', function(filePath) {
    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx') || filePath.endsWith('.md')) {
        let content = fs.readFileSync(filePath, 'utf8');
        let original = content;
        
        // Literal replacements
        content = content.replace(/system-reminder-templates/g, 'system-directive-templates');
        content = content.replace(/system-reminder/gi, 'system-directive');
        content = content.replace(/<system-directive>/g, '---');
        content = content.replace(/<\/system-directive>/g, '---');
        content = content.replace(/---[\s\S]*?<\/system-directive>/gi, '---[\s\S]*?---');
        
        if (content !== original) {
            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`Updated ${filePath}`);
        }
    }
});
