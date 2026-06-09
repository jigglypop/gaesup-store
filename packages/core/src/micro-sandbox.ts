export type SandboxLayer = 'ui' | 'state' | 'effect' | 'render' | (string & {});

export type SandboxRuntimeKind = 'wasm-worker' | 'iframe' | 'esm' | 'worker';

export interface SandboxCoordinate {
  route: string;
  region: string;
  layer: SandboxLayer;
  slot?: string;
  releaseId?: string;
}

export interface SandboxArtifactEntry {
  type: 'wasm' | 'module' | 'iframe';
  url?: string;
  bytes?: ArrayBuffer | ArrayBufferView;
  html?: string;
  sha256?: string;
  entrypoint?: string;
}

export interface SandboxPermissionContract {
  network?: boolean | { enabled: boolean; allow?: string[] };
  storage?: 'none' | 'scoped' | 'host' | { mode: 'none' | 'scoped' | 'host'; namespace?: string };
  dom?: boolean;
  crossStore?: boolean;
  crossContainer?: boolean;
  effects?: string[];
}

export interface SandboxDeploymentContract {
  slot?: string;
  releaseId?: string;
  slotVersion?: string;
  contractVersion?: string;
  requires?: Array<{
    slot: string;
    releaseId?: string;
    slotVersion?: string;
    contractVersion?: string;
  }>;
}

export interface MicroSandboxManifest {
  manifestVersion: string;
  name: string;
  version: string;
  runtime?: SandboxRuntimeKind | 'wasm';
  entry?: SandboxArtifactEntry;
  wasm?: {
    entrypoint?: string;
    sha256?: string;
    size?: number;
  };
  allowedImports?: string[];
  permissions?: SandboxPermissionContract;
  deployment?: SandboxDeploymentContract;
  sandbox?: {
    coordinate?: Partial<SandboxCoordinate>;
    maxMemoryBytes?: number;
  };
}

export interface SandboxAuditEvent {
  type:
    | 'manifest:resolved'
    | 'artifact:fetched'
    | 'artifact:verified'
    | 'imports:verified'
    | 'worker:started'
    | 'container:started'
    | 'container:called'
    | 'container:stopped'
    | 'deployment:validated'
    | 'deployment:blocked'
    | 'deployment:activated'
    | 'deployment:rolled-back'
    | 'iframe:mounted'
    | 'iframe:unmounted'
    | 'sandbox:error';
  containerId?: string;
  manifestName?: string;
  coordinate?: SandboxCoordinate;
  code?: string;
  message?: string;
  timestamp: number;
  details?: Record<string, unknown>;
}

export interface MicroSandboxRuntimeOptions {
  fetchArtifact?: (url: string) => Promise<ArrayBuffer | ArrayBufferView>;
  createWorker?: (scriptUrl: string, options?: WorkerOptions) => Worker;
  now?: () => number;
  allowUnsignedArtifacts?: boolean;
}

export interface WasmSandboxStartResult {
  containerId: string;
  exports: string[];
  imports: string[];
}

export interface WasmSandboxMetrics {
  containerId: string;
  uptimeMs: number;
  calls: number;
  status: 'running' | 'stopped';
}

export interface IframeSandboxSlot {
  iframe: HTMLIFrameElement;
  coordinate: SandboxCoordinate;
  post(message: unknown, targetOrigin?: string): void;
  unmount(): void;
}

type WorkerReply =
  | { id: number; ok: true; result?: unknown }
  | { id: number; ok: false; error: { code: string; message: string } };

type AuditListener = (event: SandboxAuditEvent) => void;

let sandboxIdSeq = 0;

export class SandboxRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'SandboxRuntimeError';
    Object.setPrototypeOf(this, SandboxRuntimeError.prototype);
  }
}

export class FrontendSandboxGrid<TValue = unknown> {
  private readonly slots = new Map<string, { coordinate: SandboxCoordinate; value: TValue }>();

  upsert(coordinate: SandboxCoordinate, value: TValue) {
    const resolved = normalizeCoordinate(coordinate);
    const key = sandboxCoordinateKey(resolved);
    this.slots.set(key, { coordinate: resolved, value });
    return key;
  }

  get(coordinate: SandboxCoordinate) {
    return this.slots.get(sandboxCoordinateKey(normalizeCoordinate(coordinate)))?.value;
  }

  remove(coordinate: SandboxCoordinate) {
    return this.slots.delete(sandboxCoordinateKey(normalizeCoordinate(coordinate)));
  }

