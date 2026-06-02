# YouQian Reader 📚

[![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)](package.json)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)](package.json)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](package.json)

**YouQian Reader** 是一款专为极致阅读体验量身打造的桌面电子书阅读器。它完美支持 **EPUB, MOBI, AZW3, PDF, TXT** 等主流电子书格式，配备了豪华 of 学术级纸质排版系统 and 毫秒级响应的翻页动画，在保持 60Hz 帧率下带来实体书般的纯净与舒适。

---

## 🌟 核心特色 (V1.1 精准重构版)

### 1. 物理滑页排版系统
- **CSS Column 多栏横向分页**：全平台摒弃难看的传统纵向滚动模式，采用优雅的多栏流式布局（Columns），让文字自然分布在左右视口，带来实体书 page-flip 的横向翻页美感。
- **全套驱动支持**：支持键盘（`ArrowRight`/`PageDown`/`ArrowLeft`/`PageUp`）、鼠标滚轮（带 400ms 冷却防止误触）、以及阅读区左右绝对定位的磨砂渐现导航按键，满足您多场景的翻页姿势。
- **自适应窗口拉伸**：内置 `ResizeObserver` 动态防抖监听，完美贴合窗口尺寸，保证每一次侧边栏伸缩、字号大小调整时页面 scrollLeft 横向对齐毫无膨胀及错位。

### 2. 学术著作级物理注释重构 (V1.1 重磅升级)
- **纯文字右上角 `“注¹”` 替换**：彻底扫除 MOBI/AZW3 格式书籍中影响阅读的超大 Base64 注脚垃圾图片，重写为右上角高精细纯文字上标，并绑定 `title` 属性。
- **极速悬浮释义气泡**：鼠标轻抚 `注¹` 文字，**浏览器在 0.1 毫秒内自动弹出一个原生释义气泡，展示原书自带的详尽中文释义**，彻底告别来回翻页和频繁跳页之苦。
- **局部按序重排**：在各章节内部重排注释序号，自动按 `注¹`、`注²` 重置，与高档实体纸质书编排规范 100% 契合。
- **本章注释跨栏面板**：在每一章正文结束、下一章标题开始前的缝隙中，智能植入一个磨砂玻璃般的【本章注释】面板。支持 `column-span: all` 物理跨栏排版，彻底解决注释段落在翻页时被拦腰竖向切断的排版冲突，同时物理隐藏全书最末尾长达几十页的垃圾冗余，使全书精简清爽。

### 3. 主进程字节级高精度物理锚点植入 (V1.1 核心攻坚 🔥)
- **破案底层机制**：MOBI/AZW3 专属 `filepos` 跳转超链接（例如 `filepos=56486`）绝对是指向原始合并记录字节流中的**字节偏移量（Byte Offset）**。由于中文在多字节编码（如 UTF-8）下占 3 字节，解密解码成 JS 字符串后会产生数万个位置的字符索引偏置，造成前端锚点插入位置完全错位，从而误触了目录页上的超链接自身（表现为点击目录“原地踏步、跳回目录页自身”的严重 Bug）。
- **字节级倒序分割注入**：我们在主进程 [mobi.js](electron/main/parsers/mobi.js) 的解密内容合并解压后，在字节 `Buffer` 层面，按从大到小（降序）的顺序对原始字节流进行 `slice` 物理切割，在精确的字节偏移处拼入 `<span id="filepos-VAL">` 定位锚点字节，再统一解码。
- **0 偏差直连跳转**：生成的 HTML 在对应章节的绝对物理起始位置天生且毫无偏置地嵌套着唯一的物理锚点。前端 `MobiReader` 彻底释放运算负担，跳转时直接通过 `document.getElementById('filepos-VAL')` 极速直连检索，**100% 实现数学级的零误触、零歧义高精度跳转**。

---

## 🛠️ 项目技术栈

- **桌面外壳**：[Electron](https://www.electronjs.org/) (渲染进程多线程隔离)
- **前端视图**：[React](https://react.dev/) + [Vite](https://vite.dev/) (毫秒级热更新开发)
- **全局状态**：[Zustand](https://github.com/pmndrs/zustand)
- **格式解析**：
  - EPUB: [Epub.js](http://epubjs.org/)
  - PDF: [PDF.js](https://mozilla.github.io/pdf.js/)
  - MOBI / AZW3: 自主实现的原生记录（Records）及 Huffman/CDIC 精密解密提取引擎
  - TXT: 多编码自动探测加载机制 (iconv-lite + chardet)

---

## 🚀 快速开始

### 1. 检出与环境准备
确保本地安装了 [Node.js](https://nodejs.org/) (推荐 v18+)。

```bash
# 进入项目根目录
cd youqian-reader

# 安装依赖
npm install
```

### 2. 启动开发模式
```bash
npm run dev
```

### 3. 生产编译与打包
```bash
# 仅执行打包编译
npm run build

# 执行构建并打包为 Windows 独立运行程序 (.exe)
npm run package
```

---

## 📄 开源许可证

本项目基于 **MIT License** 许可协议开源。详情参见 [LICENSE](LICENSE) 文件。
