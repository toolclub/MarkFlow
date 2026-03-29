# MarkFlow

<p align="center">
  <img src="build/icon.png" width="128" height="128" alt="MarkFlow Icon">
</p>

<p align="center">
  <strong>免费开源的 Typora 风格 Markdown 编辑器</strong>
</p>

<p align="center">
  <a href="https://github.com/toolclub/MarkFlow/releases/latest"><img src="https://img.shields.io/badge/version-1.1.0-6366f1?style=flat-square" alt="version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="license"></a>
  <a href="https://github.com/toolclub/MarkFlow/releases/latest"><img src="https://img.shields.io/badge/platform-Win%20%7C%20Mac%20%7C%20Linux-orange?style=flat-square" alt="platform"></a>
</p>

<p align="center">
  <a href="https://github.com/toolclub/MarkFlow/releases/download/v1.1.0/MarkFlow-Setup-1.1.0.exe">
    <img src="https://img.shields.io/badge/Download-Windows%20Installer-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Windows Download">
  </a>
  &nbsp;
  <a href="https://github.com/toolclub/MarkFlow/releases/download/v1.1.0/MarkFlow-1.1.0.dmg">
    <img src="https://img.shields.io/badge/Download-macOS%20DMG-000000?style=for-the-badge&logo=apple&logoColor=white" alt="macOS Download">
  </a>
  &nbsp;
  <a href="https://github.com/toolclub/MarkFlow/releases/download/v1.1.0/MarkFlow-1.1.0.AppImage">
    <img src="https://img.shields.io/badge/Download-Linux%20AppImage-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Linux Download">
  </a>
</p>

---

## 为什么选 MarkFlow

Typora 要收费了？MarkFlow 是一个免费、开源的替代品，提供接近 Typora 的编辑体验。

### 核心架构

MarkFlow 使用 **Block-based WYSIWYG** 架构（灵感来自 MarkText/muya）：

- 文档 = 有序的 Block 数组，每个 Block 管理自己的 DOM 和 contenteditable
- 编辑在 Block 级别进行，不需要全文档重新渲染
- 输入模式检测（`###`、\`\`\`、`---` 等）在光标位置原地转换 Block 类型
- 撤销/重做使用 Markdown 快照机制（快照间隔 600ms 防抖）
- 多标签页支持，每个标签独立维护编辑状态

## 功能

### 编辑体验

| 功能 | 说明 |
|------|------|
| 所见即所得 | 输入 Markdown，即时看到渲染结果 |
| 多标签页 | 同时打开多个文件，`Ctrl+Tab` 切换，中键关闭，右键菜单 |
| 源码模式 | `Ctrl+/` 切换，直接编辑 Markdown |
| 代码块创建 | 输入 \`\`\` + Enter，弹出语言选择器（40+ 语言） |
| 语言切换 | 代码块右下角语言标签可点击切换 |
| 列表续行 | Enter 自动续行，空行退出，Tab 缩进 |
| 撤销重做 | `Ctrl+Z` / `Ctrl+Y`，基于 Markdown 快照 |
| 查找替换 | `Ctrl+F` Typora 风格浮动面板，计数显示，循环搜索 |
| 右键菜单 | 编辑区域右键弹出格式化菜单，含快捷键提示 |
| 文档大纲 | `Ctrl+\` 切换侧边栏，按标题层级缩进 |
| 最近文件 | 侧边栏显示最近打开的文件列表 |
| 字数统计 | 实时中英文字符/词数统计 |
| 拖放支持 | 拖放 .md 文件到新标签，拖放图片插入 |
| 图片粘贴 | 剪贴板图片自动保存到 images/ 目录 |

### 渲染能力

| 功能 | 技术 |
|------|------|
| 代码高亮 | Highlight.js，190+ 语言 |
| 数学公式 | KaTeX，行内 `$...$` + 块级 `$$...$$` |
| 图表 | Mermaid，流程图/时序图/甘特图等 |
| GFM | 表格、任务列表、删除线 |
| 超链接 | 点击在浏览器打开 |

### 桌面功能

- 文件关联 — `.md` 文件默认打开方式
- 深色/浅色主题 — `Ctrl+Shift+T`
- 导出 HTML / PDF
- 拖放打开 `.md` 文件（新标签）
- 自定义安装目录（Windows）

## 安装

### 直接下载

前往 [Releases](https://github.com/toolclub/MarkFlow/releases/latest) 页面下载对应系统的安装包：

| 平台 | 文件 | 说明 |
|------|------|------|
| Windows | `MarkFlow-Setup-1.1.0.exe` | NSIS 安装器，支持自定义安装目录 |
| macOS | `MarkFlow-1.1.0.dmg` | 拖入 Applications 即可 |
| Linux | `MarkFlow-1.1.0.AppImage` | `chmod +x` 后直接运行 |
| Linux | `markflow_1.1.0_amd64.deb` | Debian/Ubuntu: `sudo dpkg -i` |

### 从源码构建

```bash
git clone https://github.com/toolclub/MarkFlow.git
cd MarkFlow
npm install
npm start          # 开发运行

