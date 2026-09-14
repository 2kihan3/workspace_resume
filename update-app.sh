#!/bin/bash
# 一键更新已安装的「求职工作台」应用：构建 → 安装 → 清隔离属性
set -eo pipefail
cd "$(dirname "$0")"
source ~/.cargo/env

echo "==> 构建正式包（约 2-3 分钟）..."
pnpm tauri build 2>&1 | tail -2

echo "==> 安装到 /Applications ..."
rm -rf "/Applications/求职工作台.app"
cp -R "target/release/bundle/macos/求职工作台.app" /Applications/
xattr -cr "/Applications/求职工作台.app" 2>/dev/null || true

echo "==> 完成。双击 /Applications/求职工作台 即可使用。"
