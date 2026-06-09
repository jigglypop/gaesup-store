import {
  IframeSandboxSlot,
  MicroSandboxManifest,
  MicroSandboxRuntime,
  SandboxAuditEvent,
  SandboxCoordinate,
  SandboxRuntimeError,
  WasmWorkerSandboxContainer,
  resolveSandboxCoordinate,
  sandboxCoordinateKey
} from './micro-sandbox';

export interface SandboxValidationIssue {
  code: string;
  message: string;
  severity?: 'error' | 'warning';
  target?: string;
}

export interface SandboxValidationResult {
  valid: boolean;
  errors?: SandboxValidationIssue[];
  warnings?: SandboxValidationIssue[];
  isolatedStores?: string[];
}

export type SandboxManifestValidator = (
  manifest: MicroSandboxManifest
) => SandboxValidationResult | Promise<SandboxValidationResult>;

export interface SandboxRuntimeAdapter {
  loadWasmContainer(manifest: MicroSandboxManifest): Promise<WasmSandboxHandle>;
  mountIframeSlot(target: HTMLElement, manifest: MicroSandboxManifest): IframeSandboxSlot;
  onAudit?(listener: (event: SandboxAuditEvent) => void): () => void;
}

export interface SandboxOrchestratorOptions {
  runtime?: SandboxRuntimeAdapter;
  validateManifest?: SandboxManifestValidator;
  onAudit?: (event: SandboxAuditEvent) => void;
  now?: () => number;
}

export interface DeploySandboxOptions {
  target?: HTMLElement;
  validate?: boolean;
  stopPrevious?: 'after-start' | 'never';
}

export interface RollbackSandboxOptions {
  target?: HTMLElement;
}

export interface SandboxSlotRecord {
  key: string;
  coordinate: SandboxCoordinate;
  manifest: MicroSandboxManifest;
  handle: SandboxHandle;
  kind: 'wasm-worker' | 'iframe';
  validation?: SandboxValidationResult;
  target?: HTMLElement;
  deployedAt: number;
}

export type SandboxHandle = WasmSandboxHandle | IframeSandboxSlot;

export type WasmSandboxHandle = Pick<WasmWorkerSandboxContainer, 'call' | 'getMetrics' | 'stop'> & {
  containerId?: string;
};

interface SlotHistoryRecord {
  manifest: MicroSandboxManifest;
  target?: HTMLElement;
}

export class FrontendSandboxOrchestrator {
  private readonly runtime: SandboxRuntimeAdapter;
  private readonly activeSlots = new Map<string, SandboxSlotRecord>();
  private readonly history = new Map<string, SlotHistoryRecord[]>();
  private readonly auditListeners = new Set<(event: SandboxAuditEvent) => void>();

  constructor(private readonly options: SandboxOrchestratorOptions = {}) {
    this.runtime = options.runtime || new MicroSandboxRuntime();
    if (options.onAudit) this.auditListeners.add(options.onAudit);
    this.runtime.onAudit?.((event) => this.emit(event));
  }

  onAudit(listener: (event: SandboxAuditEvent) => void) {
    this.auditListeners.add(listener);
    return () => this.auditListeners.delete(listener);
  }

  async deploy(manifest: MicroSandboxManifest, options: DeploySandboxOptions = {}) {
    const coordinate = resolveSandboxCoordinate(manifest);
    const key = sandboxCoordinateKey(coordinate);
    const previous = this.activeSlots.get(key);
    const validation = await this.validate(manifest, options);
    const kind = sandboxKind(manifest);

    let handle: SandboxHandle;
    if (kind === 'iframe') {
      if (!options.target && !previous?.target) {
        throw new SandboxRuntimeError('IFRAME_TARGET_REQUIRED', `Iframe sandbox ${manifest.name} needs a target element`);
      }
      handle = this.runtime.mountIframeSlot(options.target || previous!.target!, manifest);
    } else {
      handle = await this.runtime.loadWasmContainer(manifest);
    }

    const record: SandboxSlotRecord = {
      key,
      coordinate,
      manifest,
      handle,
      kind,
      validation,
      target: options.target || previous?.target,
      deployedAt: this.now()
    };

    this.activeSlots.set(key, record);
    if (previous) {
      this.pushHistory(key, previous);
      if (options.stopPrevious !== 'never') await stopSandboxHandle(previous.handle);
    }

    this.emit({
      type: 'deployment:activated',
      manifestName: manifest.name,
      coordinate,
      containerId: getContainerId(handle),
      details: {
        key,
        kind,
        previous: previous?.manifest.name
      }
    });

    return record;
  }