npm run build:win   # 构建 Windows
npm run build:mac   # 构建 macOS
npm run build:linux # 构建 Linux
```

> 国内加速：`set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`

## 快捷键

| 功能 | Windows/Linux | macOS |
|------|--------------|-------|
| 新建标签 | `Ctrl+N` | `⌘+N` |
| 打开 | `Ctrl+O` | `⌘+O` |
| 保存 | `Ctrl+S` | `⌘+S` |
| 关闭标签 | `Ctrl+W` | `⌘+W` |
| 切换标签 | `Ctrl+Tab` | `⌘+Tab` |
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
MarkFlow/
├── package.json          # 配置 + electron-builder
├── build/
│   ├── icon.svg          # 应用图标 (SVG 源)
│   ├── icon.png          # 应用图标 (512px)
│   └── icon.ico          # Windows 图标
└── src/
    ├── main.js           # Electron 主进程 (文件 I/O, 菜单, IPC)
    ├── index.html        # 页面布局 (工具栏, 标签栏, 编辑区)
    ├── styles.css        # 样式 (深色/浅色主题, 标签, 查找面板)
    ├── renderer.js       # 渲染进程 (标签管理, 快捷键, 查找替换)
    └── editor/
        ├── Editor.js     # Block-based WYSIWYG 编辑器核心
        ├── parser.js     # Markdown → Block 解析器
        ├── history.js    # 撤销/重做 (快照栈)
        ├── utils.js      # DOM/光标工具函数
        └── langpopup.js  # 语言选择弹窗
```

## 技术栈

| 组件 | 用途 |
|------|------|
| Electron 28 | 跨平台桌面框架 |
| marked 12 | Markdown → HTML |
| highlight.js 11 | 代码语法高亮 |
| KaTeX 0.16 (CDN) | 数学公式渲染 |
| Mermaid 11 (CDN) | 图表渲染 |

## Release Notes

### v1.1.0

**体验优化版本**

**新特性与修复：**
- **原始 HTML 块支持** — `<p align="center">` 等 HTML 标签现在可以正确渲染和保留，切换源码模式不再丢失
- **嵌套列表完整支持** — 多级列表（`- 1` → `  - 2`）现在正确显示圆点层级符号（●/○/▪）
- **列表 Enter 续行** — 在列表项中按 Enter 自动在同级新建下一项，体验与 Typora 一致；空项按 Enter 退出/上移层级
- **卡通风格退出提示** — 退出时的未保存提示改为更友好的动画弹窗，告别冰冷系统对话框
- **Windows .md 文件图标** — 重新安装后，Windows 资源管理器中 .md 文件将显示 MarkFlow 图标

**支持平台：** Windows (x64) / macOS / Linux (AppImage, deb)

---

### v1.0.0

**MarkFlow 首个正式版发布！** 免费开源的 Typora 替代品。

**核心功能：**
- Block-based WYSIWYG 编辑器 — 所见即所得的 Markdown 编辑体验
- 多标签页 — 同时打开多个文件，Ctrl+Tab 快速切换
- 代码块语言选择器 — 40+ 编程语言，实时语法高亮
- KaTeX 数学公式 — 行内 `$...$` 和块级 `$$...$$`
- Mermaid 图表 — 流程图、时序图、甘特图等
- Typora 风格查找替换 — 浮动面板，支持计数和循环搜索
- 右键上下文菜单 — 快速格式化操作
- 深色/浅色主题 — 一键切换
- 图片管理 — 工具栏插入 / 剪贴板粘贴 / 拖放，自动保存
- 导出 HTML / PDF
- 最近文件列表
- 文档大纲 + 实时字数统计
- 全新科技感应用图标

**支持平台：** Windows (x64) / macOS / Linux (AppImage, deb)

## License

[MIT](LICENSE)

---

**MarkFlow** — *让 Markdown 写作更愉快*
