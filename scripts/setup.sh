#!/bin/bash

# 색상 코드
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "${BLUE}🚀 Gaesup-State 프로젝트 설정 시작...${NC}"
echo ""

# 1. Node.js 버전 확인
echo "${YELLOW}1. Node.js 버전 확인...${NC}"
NODE_VERSION=$(node -v | cut -d'v' -f2)
REQUIRED_VERSION="18.0.0"

if [ "$(printf '%s\n' "$REQUIRED_VERSION" "$NODE_VERSION" | sort -V | head -n1)" != "$REQUIRED_VERSION" ]; then
    echo "${RED}❌ Node.js 18.0.0 이상이 필요합니다. 현재 버전: v$NODE_VERSION${NC}"
    exit 1
fi
echo "${GREEN}✅ Node.js v$NODE_VERSION${NC}"

# 2. pnpm 설치 확인
echo ""
echo "${YELLOW}2. pnpm 확인...${NC}"
if ! command -v pnpm &> /dev/null; then
    echo "pnpm이 설치되어 있지 않습니다. 설치 중..."
    npm install -g pnpm
fi
echo "${GREEN}✅ pnpm $(pnpm -v)${NC}"

# 3. Rust 설치 확인
echo ""
echo "${YELLOW}3. Rust 확인...${NC}"
if ! command -v rustc &> /dev/null; then
    echo "Rust가 설치되어 있지 않습니다. 설치하시겠습니까? (y/n)"
    read -r INSTALL_RUST
    if [ "$INSTALL_RUST" = "y" ]; then
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
        source "$HOME/.cargo/env"
    else
        echo "${RED}❌ Rust 설치가 필요합니다.${NC}"
        exit 1
    fi
fi
echo "${GREEN}✅ Rust $(rustc --version | cut -d' ' -f2)${NC}"

# 4. wasm-pack 설치 확인
echo ""
echo "${YELLOW}4. wasm-pack 확인...${NC}"
if ! command -v wasm-pack &> /dev/null; then
    echo "wasm-pack 설치 중..."
    curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
fi
echo "${GREEN}✅ wasm-pack $(wasm-pack --version | cut -d' ' -f2)${NC}"

# 5. cargo-watch 설치 (개발 시 유용)
echo ""
echo "${YELLOW}5. cargo-watch 확인...${NC}"
if ! cargo watch --version &> /dev/null 2>&1; then
    echo "cargo-watch 설치 중..."
    cargo install cargo-watch
fi
echo "${GREEN}✅ cargo-watch installed${NC}"

# 6. wasm32 타겟 추가
echo ""
echo "${YELLOW}6. WASM 타겟 설정...${NC}"
rustup target add wasm32-unknown-unknown
echo "${GREEN}✅ wasm32-unknown-unknown target added${NC}"

# 7. 의존성 설치
echo ""
echo "${YELLOW}7. 프로젝트 의존성 설치...${NC}"
pnpm install

# 8. 초기 WASM 빌드
echo ""
echo "${YELLOW}8. WASM 초기 빌드...${NC}"
pnpm run build:wasm

# 9. 환경 설정 파일 생성
echo ""
echo "${YELLOW}9. 환경 설정...${NC}"
if [ ! -f .env.local ]; then
    cat > .env.local << 'EOF'
# Gaesup-State Local Configuration
VITE_WASM_PATH=/packages/core-rust/pkg
VITE_DEV_PORT=5173
VITE_ENABLE_DEVTOOLS=true
EOF
    echo "${GREEN}✅ .env.local 파일 생성됨${NC}"
else
    echo "${BLUE}ℹ️  .env.local 파일이 이미 존재합니다${NC}"
fi

# 10. Git hooks 설정 (선택사항)
echo ""
echo "${YELLOW}10. Git hooks 설정...${NC}"
if [ -d .git ]; then
    cat > .git/hooks/pre-commit << 'EOF'
#!/bin/bash
# Run tests before commit
pnpm test
EOF
    chmod +x .git/hooks/pre-commit
    echo "${GREEN}✅ Git pre-commit hook 설정됨${NC}"
fi

# 11. VS Code 설정 (선택사항)
echo ""
echo "${YELLOW}11. VS Code 설정...${NC}"
if [ ! -d .vscode ]; then
    mkdir -p .vscode
    cat > .vscode/settings.json << 'EOF'
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "rust-lang.rust-analyzer",
  "[typescript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[rust]": {
    "editor.defaultFormatter": "rust-lang.rust-analyzer"
  },
  "rust-analyzer.cargo.features": ["wasm"],
  "typescript.tsdk": "node_modules/typescript/lib"
}
EOF
    
    cat > .vscode/extensions.json << 'EOF'
{
  "recommendations": [
    "rust-lang.rust-analyzer",
    "esbenp.prettier-vscode",
    "dbaeumer.vscode-eslint",
    "svelte.svelte-vscode",
    "Vue.volar"
  ]
}
EOF
    echo "${GREEN}✅ VS Code 설정 파일 생성됨${NC}"
fi

# 12. 성공 메시지
echo ""
echo "${GREEN}🎉 설정 완료!${NC}"
echo ""
echo "${BLUE}다음 명령어로 개발을 시작하세요:${NC}"
echo ""
echo "  ${YELLOW}pnpm dev${NC}          - 개발 서버 시작 (모든 패키지 동시 실행)"
echo "  ${YELLOW}pnpm demo${NC}         - 멀티 프레임워크 데모 실행"
echo "  ${YELLOW}pnpm test${NC}         - 전체 테스트 실행"
echo "  ${YELLOW}pnpm bench${NC}        - 성능 벤치마크 실행"
echo "  ${YELLOW}pnpm bench:compare${NC} - 다른 라이브러리와 성능 비교"
echo ""
echo "${BLUE}문서:${NC}"
echo "  - API 문서: docs/api-reference.md"
echo "  - 빠른 시작: docs/quick-start.md"
echo "  - 성능 가이드: docs/performance.md"
echo ""
echo "${GREEN}Happy coding! 🚀${NC}" 