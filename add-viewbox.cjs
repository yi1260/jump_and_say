const fs = require('fs');
const path = require('path');

const svgDir = path.join(__dirname, 'public/assets/kenney/Vector');

const directories = {
  Backgrounds: { width: '256', height: '256' },
  Characters: { width: '128', height: '128' },
  Enemies: { width: '64', height: '64' },
  Tiles: { width: '64', height: '64' }
};

function addViewBoxToSvg(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  
  if (content.includes('viewBox=')) {
    console.log(`⏭️  跳过 (已有 viewBox): ${path.relative(svgDir, filePath)}`);
    return;
  }
  
  const widthMatch = content.match(/width="(\d+)"/);
  const heightMatch = content.match(/height="(\d+)"/);
  
  if (!widthMatch || !heightMatch) {
    console.log(`⚠️  无法获取尺寸: ${path.relative(svgDir, filePath)}`);
    return;
  }
  
  const width = widthMatch[1];
  const height = heightMatch[1];
  const viewBox = `viewBox="0 0 ${width} ${height}"`;
  
  const newContent = content.replace(
    /<svg([^>]*)>/,
    `<svg$1 ${viewBox}>`
  );
  
  fs.writeFileSync(filePath, newContent, 'utf8');
  console.log(`✅ 添加 viewBox: ${path.relative(svgDir, filePath)} (${width}x${height})`);
}

function processDirectory(dirName) {
  const dirPath = path.join(svgDir, dirName);
  if (!fs.existsSync(dirPath)) return;
  
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.svg'));
  console.log(`\n📁 处理 ${dirName} (${files.length} 个文件)...`);
  
  files.forEach(file => {
    addViewBoxToSvg(path.join(dirPath, file));
  });
}

console.log('🚀 开始批量添加 viewBox 属性...\n');

Object.keys(directories).forEach(dir => processDirectory(dir));

console.log('\n✨ 完成！所有 SVG 文件已添加 viewBox 属性。');
