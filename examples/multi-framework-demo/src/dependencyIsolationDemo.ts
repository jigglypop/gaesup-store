import {
  CompatibilityGuard,
  type ContainerPackageManifest,
  type HostCompatibilityConfig
} from '@gaesup-state/core';

type Scenario = {
  title: string;
  intent: string;
  executionMode: 'shared' | 'packaged' | 'isolated' | 'blocked';
  manifest: ContainerPackageManifest;
};

const hostConfig: HostCompatibilityConfig = {
  hostVersion: '0.2.0',
  abiVersion: '1.0.0',
  defaultConflictPolicy: 'reject',
  dependencies: [
    { name: 'date-fns', version: '2.30.0' },
    { name: 'zod', version: '3.23.8' },
    { name: 'chart.js', version: '4.4.3' }
  ],
  stores: [
    {
      storeId: 'orders',
      schemaId: 'orders-state',
      schemaVersion: '1.2.0'
    },
    {
      storeId: 'analytics',
      schemaId: 'analytics-state',
      schemaVersion: '2.1.0'
    }
  ]
};

const scenarios: Scenario[] = [
  {
    title: '주문 위젯',
    intent: '호스트의 date-fns 버전과 현재 orders store schema가 모두 맞는 패키지입니다.',
    executionMode: 'shared',
    manifest: {
      manifestVersion: '1.0',
      name: 'orders-widget',
      version: '1.0.0',
      runtime: 'browser',
      gaesup: { abiVersion: '^1.0.0' },
      dependencies: [
        { name: 'date-fns', version: '^2.29.0' }
      ],
      stores: [
        {
          storeId: 'orders',
          schemaId: 'orders-state',
          schemaVersion: '^1.2.0',
          conflictPolicy: 'reject'
        }
      ],
      allowedImports: ['env.memory'],
      permissions: { network: false, storage: 'scoped' }
    }
  },
  {
    title: '레거시 리포트',
    intent: '호스트는 chart.js 4를 쓰지만, 컨테이너가 chart.js 3을 직접 패키징해서 실행하는 예입니다.',
    executionMode: 'packaged',
    manifest: {
      manifestVersion: '1.0',
      name: 'legacy-report',
      version: '0.8.0',
      runtime: 'browser',
      gaesup: { abiVersion: '^1.0.0' },
      dependencies: [
        { name: 'chart.js', version: '^3.9.0', source: 'bundled' }
      ],
      stores: [
        {
          storeId: 'analytics',
          schemaId: 'analytics-state',
          schemaVersion: '^2.0.0',
          conflictPolicy: 'reject'
        }
      ],
      allowedImports: ['env.memory'],
      permissions: { network: false, storage: 'scoped' }
    }
  },
  {
    title: '실험용 체크아웃',
    intent: '실행은 가능하지만, 미래 버전 orders schema를 요구하므로 호스트의 공유 orders store와 격리됩니다.',
    executionMode: 'isolated',
    manifest: {
      manifestVersion: '1.0',
      name: 'experimental-checkout',
      version: '2.0.0-beta.1',
      runtime: 'browser',
      gaesup: { abiVersion: '^1.0.0' },
      dependencies: [
        { name: 'zod', version: '^3.20.0' }
      ],
      stores: [
        {
          storeId: 'orders',
          schemaId: 'orders-state',
          schemaVersion: '^2.0.0',
          conflictPolicy: 'isolate'
        }
      ],
      allowedImports: ['env.memory'],
      permissions: { network: false, storage: 'scoped' }
    }
  },
  {
    title: '안전하지 않은 호스트 플러그인',
    intent: '필요한 chart.js 버전을 컨테이너에 패키징하지 않고 호스트에서 가져오려는 예입니다.',
    executionMode: 'blocked',
    manifest: {
      manifestVersion: '1.0',
      name: 'unsafe-host-plugin',
      version: '1.0.0',
      runtime: 'browser',
      gaesup: { abiVersion: '^1.0.0' },
      dependencies: [
        { name: 'chart.js', version: '^3.9.0', source: 'host' }
      ],
      stores: [
        {
          storeId: 'analytics',
          schemaId: 'analytics-state',
          schemaVersion: '^2.0.0',
          conflictPolicy: 'reject'
        }
      ],
      allowedImports: ['env.memory'],
      permissions: { network: false, storage: 'scoped' }
    }
  }
];

