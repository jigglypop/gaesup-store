#!/bin/bash

echo "🚀 Deploying Gaesup WASM Containers..."

# 색상 코드
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 설정값
COMPOSE_FILE="docker/docker-compose.wasm.yml"
PROJECT_NAME="gaesup-wasm"

# Docker와 docker-compose 설치 확인
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker가 설치되어 있지 않습니다.${NC}"
    echo "https://docs.docker.com/get-docker/ 에서 Docker를 설치해주세요."
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}❌ docker-compose가 설치되어 있지 않습니다.${NC}"
    echo "https://docs.docker.com/compose/install/ 에서 docker-compose를 설치해주세요."
    exit 1
fi

# WASM 런타임 지원 확인
echo -e "${BLUE}🔍 Checking WASM runtime support...${NC}"

# WasmEdge 확인
if docker info | grep -q "wasmedge"; then
    echo -e "${GREEN}✅ WasmEdge runtime detected${NC}"
    WASMEDGE_AVAILABLE=true
else
    echo -e "${YELLOW}⚠️  WasmEdge runtime not available${NC}"
    WASMEDGE_AVAILABLE=false
fi

# Wasmtime 확인  
if docker info | grep -q "wasmtime"; then
    echo -e "${GREEN}✅ Wasmtime runtime detected${NC}"
    WASMTIME_AVAILABLE=true
else
    echo -e "${YELLOW}⚠️  Wasmtime runtime not available${NC}"
    WASMTIME_AVAILABLE=false
fi

# 기존 컨테이너 정리
echo -e "${BLUE}🧹 Cleaning up existing containers...${NC}"
docker-compose -f ${COMPOSE_FILE} -p ${PROJECT_NAME} down --remove-orphans

# 네트워크 생성
echo -e "${BLUE}🌐 Creating network...${NC}"
docker network create gaesup-network 2>/dev/null || echo "Network already exists"

# 이미지 빌드 (필요한 경우)
echo -e "${BLUE}🏗️  Building images if needed...${NC}"
if [ ! "$(docker images -q gaesup/container-registry:latest 2> /dev/null)" ]; then
    echo "Building registry image..."
    pnpm docker:build
fi

# 컴포즈 배포
echo -e "${BLUE}🚀 Deploying containers...${NC}"
docker-compose -f ${COMPOSE_FILE} -p ${PROJECT_NAME} up -d

# 배포 상태 확인
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Deployment successful!${NC}"
    echo ""
    
    # 컨테이너 상태 출력
    echo -e "${BLUE}📋 Container Status:${NC}"
    docker-compose -f ${COMPOSE_FILE} -p ${PROJECT_NAME} ps
    echo ""
    
    # 서비스 URL 출력
    echo -e "${BLUE}🌐 Service URLs:${NC}"
    echo "  - Registry:    http://localhost:5000"
    echo "  - Frontend:    http://localhost:3000"  
    echo "  - Monitoring:  http://localhost:8080"
    echo ""
    
    # 헬스 체크
    echo -e "${BLUE}🏥 Health Check:${NC}"
    
    # Registry 헬스 체크
    sleep 5
    if curl -f http://localhost:5000/v2/ &>/dev/null; then
        echo -e "${GREEN}✅ Registry is healthy${NC}"
    else
        echo -e "${YELLOW}⚠️  Registry not responding yet${NC}"
    fi
    
    # Frontend 헬스 체크
    if curl -f http://localhost:3000 &>/dev/null; then
        echo -e "${GREEN}✅ Frontend is healthy${NC}"
    else
        echo -e "${YELLOW}⚠️  Frontend not responding yet${NC}"
    fi
    
    echo ""
    echo -e "${BLUE}📝 Useful Commands:${NC}"
    echo "  - View logs:     pnpm docker:wasm:logs"
    echo "  - Stop services: pnpm docker:wasm:down"
    echo "  - Restart:       pnpm docker:wasm:restart"
    echo "  - Container CLI: pnpm gaesup list"
    
else
    echo -e "${RED}❌ Deployment failed!${NC}"
    echo ""
    echo "Checking logs..."
    docker-compose -f ${COMPOSE_FILE} -p ${PROJECT_NAME} logs
    exit 1
fi

# WASM 런타임별 주의사항 출력
echo ""
echo -e "${YELLOW}📋 WASM Runtime Notes:${NC}"

if [ "$WASMEDGE_AVAILABLE" = false ]; then
    echo -e "${YELLOW}⚠️  WasmEdge not available. Install with:${NC}"
    echo "   curl -sSf https://raw.githubusercontent.com/WasmEdge/WasmEdge/master/utils/install.sh | bash"
fi

if [ "$WASMTIME_AVAILABLE" = false ]; then
    echo -e "${YELLOW}⚠️  Wasmtime not available. Install with:${NC}"
    echo "   curl https://wasmtime.dev/install.sh -sSf | bash"
fi

echo ""
echo -e "${GREEN}🎉 Gaesup WASM containers are now running!${NC}" 