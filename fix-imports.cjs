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
        
        // Revert system-reminder in imports specifically back to system-directive
        content = content.replace(/from "\.\.?\/\.\.?\/shared\/system-reminder"/g, 'from "../../shared/system-directive"');
        content = content.replace(/from "\.\.?\/shared\/system-reminder"/g, 'from "../shared/system-directive"');
        content = content.replace(/from "\.\/system-reminder"/g, 'from "./system-directive"');
        content = content.replace(/from "\.\/system-reminder-templates"/g, 'from "./system-directive-templates"');
        
        if (content !== original) {
            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`Updated ${filePath}`);
        }
    }
});
