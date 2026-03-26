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
# 禁用 corepack（有签名验证问题），改用 npm 安装
corepack disable 2>/dev/null || true
if ! command -v pnpm &>/dev/null; then
  warn "pnpm not found, installing..."
  npm install -g pnpm
fi
# 确保版本足够新（lockfile 9.0 需要 pnpm 9+）
PNPM_MAJOR=$(pnpm --version | cut -d. -f1)
if [[ "$PNPM_MAJOR" -lt 9 ]]; then
  warn "upgrading pnpm to v9+..."
  npm install -g pnpm@latest
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
# 不使用 --frozen-lockfile，允许 pnpm 自动更新 lockfile
pnpm install
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
dim "Usage:"
echo -e "  ${CYAN}cd /your/project && larkcc${NC}       start in project"
echo -e "  ${CYAN}larkcc -c${NC}                        continue last session"
echo -e "  ${CYAN}larkcc -d${NC}                        run in background"
echo ""
dim "Multi-bot:"
echo -e "  ${CYAN}larkcc --new-profile${NC}            add a new bot"
echo -e "  ${CYAN}larkcc -p <name>${NC}                use specific bot"
echo -e "  ${CYAN}larkcc --list-profiles${NC}          list all bots"
echo ""
dim "Process management:"
echo -e "  ${CYAN}larkcc --ps${NC}                     show running processes"
echo -e "  ${CYAN}larkcc --kill-all${NC}               kill all"
echo ""
dim "More: larkcc --help"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