  list(filter: Partial<Pick<SandboxCoordinate, 'route' | 'region' | 'layer'>> = {}) {
    return [...this.slots.values()]
      .filter(({ coordinate }) => (
        (filter.route === undefined || coordinate.route === filter.route) &&
        (filter.region === undefined || coordinate.region === filter.region) &&
        (filter.layer === undefined || coordinate.layer === filter.layer)
      ))
      .map((slot) => ({ ...slot }));
  }
}

export class WasmWorkerSandboxContainer {
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>();
  private messageSeq = 0;
  private calls = 0;
  private status: WasmSandboxMetrics['status'] = 'running';
  private readonly startedAt: number;

  constructor(
    readonly containerId: string,
    readonly manifest: MicroSandboxManifest,
    readonly coordinate: SandboxCoordinate,
    private readonly worker: Worker,
    private readonly workerUrl: string,
    private readonly emitAudit: (event: Omit<SandboxAuditEvent, 'timestamp'>) => void,
    private readonly now: () => number
  ) {
    this.startedAt = now();
    this.worker.addEventListener('message', this.handleWorkerMessage);
    this.worker.addEventListener('error', this.handleWorkerError);
  }

  async call(exportName?: string, args: unknown[] = []) {
    if (this.status !== 'running') {
      throw new SandboxRuntimeError('CONTAINER_STOPPED', `Container ${this.containerId} is stopped`);
    }

    const resolvedExport = exportName || this.manifest.entry?.entrypoint || this.manifest.wasm?.entrypoint || 'main';
    const result = await this.request('call', {
      containerId: this.containerId,
      exportName: resolvedExport,
      args
    });

    this.calls += 1;
    this.emitAudit({
      type: 'container:called',
      containerId: this.containerId,
      manifestName: this.manifest.name,
      coordinate: this.coordinate,
      details: { exportName: resolvedExport }
    });
    return result;
  }

  getMetrics(): WasmSandboxMetrics {
    return {
      containerId: this.containerId,
      uptimeMs: this.now() - this.startedAt,
      calls: this.calls,
      status: this.status
    };
  }

  async stop() {
    if (this.status === 'stopped') return;
    this.status = 'stopped';
    try {
      await this.request('stop', { containerId: this.containerId });
    } finally {
      this.worker.removeEventListener('message', this.handleWorkerMessage);
      this.worker.removeEventListener('error', this.handleWorkerError);
      this.worker.terminate();
      URL.revokeObjectURL(this.workerUrl);
      this.pending.forEach(({ reject }) => {
        reject(new SandboxRuntimeError('CONTAINER_STOPPED', `Container ${this.containerId} was stopped`));
      });
      this.pending.clear();
      this.emitAudit({
        type: 'container:stopped',
        containerId: this.containerId,
        manifestName: this.manifest.name,
        coordinate: this.coordinate
      });
    }
  }

  private request(type: string, payload: Record<string, unknown>) {
    const id = ++this.messageSeq;
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.worker.postMessage({ id, type, payload });
    return promise;
  }

  private readonly handleWorkerMessage = (event: MessageEvent<WorkerReply>) => {
    const reply = event.data;
    const pending = this.pending.get(reply.id);
    if (!pending) return;
    this.pending.delete(reply.id);

    if (reply.ok) {
      pending.resolve(reply.result);
      return;
    }

    pending.reject(new SandboxRuntimeError(reply.error.code, reply.error.message));
  };

  private readonly handleWorkerError = (event: ErrorEvent) => {
    const error = new SandboxRuntimeError('WORKER_ERROR', event.message || 'WASM worker failed');
    this.pending.forEach(({ reject }) => reject(error));
    this.pending.clear();
    this.emitAudit({
      type: 'sandbox:error',
      containerId: this.containerId,
      manifestName: this.manifest.name,
      coordinate: this.coordinate,
      code: error.code,
      message: error.message
    });
  };
}

export class MicroSandboxRuntime {
  private readonly auditListeners = new Set<AuditListener>();
  readonly grid = new FrontendSandboxGrid<WasmWorkerSandboxContainer | IframeSandboxSlot>();

  constructor(private readonly options: MicroSandboxRuntimeOptions = {}) {}

  onAudit(listener: AuditListener) {
    this.auditListeners.add(listener);
    return () => this.auditListeners.delete(listener);
  }

