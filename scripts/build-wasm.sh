#!/bin/bash

echo "🦀 Building Rust WASM Core..."

# 색상 코드
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Rust 설치 확인
if ! command -v rustc &> /dev/null; then
    echo -e "${RED}❌ Rust가 설치되어 있지 않습니다.${NC}"
    echo "https://rustup.rs/ 에서 Rust를 설치해주세요."
    exit 1
fi

# wasm-pack 설치 확인
if ! command -v wasm-pack &> /dev/null; then
    echo "📦 wasm-pack 설치 중..."
    curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
fi

# 작업 디렉토리 이동
cd packages/core-rust

# 이전 빌드 정리
echo "🧹 이전 빌드 정리..."
rm -rf pkg pkg-* target/wasm32-unknown-unknown

# WASM 빌드 (여러 타겟)
echo "🔨 WASM 빌드 시작..."

# Web 타겟
echo "  📱 Web 타겟 빌드..."
wasm-pack build --target web --out-dir pkg-web \
    --no-typescript \
    -- --features "wasm"

# Node.js 타겟
echo "  🟢 Node.js 타겟 빌드..."
wasm-pack build --target nodejs --out-dir pkg-node \
    --no-typescript \
    -- --features "wasm"

# Bundler 타겟 (webpack, vite 등)
echo "  📦 Bundler 타겟 빌드..."
wasm-pack build --target bundler --out-dir pkg \
    -- --features "wasm"

# WASM 최적화
echo "⚡ WASM 최적화..."
if command -v wasm-opt &> /dev/null; then
    wasm-opt -Oz -o pkg/gaesup_state_core_bg.wasm pkg/gaesup_state_core_bg.wasm
    wasm-opt -Oz -o pkg-web/gaesup_state_core_bg.wasm pkg-web/gaesup_state_core_bg.wasm
    wasm-opt -Oz -o pkg-node/gaesup_state_core_bg.wasm pkg-node/gaesup_state_core_bg.wasm
    echo -e "${GREEN}✅ WASM 최적화 완료${NC}"
else
    echo "⚠️  wasm-opt가 설치되어 있지 않아 최적화를 건너뜁니다."
    echo "   binaryen을 설치하면 더 작은 WASM 파일을 생성할 수 있습니다."
fi

# TypeScript 정의 파일 생성
echo "📝 TypeScript 정의 파일 생성..."
cat > pkg/index.d.ts << 'EOF'
/* tslint:disable */
/* eslint-disable */

export function create_store(store_id: string, initial_state: any): void;
export function dispatch(store_id: string, action_type: string, payload: any): any;
export function select(store_id: string, path: string): any;
export function subscribe(store_id: string, path: string, callback_id: string): string;
export function unsubscribe(subscription_id: string): void;
export function create_snapshot(store_id: string): string;
export function restore_snapshot(store_id: string, snapshot_id: string): any;
export function get_metrics(store_id: string): any;
export function cleanup_store(store_id: string): void;
export function garbage_collect(): void;

export class BatchUpdate {
  constructor(store_id: string);
  add_update(action_type: string, payload: any): void;
  execute(): any;
}

export default function init(module?: any): Promise<void>;
EOF

# 동일한 파일을 다른 타겟에도 복사
cp pkg/index.d.ts pkg-web/
cp pkg/index.d.ts pkg-node/

# package.json 업데이트
echo "📦 package.json 업데이트..."
for dir in pkg pkg-web pkg-node; do
    if [ -f "$dir/package.json" ]; then
        # package.json에 main과 types 필드 추가
        node -e "
        const fs = require('fs');
        const pkg = JSON.parse(fs.readFileSync('$dir/package.json', 'utf8'));
        pkg.name = 'gaesup-state-core-rust';
        pkg.types = 'index.d.ts';
        if ('$dir' === 'pkg-node') {
            pkg.main = 'gaesup_state_core.js';
        }
        fs.writeFileSync('$dir/package.json', JSON.stringify(pkg, null, 2));
        "
    fi
done

# 빌드 크기 리포트
echo ""
echo "📊 빌드 크기 리포트:"
echo "  Web:     $(du -sh pkg-web/gaesup_state_core_bg.wasm | cut -f1)"
echo "  Node:    $(du -sh pkg-node/gaesup_state_core_bg.wasm | cut -f1)"
echo "  Bundler: $(du -sh pkg/gaesup_state_core_bg.wasm | cut -f1)"

echo ""
echo -e "${GREEN}✅ WASM 빌드 완료!${NC}"
echo ""
echo "사용 방법:"
echo "  Web:     import init from 'gaesup-state-core-rust/web'"
echo "  Node:    const wasm = require('gaesup-state-core-rust/node')"
echo "  Bundler: import * as wasm from 'gaesup-state-core-rust'" 
