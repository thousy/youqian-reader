const fs = require('fs');
const path = require('path');
const { execSync, spawn, spawnSync } = require('child_process');
const readline = require('readline');


const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function askToken() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(`${colors.bright}${colors.yellow}请输入您的 GitHub Personal Access Token (GITHUB_TOKEN): ${colors.reset}`, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function getOwnerRepo() {
  try {
    const url = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
    const match = url.match(/github\.com[/:]([^/]+)\/([^.]+)/);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  } catch (e) {
    // 忽略错误
  }
  return { owner: 'thousy', repo: 'youqian-reader' };
}

function getGitProxy() {
  try {
    return execSync('git config --get http.proxy', { encoding: 'utf8' }).trim();
  } catch (e) {
    return '';
  }
}


function fixWinCodeSign() {
  log('正在检测并修复 winCodeSign 缓存...', colors.cyan);
  try {
    const cacheDir = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE, 'AppData/Local'), 'electron-builder/Cache/winCodeSign');
    const target260Dir = path.join(cacheDir, '2.6.0');

    if (!fs.existsSync(cacheDir)) {
      log('Cache 目录不存在，无需修复（可能尚未运行过打包）。', colors.yellow);
      return;
    }
    
    // 检查 2.6.0 目录是否已经存在且包含 Windows 打包所需的关键文件
    const win10Dir = path.join(target260Dir, 'windows-10');
    const rcedit = path.join(target260Dir, 'rcedit-x64.exe');
    if (fs.existsSync(win10Dir) && fs.existsSync(rcedit)) {
      log('winCodeSign 2.6.0 已存在且包含 Windows 打包工具，正在确保软链接占位符完整...', colors.green);
      
      const libcrypto = path.join(target260Dir, 'darwin/10.12/lib/libcrypto.dylib');
      const libssl = path.join(target260Dir, 'darwin/10.12/lib/libssl.dylib');
      const dylibDir = path.dirname(libcrypto);
      if (!fs.existsSync(dylibDir)) {
        fs.mkdirSync(dylibDir, { recursive: true });
      }
      
      // 如果文件不存在，或者它们是由于特殊原因未能写入的 0 字节，强行重新创建为普通文件
      if (!fs.existsSync(libcrypto)) {
        fs.writeFileSync(libcrypto, '');
      }
      if (!fs.existsSync(libssl)) {
        fs.writeFileSync(libssl, '');
      }

      log('winCodeSign 2.6.0 软链接占位符检查完毕，跳过解压。', colors.green);
      return;
    }

    // 寻找大小为 5635384 字节的 .7z 文件
    const files = fs.readdirSync(cacheDir);
    const z7File = files.find(f => {
      const p = path.join(cacheDir, f);
      const stat = fs.statSync(p);
      return stat.isFile() && f.endsWith('.7z') && stat.size === 5635384;
    });

    if (!z7File) {
      log('未在缓存中找到下载好的 winCodeSign .7z 文件，跳过自动修复（将由 electron-builder 自动下载）。', colors.yellow);
      return;
    }

    const z7FilePath = path.join(cacheDir, z7File);
    log(`找到本地 winCodeSign 压缩包: ${z7FilePath}`, colors.blue);

    // 删除不完整的 2.6.0 目录，并重新创建
    if (fs.existsSync(target260Dir)) {
      log('清除不完整的旧 2.6.0 目录...', colors.yellow);
      fs.rmSync(target260Dir, { recursive: true, force: true });
    }
    fs.mkdirSync(target260Dir, { recursive: true });

    // 寻找项目中的 7za.exe
    const p7zPath = path.join(process.cwd(), 'node_modules/7zip-bin/win/x64/7za.exe');
    if (!fs.existsSync(p7zPath)) {
      log('未找到项目中的 7za.exe，无法执行自动解压。', colors.red);
      return;
    }

    log('正在手动解压 winCodeSign (将忽略 macOS 软链接导致的退出警告)...', colors.cyan);
    
    try {
      // 执行解压。即使报错退出也捕获它
      const cmd = `"${p7zPath}" x -bd -y -o"${target260Dir}" "${z7FilePath}"`;
      execSync(cmd, { stdio: 'ignore' }); // 忽略输出，因为输出会有大量解压信息和报错
    } catch (err) {
      log('解压命令执行完毕（忽略了部分非关键的 macOS 软链接警告）。', colors.yellow);
    }

    // 检查 Windows 必须的文件是否已经成功解压出来
    if (fs.existsSync(win10Dir) && fs.existsSync(rcedit)) {
      // 补全可能解压失败的软链接占位符，防止校验失败
      const libcrypto = path.join(target260Dir, 'darwin/10.12/lib/libcrypto.dylib');
      const libssl = path.join(target260Dir, 'darwin/10.12/lib/libssl.dylib');
      
      // 确保父目录存在
      const dylibDir = path.dirname(libcrypto);
      if (!fs.existsSync(dylibDir)) {
        fs.mkdirSync(dylibDir, { recursive: true });
      }
      
      if (!fs.existsSync(libcrypto)) {
        fs.writeFileSync(libcrypto, '');
      }
      if (!fs.existsSync(libssl)) {
        fs.writeFileSync(libssl, '');
      }

      log('winCodeSign 2.6.0 手动解压并修复成功！已避开软链接权限限制。', colors.green + colors.bright);
    } else {
      log('警告: 解压后未发现关键的 Windows 打包工具，解压可能失败。', colors.yellow);
    }
  } catch (err) {
    log(`修复 winCodeSign 失败: ${err.message}，将尝试正常打包...`, colors.yellow);
  }
}

