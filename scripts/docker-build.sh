#!/bin/bash

echo "🐳 Building Gaesup WASM Docker Images..."

# 색상 코드
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 설정값
REGISTRY="gaesup"
VERSION=${1:-"latest"}
PLATFORM="wasi/wasm"

echo -e "${BLUE}🏗️  Building WASM containers for platform: ${PLATFORM}${NC}"
echo -e "${BLUE}📋 Registry: ${REGISTRY}${NC}"
echo -e "${BLUE}🏷️  Version: ${VERSION}${NC}"
echo ""

# WASM 빌드가 완료되었는지 확인
if [ ! -f "packages/core-rust/pkg/gaesup_state_core_bg.wasm" ]; then
    echo -e "${YELLOW}⚠️  WASM not found. Building first...${NC}"
    pnpm build:wasm
fi

# 1. Todo 앱 컨테이너 빌드
echo -e "${BLUE}📦 Building Todo App Container...${NC}"
if [ -d "examples/wasm-containers/todo" ]; then
    docker buildx build \
        --platform ${PLATFORM} \
        --tag ${REGISTRY}/todo-app:${VERSION} \
        --file examples/wasm-containers/todo/Dockerfile.wasm \
        examples/wasm-containers/todo/
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Todo app built: ${REGISTRY}/todo-app:${VERSION}${NC}"
    else
        echo -e "${RED}❌ Failed to build todo app${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}⚠️  Todo app directory not found, skipping...${NC}"
fi

# 2. 카운터 컨테이너 빌드  
echo -e "${BLUE}📦 Building Counter Container...${NC}"
if [ -d "examples/wasm-containers/counter" ]; then
    docker buildx build \
        --platform ${PLATFORM} \
        --tag ${REGISTRY}/counter:${VERSION} \
        --file examples/wasm-containers/counter/Dockerfile.wasm \
        examples/wasm-containers/counter/
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Counter built: ${REGISTRY}/counter:${VERSION}${NC}"
    else
        echo -e "${RED}❌ Failed to build counter${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}⚠️  Counter directory not found, skipping...${NC}"
fi

# 3. 벤치마크 컨테이너 빌드
echo -e "${BLUE}📦 Building Benchmark Container...${NC}"
if [ -d "examples/wasm-containers/benchmark" ]; then
    docker buildx build \
        --platform ${PLATFORM} \
        --tag ${REGISTRY}/benchmark:${VERSION} \
        --file examples/wasm-containers/benchmark/Dockerfile.wasm \
        examples/wasm-containers/benchmark/
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Benchmark built: ${REGISTRY}/benchmark:${VERSION}${NC}"
    else
        echo -e "${RED}❌ Failed to build benchmark${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}⚠️  Benchmark directory not found, skipping...${NC}"
fi

# 4. 레지스트리 컨테이너 빌드
echo -e "${BLUE}📦 Building Registry Container...${NC}"
docker buildx build \
    --platform linux/amd64 \
    --tag ${REGISTRY}/container-registry:${VERSION} \
    --file docker/Dockerfile.registry \
    .

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Registry built: ${REGISTRY}/container-registry:${VERSION}${NC}"
else
    echo -e "${RED}❌ Failed to build registry${NC}"
    exit 1
fi

# 5. 모니터링 대시보드 빌드
echo -e "${BLUE}📦 Building Monitoring Dashboard...${NC}"
docker buildx build \
    --platform linux/amd64 \
    --tag ${REGISTRY}/monitoring-dashboard:${VERSION} \
    --file docker/Dockerfile.monitoring \
    .

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Monitoring built: ${REGISTRY}/monitoring-dashboard:${VERSION}${NC}"
else
    echo -e "${RED}❌ Failed to build monitoring${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}🎉 All containers built successfully!${NC}"
echo ""
echo "📋 Built images:"
echo "  - ${REGISTRY}/todo-app:${VERSION}"
echo "  - ${REGISTRY}/counter:${VERSION}"
echo "  - ${REGISTRY}/benchmark:${VERSION}"
echo "  - ${REGISTRY}/container-registry:${VERSION}"
echo "  - ${REGISTRY}/monitoring-dashboard:${VERSION}"
echo ""
echo "🚀 To deploy: pnpm docker:deploy"
echo "📊 To check: docker images | grep ${REGISTRY}" 