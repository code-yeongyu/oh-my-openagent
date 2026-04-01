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
        
        // Literal replacements to fix broken regex and remaining system-directive tags in tests
        content = content.replace(/\/---\[\\s\\S\]\*\?<\/[a-z-]+>/gi, '/---[\\s\\S]*?---/');
        content = content.replace(/<\/system-directive>/g, '---');
        content = content.replace(/<system-directive>/g, '---');
        
        if (content !== original) {
            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`Updated ${filePath}`);
        }
    }
});