  async rollback(coordinate: SandboxCoordinate, options: RollbackSandboxOptions = {}) {
    const key = sandboxCoordinateKey(coordinate);
    const previous = this.history.get(key)?.pop();
    if (!previous) {
      throw new SandboxRuntimeError('ROLLBACK_TARGET_MISSING', `No previous sandbox slot exists for ${key}`);
    }

    const record = await this.deploy(previous.manifest, {
      target: options.target || previous.target,
      stopPrevious: 'after-start'
    });
    this.emit({
      type: 'deployment:rolled-back',
      manifestName: record.manifest.name,
      coordinate: record.coordinate,
      containerId: getContainerId(record.handle),
      details: { key }
    });
    return record;
  }

  get(coordinate: SandboxCoordinate) {
    return this.activeSlots.get(sandboxCoordinateKey(coordinate));
  }

  list(filter: Partial<Pick<SandboxCoordinate, 'route' | 'region' | 'layer'>> = {}) {
    return [...this.activeSlots.values()].filter(({ coordinate }) => (
      (filter.route === undefined || coordinate.route === filter.route) &&
      (filter.region === undefined || coordinate.region === filter.region) &&
      (filter.layer === undefined || coordinate.layer === filter.layer)
    ));
  }

  async stop(coordinate: SandboxCoordinate) {
    const key = sandboxCoordinateKey(coordinate);
    const record = this.activeSlots.get(key);
    if (!record) return false;
    this.activeSlots.delete(key);
    await stopSandboxHandle(record.handle);
    return true;
  }

  async stopAll() {
    const records = [...this.activeSlots.values()];
    this.activeSlots.clear();
    await Promise.all(records.map((record) => stopSandboxHandle(record.handle)));
  }

  private async validate(manifest: MicroSandboxManifest, options: DeploySandboxOptions) {
    if (options.validate === false || !this.options.validateManifest) {
      return undefined;
    }

    const result = await this.options.validateManifest(manifest);
    const coordinate = resolveSandboxCoordinate(manifest);
    if (!result.valid) {
      this.emit({
        type: 'deployment:blocked',
        manifestName: manifest.name,
        coordinate,
        code: result.errors?.[0]?.code || 'MANIFEST_VALIDATION_FAILED',
        message: result.errors?.[0]?.message || `Manifest ${manifest.name} failed validation`,
        details: {
          errors: result.errors || [],
          warnings: result.warnings || []
        }
      });
      throw new SandboxRuntimeError(
        'MANIFEST_VALIDATION_FAILED',
        result.errors?.[0]?.message || `Manifest ${manifest.name} failed validation`,
        { errors: result.errors || [], warnings: result.warnings || [] }
      );
    }

    this.emit({
      type: 'deployment:validated',
      manifestName: manifest.name,
      coordinate,
      details: {
        warnings: result.warnings || [],
        isolatedStores: result.isolatedStores || []
      }
    });
    return result;
  }

  private pushHistory(key: string, record: SandboxSlotRecord) {
    const items = this.history.get(key) || [];
    items.push({
      manifest: record.manifest,
      target: record.target
    });
    this.history.set(key, items);
  }

  private now() {
    return this.options.now?.() || Date.now();
  }

  private emit(event: Omit<SandboxAuditEvent, 'timestamp'> | SandboxAuditEvent) {
    const output: SandboxAuditEvent = {
      ...event,
      timestamp: 'timestamp' in event ? event.timestamp : this.now()
    };
    this.auditListeners.forEach((listener) => listener(output));
  }
}

function sandboxKind(manifest: MicroSandboxManifest): SandboxSlotRecord['kind'] {
  if (manifest.runtime === 'iframe' || manifest.entry?.type === 'iframe') return 'iframe';
  return 'wasm-worker';
}

async function stopSandboxHandle(handle: SandboxHandle) {
  if ('stop' in handle) {
    await handle.stop();
    return;
  }
  handle.unmount();
}

function getContainerId(handle: SandboxHandle) {
  return 'containerId' in handle ? handle.containerId : undefined;
}
