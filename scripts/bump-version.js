const fs = require('fs');
const path = require('path');

/**
 * 递增版本号 (语义化版本 SemVer: major.minor.patch)
 * @param {'patch' | 'minor' | 'major'} type 递增级别
 * @param {boolean} dryRun 是否仅模拟预览不写回文件
 * @returns {{ oldVersion: string, newVersion: string, pkgPath: string }}
 */
function bumpVersion(type = 'patch', dryRun = false) {
  const pkgPath = path.join(process.cwd(), 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`未找到 package.json 文件: ${pkgPath}`);
  }

  const pkgRaw = fs.readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(pkgRaw);
  const oldVersion = pkg.version || '1.0.0';

  const parts = oldVersion.split('.').map(p => parseInt(p, 10) || 0);
  while (parts.length < 3) parts.push(0);

  let [major, minor, patch] = parts;

  if (type === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (type === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    // 默认 patch 递增
    patch += 1;
  }

  const newVersion = `${major}.${minor}.${patch}`;

  if (!dryRun) {
    pkg.version = newVersion;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  }

  return { oldVersion, newVersion, pkgPath };
}

// 支持命令行直接调用: node scripts/bump-version.js [patch|minor|major] [--dry-run]
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const type = args.find(a => ['major', 'minor', 'patch'].includes(a)) || 'patch';

    const result = bumpVersion(type, dryRun);
    const dryRunTag = dryRun ? ' [模拟运行，未写回]' : '';
    console.log(`\x1b[32m✔ 版本号已${dryRun ? '预计' : '成功'}递增 (${type}): \x1b[1m${result.oldVersion} -> ${result.newVersion}\x1b[0m${dryRunTag}`);
  } catch (err) {
    console.error(`\x1b[31m✖ 递增版本号失败: ${err.message}\x1b[0m`);
    process.exit(1);
  }
}

module.exports = { bumpVersion };
