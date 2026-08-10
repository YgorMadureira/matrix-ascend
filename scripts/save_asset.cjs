const fs = require('fs');
const b64 = fs.readFileSync('shopee-white-b64.txt', 'utf8');
const dir = 'src/assets';
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}
fs.writeFileSync('src/assets/shopeeWhiteLogo.ts', 'export const shopeeWhiteLogo = `' + b64 + '`;\n');
console.log('Saved to src/assets/shopeeWhiteLogo.ts');
