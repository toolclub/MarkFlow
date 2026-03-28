# MarkFlow

**免费开源的 Typora 风格 Markdown 编辑器**

[![version](https://img.shields.io/badge/version-3.0.0-6366f1?style=flat-square)](https://github.com/markflow/markflow) [![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE) [![platform](https://img.shields.io/badge/platform-Win%20%7C%20Mac%20%7C%20Linux-orange?style=flat-square)](#)

---

## 为什么选 MarkFlow

Typora 要收费了？MarkFlow 是一个免费、开源的替代品，提供接近 Typora 的编辑体验。

### 核心架构

MarkFlow 使用 **textarea + 实时预览叠加** 的架构：

- `<textarea>` 始终是编辑核心 → **撤销/重做天然可靠**（Ctrl+Z / Ctrl+Y 直接可用）
- 预览层叠加在 textarea 之上，实时渲染 Markdown
- 预览模式下 textarea 文字透明、光标可见，用户看到的是渲染结果，但输入直接作用于 textarea
- 源码模式下隐藏预览层，直接看到原始 Markdown

这种架构避免了 contenteditable 的各种 bug，同时提供了接近 WYSIWYG 的体验。

## 功能

### 编辑体验

| 功能 | 说明 |
|------|------|
| 实时预览 | 输入 Markdown，即时看到渲染结果 |
| 源码模式 | `Ctrl+/` 切换，直接编辑 Markdown |
| 代码块创建 | 输入 ``` + Enter → 创建代码框 + 弹出语言选择 |
| 语言选择器 | 40+ 语言，搜索过滤，上下键选择，Enter 确认 |
| 语言切换 | 代码块右下角语言标签可点击切换 |
| 列表续行 | Enter 自动续行，空行退出 |
| 列表缩进 | Tab 缩进，Shift+Tab 反缩进 |
| 撤销重做 | Ctrl+Z / Ctrl+Y，基于 textarea 原生支持 |
| 查找替换 | Ctrl+F |
| 文档大纲 | Ctrl+\ 切换侧边栏 |
| 字数统计 | 实时中英文字符/词数统计 |

### 渲染能力

| 功能 | 技术 |
|------|------|
| 代码高亮 | Highlight.js，190+ 语言 |
| 数学公式 | KaTeX (CDN)，行内 `$...$` + 块级 `$$...$$` |
| 图表 | Mermaid (CDN)，流程图/时序图/甘特图/ER图等全系列 |
| GFM | 表格、任务列表、删除线、脚注 |
| 超链接 | HTTP 链接可点击，在浏览器中打开 |

### 桌面功能

- 📁 文件关联 — `.md` 文件默认打开方式
- 🌗 深色/浅色主题 — `Ctrl+Shift+T`
- 📤 导出 HTML / PDF
- 🖱️ 拖放打开 `.md` 文件
- 💾 自定义安装目录（Windows）

## 快速开始

### 环境

- [Node.js](https://nodejs.org/) v18+ (推荐 v20 LTS)

### 开发

```bash
git clone https://github.com/yourname/markflow.git
cd markflow
npm install
npm start
```

### 构建

```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

> 国内加速：`set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`

产物在 `dist/` 目录。

### 安装

**Windows**: 双击 `MarkFlow Setup x.x.x.exe`，选择安装目录（支持 D 盘等），完成后右键 `.md` 文件 → 打开方式 → MarkFlow → 勾选"始终使用"。

**macOS**: 打开 `.dmg`，拖入 Applications。

**Linux**: `chmod +x MarkFlow-x.x.x.AppImage && ./MarkFlow-x.x.x.AppImage`

## 快捷键

| 功能 | Windows/Linux | macOS |
|------|--------------|-------|
| 新建 | `Ctrl+N` | `⌘+N` |
| 打开 | `Ctrl+O` | `⌘+O` |
| 保存 | `Ctrl+S` | `⌘+S` |
| 加粗 | `Ctrl+B` | `⌘+B` |
| 斜体 | `Ctrl+I` | `⌘+I` |
| 行内代码 | `` Ctrl+` `` | `` ⌘+` `` |
| 超链接 | `Ctrl+K` | `⌘+K` |
| 代码块 | `Ctrl+Shift+K` | `⌘+⇧+K` |
| 查找 | `Ctrl+F` | `⌘+F` |
| 源码模式 | `Ctrl+/` | `⌘+/` |
| 大纲 | `Ctrl+\` | `⌘+\` |
| 主题 | `Ctrl+Shift+T` | `⌘+⇧+T` |
| 专注模式 | `F11` | `F11` |
| 撤销 | `Ctrl+Z` | `⌘+Z` |
| 重做 | `Ctrl+Y` | `⌘+⇧+Z` |

## 项目结构

```
markflow/
├── package.json        # 配置 + electron-builder
├── README.md
├── .gitignore
└── src/
    ├── main.js         # Electron 主进程
    ├── index.html      # 页面
    ├── styles.css      # 样式 (深色/浅色主题)
    └── renderer.js     # 编辑器引擎
```

## 技术栈

| 组件 | 用途 |
|------|------|
| Electron | 跨平台桌面框架 |
| marked | Markdown → HTML |
| highlight.js | 代码高亮 |
| KaTeX (CDN) | 数学公式 |
| Mermaid (CDN) | 图表 |

## License

[MIT](LICENSE)

---

**MarkFlow** — *让 Markdown 写作更愉快* ✨