  async loadWasmContainer(manifest: MicroSandboxManifest) {
    const coordinate = resolveSandboxCoordinate(manifest);
    const containerId = nextSandboxId(manifest.name);
    this.emit({
      type: 'manifest:resolved',
      containerId,
      manifestName: manifest.name,
      coordinate
    });

    const wasmBytes = await this.resolveWasmBytes(manifest);
    this.emit({
      type: 'artifact:fetched',
      containerId,
      manifestName: manifest.name,
      coordinate,
      details: { byteLength: wasmBytes.byteLength }
    });

    const expectedHash = manifest.entry?.sha256 || manifest.wasm?.sha256;
    await verifyArtifactHash(wasmBytes, expectedHash, {
      requireHash: this.options.allowUnsignedArtifacts !== true
    });
    this.emit({
      type: 'artifact:verified',
      containerId,
      manifestName: manifest.name,
      coordinate
    });

    const module = await WebAssembly.compile(toOwnedArrayBuffer(wasmBytes));
    const imports = WebAssembly.Module.imports(module);
    assertAllowedWasmImports(imports, manifest.allowedImports || []);
    this.emit({
      type: 'imports:verified',
      containerId,
      manifestName: manifest.name,
      coordinate,
      details: { imports: imports.map(formatWasmImport) }
    });

    const workerUrl = createWasmSandboxWorkerUrl();
    const worker = this.options.createWorker
      ? this.options.createWorker(workerUrl, { name: containerId })
      : new Worker(workerUrl, { name: containerId });

    const container = new WasmWorkerSandboxContainer(
      containerId,
      manifest,
      coordinate,
      worker,
      workerUrl,
      (event) => this.emit(event),
      this.now
    );

    await postWorkerInit(worker, {
      containerId,
      wasmBytes: toOwnedArrayBuffer(wasmBytes),
      allowedImports: manifest.allowedImports || [],
      permissions: manifest.permissions || {},
      maxMemoryBytes: manifest.sandbox?.maxMemoryBytes
    });

    this.grid.upsert(coordinate, container);
    this.emit({
      type: 'container:started',
      containerId,
      manifestName: manifest.name,
      coordinate
    });

    return container;
  }

  mountIframeSlot(target: HTMLElement, manifest: MicroSandboxManifest) {
    const slot = mountIframeSandboxSlot(target, manifest, (event) => this.emit(event));
    this.grid.upsert(slot.coordinate, slot);
    return slot;
  }

  private async resolveWasmBytes(manifest: MicroSandboxManifest) {
    const bytes = manifest.entry?.bytes;
    if (bytes) return toUint8Array(bytes);

    const url = manifest.entry?.url;
    if (!url) {
      throw new SandboxRuntimeError('ARTIFACT_ENTRY_MISSING', `Manifest ${manifest.name} has no WASM entry URL or bytes`);
    }

    const response = this.options.fetchArtifact
      ? await this.options.fetchArtifact(url)
      : await fetch(url).then((item) => {
        if (!item.ok) {
          throw new SandboxRuntimeError('ARTIFACT_FETCH_FAILED', `Failed to fetch ${url}: ${item.status}`);
        }
        return item.arrayBuffer();
      });

    return toUint8Array(response);
  }

  private readonly now = () => this.options.now?.() ?? Date.now();

  private emit(event: Omit<SandboxAuditEvent, 'timestamp'>) {
    const output: SandboxAuditEvent = {
      ...event,
      timestamp: this.now()
    };
    this.auditListeners.forEach((listener) => listener(output));
  }
}

export function resolveSandboxCoordinate(manifest: MicroSandboxManifest): SandboxCoordinate {
  const declared = manifest.sandbox?.coordinate || {};
  return normalizeCoordinate({
    route: declared.route || '/*',
    region: declared.region || manifest.deployment?.slot || manifest.name,
    layer: declared.layer || defaultLayerForManifest(manifest),
    slot: declared.slot || manifest.deployment?.slot,
    releaseId: declared.releaseId || manifest.deployment?.releaseId
  });
}

export function sandboxCoordinateKey(coordinate: SandboxCoordinate) {
  const normalized = normalizeCoordinate(coordinate);
  return [
    normalizeKeyPart(normalized.route),
    normalizeKeyPart(normalized.region),
    normalizeKeyPart(normalized.layer)
  ].join('::');
}