export function mountDependencyIsolationDemo(elementId: string) {
  const element = document.getElementById(elementId);
  if (!element) {
    return;
  }

  const guard = new CompatibilityGuard(hostConfig);
  const decisions = scenarios.map((scenario) => ({
    scenario,
    decision: guard.validate(scenario.manifest)
  }));

  element.innerHTML = `
    <section class="isolation-page">
      <div class="section-heading">
        <div>
          <h2>의존성 격리 확인</h2>
          <p>
            컨테이너는 자기 의존성을 함께 패키징해서 실행할 수 있습니다.
            호스트 의존성 충돌은 패키지가 호스트 복사본을 쓰겠다고 선언한 경우에만 실행을 막습니다.
            store 충돌은 별도로 다룹니다. schema가 맞으면 공유 store를 쓰고,
            schema가 맞지 않으면 격리 store namespace에서 실행해야 합니다.
          </p>
        </div>
      </div>

      <div class="isolation-layout">
        <article class="host-card">
          <h3>호스트 계약</h3>
          <div class="contract-list">
            <div>
              <span>ABI</span>
              <strong>${hostConfig.abiVersion}</strong>
            </div>
            <div>
              <span>기본 충돌 정책</span>
              <strong>${hostConfig.defaultConflictPolicy}</strong>
            </div>
          </div>

          <h4>호스트 제공 의존성</h4>
          <ul>
            ${hostConfig.dependencies?.map((dependency) => `
              <li><code>${dependency.name}</code><span>${dependency.version}</span></li>
            `).join('')}
          </ul>

          <h4>등록된 store</h4>
          <ul>
            ${hostConfig.stores?.map((store) => `
              <li><code>${store.storeId}</code><span>${store.schemaId}@${store.schemaVersion}</span></li>
            `).join('')}
          </ul>
        </article>

        <div class="scenario-list">
          ${decisions.map(({ scenario, decision }, index) => `
            <article class="scenario-card ${getScenarioClass(scenario, decision)}" data-scenario="${index}">
              <div class="scenario-topline">
                <h3>${scenario.title}</h3>
                <span>${getScenarioStatus(scenario, decision)}</span>
              </div>
              <p>${scenario.intent}</p>
              <div class="manifest-grid">
                <div>
                  <span>패키지</span>
                  <strong>${scenario.manifest.name}@${scenario.manifest.version}</strong>
                </div>
                <div>
                  <span>의존성</span>
                  <strong>${formatDependencies(scenario.manifest)}</strong>
                </div>
                <div>
                  <span>Store 계약</span>
                  <strong>${formatStores(scenario.manifest)}</strong>
                </div>
              </div>
              ${decision.errors.length > 0 ? `
                <div class="decision-details">
                  ${decision.errors.map((error) => `
                    <div class="decision-error">
                      <code>${error.code}</code>
                      <span>${formatIssueMessage(error.code, error.message)}</span>
                    </div>
                  `).join('')}
                </div>
              ` : `
                <div class="decision-details">
                  <div class="${decision.isolatedStores.length ? 'decision-isolated' : 'decision-ok'}">
                    ${getExecutionSummary(scenario, decision)}
                  </div>
                  ${decision.warnings.map((warning) => `
                    <div class="decision-warning">
                      <code>${warning.code}</code>
                      <span>${formatIssueMessage(warning.code, warning.message)}</span>
                    </div>
                  `).join('')}
                </div>
              `}
            </article>
          `).join('')}
        </div>
      </div>
    </section>
  `;
}

function formatDependencies(manifest: ContainerPackageManifest) {
  return manifest.dependencies?.map((dependency) => {
    const source = dependency.source === 'bundled' ? '컨테이너 패키징' : '호스트 제공';
    return `${dependency.name}@${dependency.version} (${source})`;
  }).join(', ') || 'None';
}

function formatStores(manifest: ContainerPackageManifest) {
  return manifest.stores?.map((store) => {
    const policy = formatPolicy(store.conflictPolicy || 'reject');
    return `${store.storeId}:${store.schemaId}@${store.schemaVersion} (${policy})`;
  }).join(', ') || 'None';
}

function formatPolicy(policy: string) {
  if (policy === 'reject') return '충돌 시 차단';
  if (policy === 'isolate') return '충돌 시 격리';
  if (policy === 'readonly') return '충돌 시 읽기 전용';
  if (policy === 'migrate') return '충돌 시 마이그레이션';
  return policy;
}

function formatIssueMessage(code: string, fallback: string) {
  if (code === 'PACKAGE_DEPENDENCY_BUNDLED') {
    return '이 의존성은 컨테이너에 함께 패키징되어 있어 호스트 의존성 버전을 바꾸지 않습니다.';
  }

  if (code === 'PACKAGE_DEPENDENCY_VERSION_MISMATCH') {
    return '패키지가 호스트 의존성을 사용하겠다고 선언했지만, 필요한 버전과 호스트 제공 버전이 맞지 않습니다.';
  }

  if (code === 'STORE_SCHEMA_CONFLICT') {
    return '패키지가 요구하는 store schema와 호스트에 등록된 store schema가 맞지 않습니다.';
  }

  return fallback;
}

function getScenarioClass(
  scenario: Scenario,
  decision: ReturnType<CompatibilityGuard['validate']>
) {
  if (!decision.valid) return 'fail';
  if (scenario.executionMode === 'isolated' || decision.isolatedStores.length > 0) return 'isolated';
  if (scenario.executionMode === 'packaged') return 'packaged';
  return 'pass';
}

function getScenarioStatus(
  scenario: Scenario,
  decision: ReturnType<CompatibilityGuard['validate']>
) {
  if (!decision.valid) return '차단';
  if (scenario.executionMode === 'isolated' || decision.isolatedStores.length > 0) return '격리 실행';
  if (scenario.executionMode === 'packaged') return '패키징 실행';
  return '공유 실행';
}

function getExecutionSummary(
  scenario: Scenario,
  decision: ReturnType<CompatibilityGuard['validate']>
) {
  if (scenario.executionMode === 'isolated' || decision.isolatedStores.length > 0) {
    return `실행 가능. ${decision.isolatedStores.join(', ')} 공유 store 접근은 거부되고, 컨테이너는 격리된 store namespace를 받습니다.`;
  }

  if (scenario.executionMode === 'packaged') {
    return '실행 가능. 충돌하는 라이브러리 버전은 컨테이너 안에 패키징되어 있으므로 호스트 의존성 그래프를 바꾸지 않습니다.';
  }

  return '실행 가능. 패키지 의존성과 store schema가 호스트와 맞기 때문에 공유 store 계약을 사용할 수 있습니다.';
}
