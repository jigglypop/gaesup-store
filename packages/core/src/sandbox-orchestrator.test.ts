import { describe, expect, it } from 'vitest';
import type { IframeSandboxSlot, MicroSandboxManifest, SandboxAuditEvent } from './micro-sandbox';
import { FrontendSandboxOrchestrator, type SandboxRuntimeAdapter, type WasmSandboxHandle } from './sandbox-orchestrator';

describe('FrontendSandboxOrchestrator', () => {
  it('activates a validated wasm slot and stops the previous slot after replacement', async () => {
    const runtime = new FakeSandboxRuntime();
    const events: SandboxAuditEvent[] = [];
    const orchestrator = new FrontendSandboxOrchestrator({
      runtime,
      validateManifest: () => ({ valid: true }),
      onAudit: (event) => events.push(event),
      now: () => 10
    });

    const first = await orchestrator.deploy(wasmManifest('@shop/body', '1.0.0'));
    const second = await orchestrator.deploy(wasmManifest('@shop/body', '1.1.0'));

    expect(first.handle.getMetrics().status).toBe('stopped');
    expect(second.handle.getMetrics().status).toBe('running');
    expect(orchestrator.get(second.coordinate)?.manifest.version).toBe('1.1.0');
    expect(events.some((event) => event.type === 'deployment:validated')).toBe(true);
    expect(events.filter((event) => event.type === 'deployment:activated')).toHaveLength(2);
  });

  it('keeps the active slot when manifest validation fails', async () => {
    const runtime = new FakeSandboxRuntime();
    let allow = true;
    const orchestrator = new FrontendSandboxOrchestrator({
      runtime,
      validateManifest: () => allow
        ? { valid: true }
        : { valid: false, errors: [{ code: 'STORE_SCHEMA_CONFLICT', message: 'bad store' }] }
    });

    const first = await orchestrator.deploy(wasmManifest('@shop/body', '1.0.0'));
    allow = false;

    await expect(orchestrator.deploy(wasmManifest('@shop/body', '2.0.0'))).rejects.toMatchObject({
      code: 'MANIFEST_VALIDATION_FAILED'
    });

    expect(first.handle.getMetrics().status).toBe('running');
    expect(orchestrator.get(first.coordinate)?.manifest.version).toBe('1.0.0');
    expect(runtime.loaded).toHaveLength(1);
  });

  it('rolls back by redeploying the previous manifest for the same 3D coordinate', async () => {
    const runtime = new FakeSandboxRuntime();
    const orchestrator = new FrontendSandboxOrchestrator({
      runtime,
      validateManifest: () => ({ valid: true })
    });

    const first = await orchestrator.deploy(wasmManifest('@shop/body', '1.0.0'));
    await orchestrator.deploy(wasmManifest('@shop/body', '1.1.0'));
    const rollback = await orchestrator.rollback(first.coordinate);

    expect(rollback.manifest.version).toBe('1.0.0');
    expect(orchestrator.get(first.coordinate)?.manifest.version).toBe('1.0.0');
  });
});

class FakeSandboxRuntime implements SandboxRuntimeAdapter {
  loaded: MicroSandboxManifest[] = [];

  async loadWasmContainer(manifest: MicroSandboxManifest): Promise<WasmSandboxHandle> {
    this.loaded.push(manifest);
    return new FakeWasmHandle();
  }

  mountIframeSlot(_target: HTMLElement, manifest: MicroSandboxManifest): IframeSandboxSlot {
    return {
      iframe: {} as HTMLIFrameElement,
      coordinate: {
        route: manifest.sandbox?.coordinate?.route || '/*',
        region: manifest.sandbox?.coordinate?.region || manifest.deployment?.slot || manifest.name,
        layer: 'ui'
      },
      post() {},
      unmount() {}
    };
  }
}

class FakeWasmHandle implements WasmSandboxHandle {
  containerId = `fake:${Math.random()}`;
  private status: 'running' | 'stopped' = 'running';

  async call() {
    return 42;
  }

  getMetrics() {
    return {
      containerId: this.containerId,
      uptimeMs: 0,
      calls: 0,
      status: this.status
    };
  }

  async stop() {
    this.status = 'stopped';
  }
}

function wasmManifest(name: string, version: string): MicroSandboxManifest {
  return {
    manifestVersion: '1.0',
    name,
    version,
    runtime: 'wasm-worker',
    entry: {
      type: 'wasm',
      bytes: new Uint8Array([0]),
      sha256: '0'.repeat(64),
      entrypoint: 'main'
    },
    deployment: {
      slot: 'body',
      releaseId: 'web-1',
      slotVersion: version,
      contractVersion: '1.0.0'
    },
    sandbox: {
      coordinate: {
        route: '/shop',
        region: 'body',
        layer: 'state'
      }
    }
  };
}