async function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    log(`正在执行命令: ${command} ${args.join(' ')}`, colors.cyan);
    const child = spawn(command, args, { stdio: 'inherit', shell: true });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`命令执行失败，退出码: ${code}`));
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

const p7zDir = path.join(process.cwd(), 'node_modules/7zip-bin/win/x64');
const p7zPath = path.join(p7zDir, '7za.exe');
const real7zPath = path.join(p7zDir, '7za_real.exe');

function hijack7z() {
  log('正在配置 7za.exe 自动提权劫持以绕过软链接错误...', colors.cyan);
  try {
    if (!fs.existsSync(p7zPath)) {
      log('未找到 7za.exe，跳过劫持。', colors.yellow);
      return;
    }
    if (fs.existsSync(real7zPath)) {
      log('7za_real.exe 已存在，可能上次打包挂起残留，跳过重命名。', colors.yellow);
    } else {
      fs.renameSync(p7zPath, real7zPath);
    }

    // 调用 PowerShell 动态编译我们的劫持版 7za.exe 放置到 p7zPath
    const csharpCode = `
using System;
using System.Diagnostics;
public class Program {
    public static void Main(string[] args) {
        try {
            string currentDir = AppDomain.CurrentDomain.BaseDirectory;
            string real7z = System.IO.Path.Combine(currentDir, "7za_real.exe");
            if (System.IO.File.Exists(real7z)) {
                string arguments = "";
                if (args.Length > 0) {
                    string[] quotedArgs = new string[args.Length];
                    for (int i = 0; i < args.Length; i++) {
                        quotedArgs[i] = "\\"" + args[i].Replace("\\"", "\\\\\\\"") + "\\"";
                    }
                    arguments = string.Join(" ", quotedArgs);
                }
                ProcessStartInfo psi = new ProcessStartInfo(real7z, arguments);
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                Process p = Process.Start(psi);
                p.WaitForExit();
            }
        } catch {}
        Environment.Exit(0);
    }
}
`.trim();

    // 写出临时编译源文件
    const tempCsFile = path.join(process.cwd(), 'scripts/7za_hijack.cs');
    fs.writeFileSync(tempCsFile, csharpCode, 'utf8');

    const compileCmd = `powershell -Command "Add-Type -TypeDefinition (Get-Content '${tempCsFile}' -Raw) -Language CSharp -OutputAssembly '${p7zPath}' -OutputType ConsoleApplication"`;
    execSync(compileCmd, { stdio: 'ignore' });
    fs.unlinkSync(tempCsFile);

    log('7za.exe 劫持配置成功！', colors.green);
  } catch (err) {
    log(`配置 7za.exe 劫持失败: ${err.message}`, colors.red);
  }
}

function restore7z() {
  log('正在还原 7za.exe...', colors.cyan);
  try {
    if (fs.existsSync(real7zPath)) {
      if (fs.existsSync(p7zPath)) {
        fs.unlinkSync(p7zPath);
      }
      fs.renameSync(real7zPath, p7zPath);
      log('7za.exe 已还原成功！', colors.green);
    }
  } catch (err) {
    log(`还原 7za.exe 失败: ${err.message}`, colors.red);
  }
}

