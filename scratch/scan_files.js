const fs = require('fs');
const path = require('path');

const rootDir = 'D:\\reader';

function scanDir(dir) {
  try {
    const list = fs.readdirSync(dir);
    list.forEach(file => {
      const fullPath = path.join(dir, file);
      
      // Check for corrupt character components or the emoji book
      if (file.includes('📚') || file.includes('ð') || file.includes('Ÿ') || file.includes('š')) {
        console.log(`Found matching name: "${file}" at ${fullPath}`);
      }
      
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules' && file !== 'out') {
        scanDir(fullPath);
      }
    });
  } catch (err) {
    // Ignore errors for permissions/etc.
  }
}

console.log('Starting file scan in D:\\reader...');
scanDir(rootDir);
console.log('Scan complete.');
