#!/usr/bin/env bash
set -e

PACKAGE_NAME="larkcc"
MIN_NODE_VERSION=18
MIN_PNPM_VERSION=8

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;37m'
NC='\033[0m'

info()    { echo -e "${CYAN}ℹ${NC}  $1"; }
success() { echo -e "${GREEN}✅${NC} $1"; }
warn()    { echo -e "${YELLOW}⚠${NC}  $1"; }
error()   { echo -e "${RED}❌${NC} $1"; exit 1; }
dim()     { echo -e "${GRAY}   $1${NC}"; }

echo ""
echo -e "${CYAN}  larkcc installer${NC}"
echo -e "${GRAY}  Claude Code in Feishu${NC}"
echo ""

# ── 检测是否已安装 ────────────────────────────────────────────
if command -v $PACKAGE_NAME &>/dev/null; then
  INSTALLED_VERSION=$(larkcc --version 2>/dev/null || echo "unknown")
  warn "larkcc is already installed (version: ${INSTALLED_VERSION})"
  echo ""
  read -rp "  Reinstall? (y/n): " CONFIRM
  if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
    info "Installation cancelled"
    exit 0
  fi
  echo ""
  info "Uninstalling existing version..."
  npm uninstall -g $PACKAGE_NAME 2>/dev/null || true
  success "Old version removed"
  echo ""
fi

# ── 检测 Node.js ──────────────────────────────────────────────
info "Checking Node.js..."
if ! command -v node &>/dev/null; then
  error "Node.js not found. Install from https://nodejs.org (v${MIN_NODE_VERSION}+)"
fi
NODE_VERSION=$(node -e "console.log(process.versions.node.split('.')[0])")
if [[ "$NODE_VERSION" -lt "$MIN_NODE_VERSION" ]]; then
  error "Node.js v${NODE_VERSION} is too old. Need v${MIN_NODE_VERSION}+"
fi
success "Node.js v$(node --version)"

# ── 检测 pnpm ─────────────────────────────────────────────────
info "Checking pnpm..."
# 禁用 corepack 避免签名验证问题
corepack disable 2>/dev/null || true
if ! command -v pnpm &>/dev/null; then
  warn "pnpm not found, installing..."
  npm install -g pnpm
fi
success "pnpm v$(pnpm --version)"

# ── 检测 Claude CLI ───────────────────────────────────────────
info "Checking Claude CLI..."
if ! command -v claude &>/dev/null; then
  error "Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code"
fi
success "Claude CLI: $(which claude)"

# ── 安装依赖 ──────────────────────────────────────────────────
info "Installing dependencies..."
if [ -f "pnpm-lock.yaml" ]; then
  pnpm install --frozen-lockfile
else
  pnpm i
fi
success "Dependencies installed"

# ── 构建 ─────────────────────────────────────────────────────
info "Building..."
pnpm build
success "Build complete"

# ── 全局安装 ──────────────────────────────────────────────────
info "Installing larkcc globally..."
npm install -g .
success "larkcc installed globally"

# ── 创建目录 ───────────────────────────────────────────────────
info "Creating directories..."
mkdir -p ~/.larkcc/temp
success "Created ~/.larkcc/temp"

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
success "Installation complete!"
echo ""
dim "Run in your project directory:"
echo ""
echo -e "  ${CYAN}cd /your/project${NC}"
echo -e "  ${CYAN}larkcc${NC}"
echo ""
dim "First run will guide you through setup."
dim "Config will be saved to ~/.larkcc/config.yml"
echo ""
dim "Other commands:"
dim "  larkcc --setup              reconfigure"
dim "  larkcc --reset-session      clear Claude session"
dim "  larkcc --ps                 show running processes"
dim "  larkcc --cleanup-tmp-files  clean temporary files"
dim "  larkcc -d                   run in background"
echo ""
dim "Multi-file mode:"
dim "  /mf start                   start multi-file mode"
dim "  /mf done                    process cached files"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
