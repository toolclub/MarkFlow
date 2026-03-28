#!/bin/bash
# ============================================
# MarkFlow - 安装与构建脚本
# ============================================

set -e

echo "╔══════════════════════════════════════╗"
echo "║     MarkFlow - Markdown 编辑器       ║"
echo "║     安装与构建脚本                   ║"
echo "╚══════════════════════════════════════╝"
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 未找到 Node.js，请先安装 Node.js (v18+)"
    echo "   推荐使用 nvm: https://github.com/nvm-sh/nvm"
    echo "   或直接下载: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
echo "✅ Node.js 版本: $(node -v)"

if [ "$NODE_VERSION" -lt 18 ]; then
    echo "⚠️  建议使用 Node.js v18 或更高版本"
fi

# 检查 npm
if ! command -v npm &> /dev/null; then
    echo "❌ 未找到 npm"
    exit 1
fi
echo "✅ npm 版本: $(npm -v)"

echo ""
echo "📦 正在安装依赖..."
npm install

echo ""
echo "======================================"
echo "安装完成! 你可以："
echo ""
echo "  🚀 运行开发模式:"
echo "     npm start"
echo ""
echo "  📦 构建可执行文件:"
echo "     npm run build:linux    # Linux (AppImage + deb)"
echo "     npm run build:win      # Windows (exe)"
echo "     npm run build:mac      # macOS (dmg)"
echo ""
echo "  构建完成后，可执行文件在 dist/ 目录中"
echo "======================================"

# 询问是否立即运行
read -p "是否立即启动 MarkFlow? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    npm start
fi