export async function sha256Hex(input: ArrayBuffer | ArrayBufferView) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new SandboxRuntimeError('CRYPTO_UNAVAILABLE', 'crypto.subtle is required to verify sandbox artifacts');
  }

  const digest = await subtle.digest('SHA-256', toUint8Array(input));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyArtifactHash(
  input: ArrayBuffer | ArrayBufferView,
  expectedHash?: string,
  options: { requireHash?: boolean } = {}
) {
  if (!expectedHash) {
    if (options.requireHash === false) return undefined;
    throw new SandboxRuntimeError('ARTIFACT_HASH_REQUIRED', 'Sandbox artifacts must declare a sha256 hash');
  }

  const actual = await sha256Hex(input);
  const expected = normalizeHash(expectedHash);
  if (actual !== expected) {
    throw new SandboxRuntimeError('ARTIFACT_HASH_MISMATCH', 'Sandbox artifact sha256 does not match manifest', {
      expected,
      actual
    });
  }
  return actual;
}

export function assertAllowedWasmImports(
  imports: WebAssembly.ModuleImportDescriptor[],
  allowedImports: string[]
) {
  const allowed = new Set(allowedImports.map(normalizeImportId));
  for (const item of imports) {
    if (!isImportAllowed(item, allowed)) {
      throw new SandboxRuntimeError('IMPORT_NOT_ALLOWED', `WASM import is not allowed: ${formatWasmImport(item)}`, {
        import: formatWasmImport(item),
        allowedImports: [...allowed]
      });
    }
  }
}

export function mountIframeSandboxSlot(
  target: HTMLElement,
  manifest: MicroSandboxManifest,
  emitAudit: (event: Omit<SandboxAuditEvent, 'timestamp'>) => void = () => {}
): IframeSandboxSlot {
  const coordinate = resolveSandboxCoordinate({
    ...manifest,
    sandbox: {
      ...manifest.sandbox,
      coordinate: {
        ...manifest.sandbox?.coordinate,
        layer: manifest.sandbox?.coordinate?.layer || 'ui'
      }
    }
  });

  const iframe = document.createElement('iframe');
  iframe.title = `${manifest.name} sandbox`;
  iframe.referrerPolicy = 'no-referrer';
  iframe.loading = 'lazy';
  iframe.sandbox.add('allow-scripts');

  if (manifest.permissions?.dom === true) {
    iframe.sandbox.add('allow-forms');
    iframe.sandbox.add('allow-popups');
  }

  if (manifest.entry?.html) {
    iframe.srcdoc = manifest.entry.html;
  } else if (manifest.entry?.url) {
    iframe.src = manifest.entry.url;
  } else {
    throw new SandboxRuntimeError('ARTIFACT_ENTRY_MISSING', `Manifest ${manifest.name} has no iframe URL or html`);
  }

  target.replaceChildren(iframe);
  emitAudit({
    type: 'iframe:mounted',
    manifestName: manifest.name,
    coordinate
  });

  return {
    iframe,
    coordinate,
    post(message: unknown, targetOrigin = '*') {
      iframe.contentWindow?.postMessage({
        type: 'gaesup:sandbox-message',
        coordinate,
        payload: message
      }, targetOrigin);
    },
    unmount() {
      iframe.remove();
      emitAudit({
        type: 'iframe:unmounted',
        manifestName: manifest.name,
        coordinate
      });
    }
  };
}

function normalizeCoordinate(coordinate: SandboxCoordinate): SandboxCoordinate {
  return {
    route: coordinate.route || '/*',
    region: coordinate.region || 'default',
    layer: coordinate.layer || 'ui',
    slot: coordinate.slot,
    releaseId: coordinate.releaseId
  };
}

function defaultLayerForManifest(manifest: MicroSandboxManifest): SandboxLayer {
  if (manifest.entry?.type === 'iframe' || manifest.runtime === 'iframe') return 'ui';
  if (manifest.runtime === 'wasm' || manifest.runtime === 'wasm-worker' || manifest.entry?.type === 'wasm') return 'state';
  return 'effect';
}

function normalizeKeyPart(value: string) {
  return value.trim().replace(/\s+/g, ' ') || '*';
}

function normalizeHash(value: string) {
  return value.trim().toLowerCase().replace(/^sha256:/, '');
}

function normalizeImportId(value: string) {
  return value.trim();
}

function isImportAllowed(item: WebAssembly.ModuleImportDescriptor, allowed: Set<string>) {
  const names = [
    `${item.module}.${item.name}`,
    `${item.module}/${item.name}`,
    `${item.module}:${item.name}`,
    item.module,
    item.name
  ];
  return names.some((name) => allowed.has(name));
}