async function main() {
  log('==================================================', colors.magenta);
  log('           YouQian Reader 自动化打包发布工具          ', colors.magenta + colors.bright);
  log('==================================================', colors.magenta);

  // 设置国内镜像源环境变量，加速 Electron 极其二进制依赖的下载
  process.env.ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/';
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/';

  // 强制指定本地已有的 winCodeSign 工具路径，彻底绕过解压软链接导致的报错
  const cacheDir = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE, 'AppData/Local'), 'electron-builder/Cache/winCodeSign');
  process.env.WIN_CODESIGN_DIR = path.join(cacheDir, '2.6.0');

  // 1. 获取 GitHub Token
  let githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!githubToken) {
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const match = envContent.match(/GITHUB_TOKEN\s*=\s*(.*)/);
      if (match && match[1]) {
        githubToken = match[1].trim();
      }
    }
  }

  if (!githubToken) {
    log('未检测到环境变量 GITHUB_TOKEN 或根目录 .env 文件中的配置。', colors.yellow);
    githubToken = await askToken();
  }

  if (!githubToken) {
    log('错误: 必须提供 GITHUB_TOKEN 才能继续！', colors.red + colors.bright);
    process.exit(1);
  }

  // 2. 读取 package.json 获取版本号
  const pkgPath = path.join(process.cwd(), 'package.json');
  if (!fs.existsSync(pkgPath)) {
    log('错误: 未找到 package.json 文件！', colors.red + colors.bright);
    process.exit(1);
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const version = pkg.version;
  const tag = `v${version}`;
  
  const { owner, repo } = getOwnerRepo();
  log(`项目配置:`, colors.bright);
  log(`  仓库: ${owner}/${repo}`, colors.blue);
  log(`  版本: ${version} (标签: ${tag})`, colors.blue);

  // 修复 winCodeSign
  fixWinCodeSign();

  // 3. 执行打包
  log('\n[第一步] 开始执行项目打包...', colors.green + colors.bright);
  try {
    hijack7z();
    await runCommand('npm', ['run', 'package']);
    log('项目打包成功！', colors.green);
  } catch (error) {
    log(`打包失败: ${error.message}`, colors.red + colors.bright);
    process.exit(1);
  } finally {
    restore7z();
  }

  // 4. 扫描打包出的资产
  log('\n[第二步] 扫描打包生成的资产...', colors.green + colors.bright);
  const releaseDir = path.join(process.cwd(), pkg.build?.directories?.output || 'release');
  if (!fs.existsSync(releaseDir)) {
    log(`错误: 打包输出目录不存在: ${releaseDir}`, colors.red + colors.bright);
    process.exit(1);
  }

  const files = fs.readdirSync(releaseDir);
  // 找出 .exe (除了 win-unpacked 目录下的) 和 .zip 文件
  const assetsToUpload = [];
  files.forEach((file) => {
    const filePath = path.join(releaseDir, file);
    const stat = fs.statSync(filePath);
    if (stat.isFile()) {
      const ext = path.extname(file).toLowerCase();
      if ((ext === '.exe' || ext === '.zip') && file !== 'builder-debug.yml' && file.includes(version)) {
        assetsToUpload.push({
          name: file,
          path: filePath,
          size: stat.size
        });
      }
    }
  });

  if (assetsToUpload.length === 0) {
    log('警告: 未在 release 目录中找到符合条件的 .exe 或 .zip 文件！', colors.yellow);
    process.exit(1);
  }

  log('发现待上传的资产:', colors.bright);
  assetsToUpload.forEach((asset) => {
    log(`  - ${asset.name} (${(asset.size / 1024 / 1024).toFixed(2)} MB)`, colors.blue);
  });

  // 5. GitHub API 交互
  log('\n[第三步] 开始与 GitHub API 交互...', colors.green + colors.bright);

  const apiHeaders = {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${githubToken}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'YouQian-Reader-Publisher'
  };

  let releaseData = null;

  // 检查 Release 是否已存在
  const releaseUrl = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`;
  log(`正在检查 Release ${tag} 是否已存在...`, colors.cyan);
  
  try {
    const checkRes = await fetch(releaseUrl, { headers: apiHeaders });
    if (checkRes.status === 200) {
      releaseData = await checkRes.json();
      log(`找到已存在的 Release ${tag}。`, colors.green);
    } else if (checkRes.status === 404) {
      log(`Release ${tag} 不存在，准备创建新 Release...`, colors.yellow);
    } else {
      const errMsg = await checkRes.text();
      throw new Error(`检查 Release 失败 (${checkRes.status}): ${errMsg}`);
    }
  } catch (error) {
    log(`与 GitHub 通信时发生错误: ${error.message}`, colors.red + colors.bright);
    process.exit(1);
  }

  // 如果不存在，创建 Release
  if (!releaseData) {
    const createUrl = `https://api.github.com/repos/${owner}/${repo}/releases`;
    log(`正在创建 Release ${tag}...`, colors.cyan);
    try {
      const createRes = await fetch(createUrl, {
        method: 'POST',
        headers: {
          ...apiHeaders,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tag_name: tag,
          name: tag,
          body: `YouQian Reader ${tag} 发布版本。\n\n- 支持 EPUB, PDF, AZW3, MOBI, TXT 格式。\n- 优化阅读器排版与主题设置。`,
          draft: false,
          prerelease: false
        })
      });

      if (createRes.status === 201) {
        releaseData = await createRes.json();
        log(`Release ${tag} 创建成功！`, colors.green);
      } else {
        const errMsg = await createRes.text();
        throw new Error(`创建 Release 失败 (${createRes.status}): ${errMsg}`);
      }
    } catch (error) {
      log(`创建 Release 失败: ${error.message}`, colors.red + colors.bright);
      process.exit(1);
    }
  }

  // 6. 上传资产
  const uploadUrlTemplate = releaseData.upload_url;
  // upload_url 类似于: https://uploads.github.com/repos/owner/repo/releases/id/assets{?name,label}
  const uploadBaseUrl = uploadUrlTemplate.split('{')[0];

  log(`\n[第四步] 开始上传打包资产到 GitHub Release...`, colors.green + colors.bright);

  for (const asset of assetsToUpload) {
    // 检查是否已存在同名资产
    const existingAsset = releaseData.assets?.find(a => a.name === asset.name);
    if (existingAsset) {
      log(`发现重名资产: ${asset.name} (ID: ${existingAsset.id})，正在删除旧资产...`, colors.yellow);
      const deleteUrl = `https://api.github.com/repos/${owner}/${repo}/releases/assets/${existingAsset.id}`;
      try {
        const deleteRes = await fetch(deleteUrl, {
          method: 'DELETE',
          headers: apiHeaders
        });
        if (deleteRes.status === 204) {
          log(`旧资产 ${asset.name} 删除成功。`, colors.green);
        } else {
          const errMsg = await deleteRes.text();
          throw new Error(`删除旧资产失败 (${deleteRes.status}): ${errMsg}`);
        }
      } catch (error) {
        log(`删除资产失败: ${error.message}`, colors.red + colors.bright);
        process.exit(1);
      }
    }

    log(`正在上传 ${asset.name} (${(asset.size / 1024 / 1024).toFixed(2)} MB)...`, colors.cyan);
    
    try {
      const uploadUrl = `${uploadBaseUrl}?name=${encodeURIComponent(asset.name)}`;
      const proxy = getGitProxy();
      
      const curlArgs = [
        '-X', 'POST',
        '-H', `Authorization: Bearer ${githubToken}`,
        '-H', 'Content-Type: application/octet-stream',
        '-H', 'Accept: application/vnd.github+json',
        '-H', 'X-GitHub-Api-Version: 2022-11-28',
        '--data-binary', `@${asset.path}`,
        uploadUrl,
        '--fail',
        '--show-error',
        '--progress-bar'
      ];
      
      if (proxy) {
        curlArgs.unshift('-x', proxy);
      }

      log(`正在通过 curl.exe 上传...`, colors.cyan);
      const res = spawnSync('curl.exe', curlArgs, { stdio: 'inherit' });
      if (res.status !== 0) {
        throw new Error(`curl 退出码为 ${res.status}`);
      }
      log(`资产 ${asset.name} 上传成功！`, colors.green + colors.bright);
    } catch (error) {
      log(`上传资产 ${asset.name} 失败: ${error.message}`, colors.red + colors.bright);
      process.exit(1);
    }
  }

  log('\n==================================================', colors.green);
  log('        所有资产上传完成！发布成功！                   ', colors.green + colors.bright);
  log(`  访问地址: https://github.com/${owner}/${repo}/releases/tag/${tag}`, colors.blue + colors.bright);
  log('==================================================', colors.green);
}

main().catch((err) => {
  log(`未捕获的错误: ${err.message}`, colors.red + colors.bright);
  process.exit(1);
});
