#!/usr/bin/env bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()    { echo -e "${CYAN}ℹ${NC}  $1"; }
success() { echo -e "${GREEN}✅${NC} $1"; }
warn()    { echo -e "${YELLOW}⚠${NC}  $1"; }
error()   { echo -e "${RED}❌${NC} $1"; exit 1; }

# Check for uncommitted changes
if [[ -n $(git status --porcelain) ]]; then
  error "有未提交的更改，请先提交"
fi

# Get current version
CURRENT_VERSION=$(node -p "require('./package.json').version")
info "当前版本: v${CURRENT_VERSION}"

# Get version bump type
BUMP_TYPE=${1:-patch}
if [[ "$BUMP_TYPE" != "patch" && "$BUMP_TYPE" != "minor" && "$BUMP_TYPE" != "major" ]]; then
  error "用法: ./release.sh [patch|minor|major]"
fi

# Calculate new version
NEW_VERSION=$(node -p "require('semver').inc('${CURRENT_VERSION}', '${BUMP_TYPE}')")
info "新版本: v${NEW_VERSION}"

# Confirm
echo ""
read -rp "  确认发布 v${NEW_VERSION}? (y/n): " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  info "已取消"
  exit 0
fi
echo ""

# Update package.json version
info "更新 package.json..."
npm version ${BUMP_TYPE} --no-git-tag-version

# Update CHANGELOG.md
info "更新 CHANGELOG.md..."
TODAY=$(date +%Y-%m-%d)
CHANGELOG_HEADER="## [${NEW_VERSION}] - ${TODAY}

### Changed

-

"

# Insert new version after the header
sed -i.bak "/## \[0.1.0\]/i ${CHANGELOG_HEADER}" CHANGELOG.md
rm -f CHANGELOG.md.bak

# Remind user to update CHANGELOG
warn "请编辑 CHANGELOG.md 添加变更内容，然后继续"
read -rp "  按 Enter 继续..."

# Commit changes
info "提交更改..."
git add package.json CHANGELOG.md
git commit -m "chore: release v${NEW_VERSION}"

# Create tag
info "创建 tag v${NEW_VERSION}..."
git tag v${NEW_VERSION}

# Push
info "推送到远程..."
git push origin main --tags

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
success "发布准备完成!"
echo ""
dim() { echo -e "\033[0;37m$1\033[0m"; }
dim "接下来:"
dim "  1. 打开 https://github.com/suj1e/larkcc/releases/new"
dim "  2. 选择 tag: v${NEW_VERSION}"
dim "  3. 填写 Release 信息"
dim "  4. 点击 Publish release"
dim "  5. GitHub Actions 会自动发布到 npm"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