function formatWasmImport(item: WebAssembly.ModuleImportDescriptor) {
  return `${item.module}.${item.name}`;
}

function toUint8Array(input: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}

function toOwnedArrayBuffer(input: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  const bytes = toUint8Array(input);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function nextSandboxId(name: string) {
  sandboxIdSeq += 1;
  return `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}:${sandboxIdSeq}`;
}

async function postWorkerInit(worker: Worker, payload: Record<string, unknown> & { wasmBytes: ArrayBuffer }) {
  const id = 1;
  const promise = new Promise<WasmSandboxStartResult>((resolve, reject) => {
    const handler = (event: MessageEvent<WorkerReply>) => {
      if (event.data.id !== id) return;
      worker.removeEventListener('message', handler);
      if (event.data.ok) {
        resolve(event.data.result as WasmSandboxStartResult);
      } else {
        reject(new SandboxRuntimeError(event.data.error.code, event.data.error.message));
      }
    };
    worker.addEventListener('message', handler);
  });

  worker.postMessage({ id, type: 'init', payload }, [payload.wasmBytes]);
  return promise;
}

function createWasmSandboxWorkerUrl() {
  const blob = new Blob([WASM_SANDBOX_WORKER_SOURCE], { type: 'text/javascript' });
  return URL.createObjectURL(blob);
}

const WASM_SANDBOX_WORKER_SOURCE = `
const containers = new Map();

self.onmessage = async (event) => {
  const { id, type, payload } = event.data || {};
  try {
    if (type === 'init') {
      const result = await initContainer(payload);
      self.postMessage({ id, ok: true, result });
      return;
    }
    if (type === 'call') {
      const result = callContainer(payload);
      self.postMessage({ id, ok: true, result });
      return;
    }
    if (type === 'stop') {
      containers.delete(payload.containerId);
      self.postMessage({ id, ok: true });
      return;
    }
    throw runtimeError('UNKNOWN_MESSAGE', 'Unknown sandbox worker message: ' + type);
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: {
        code: error && error.code || 'SANDBOX_WORKER_ERROR',
        message: error && error.message || String(error)
      }
    });
  }
};

async function initContainer(payload) {
  const module = await WebAssembly.compile(payload.wasmBytes);
  const imports = WebAssembly.Module.imports(module);
  const importObject = buildImportObject(imports, payload);
  const instance = await WebAssembly.instantiate(module, importObject);
  containers.set(payload.containerId, {
    instance,
    imports,
    calls: 0,
    startedAt: Date.now()
  });
  return {
    containerId: payload.containerId,
    exports: Object.keys(instance.exports),
    imports: imports.map((item) => item.module + '.' + item.name)
  };
}

function callContainer(payload) {
  const container = containers.get(payload.containerId);
  if (!container) throw runtimeError('CONTAINER_NOT_FOUND', 'Container not found: ' + payload.containerId);
  const exported = container.instance.exports[payload.exportName];
  if (typeof exported !== 'function') {
    throw runtimeError('EXPORT_NOT_FOUND', 'WASM export is not callable: ' + payload.exportName);
  }
  container.calls += 1;
  const args = Array.isArray(payload.args) ? payload.args : [];
  return exported(...args);
}

function buildImportObject(imports, payload) {
  const output = {};
  for (const item of imports) {
    if (!output[item.module]) output[item.module] = {};
    output[item.module][item.name] = createImportValue(item, payload);
  }
  return output;
}

function createImportValue(item, payload) {
  if (item.kind === 'memory') {
    const maxBytes = payload.maxMemoryBytes || 64 * 1024;
    const maximum = Math.max(1, Math.ceil(maxBytes / 65536));
    return new WebAssembly.Memory({ initial: 1, maximum });
  }
  if (item.kind === 'table') {
    return new WebAssembly.Table({ initial: 0, element: 'anyfunc' });
  }
  if (item.kind === 'global') {
    return new WebAssembly.Global({ value: 'i32', mutable: false }, 0);
  }

  const id = item.module + '/' + item.name;
  if (id === 'gaesup:time/now' || item.name === 'now') {
    return () => Date.now();
  }
  if (id === 'gaesup:log/i32' || item.name === 'log_i32') {
    return (value) => {
      console.log('[gaesup sandbox]', value);
      return 0;
    };
  }

  return () => {
    throw runtimeError('CAPABILITY_NOT_IMPLEMENTED', 'Allowed import has no worker capability implementation: ' + id);
  };
}

function runtimeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
`;
