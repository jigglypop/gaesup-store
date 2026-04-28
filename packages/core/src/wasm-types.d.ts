// WASM 모듈 타입 정의
declare module '@gaesup-state/core-rust' {
  export default function init(module?: unknown): Promise<void>;
  export function init(): void;
  export function create_store(storeId: string, initialState: any): void;
  export function dispatch(storeId: string, actionType: string, payload: any): any;
  export function select(storeId: string, path: string): any;
  export function subscribe(storeId: string, path: string, callback: (state?: any) => void): string;
  export function unsubscribe(subscriptionId: string): void;
  export function create_snapshot(storeId: string): string;
  export function restore_snapshot(storeId: string, snapshotId: string): any;
  export function get_metrics(storeId: string): any;
  export function register_store_schema(schema: any): void;
  export function get_store_schemas(): any[];
  export function cleanup_store(storeId: string): void;
  export function garbage_collect(): void;
  
  export class BatchUpdate {
    constructor(storeId: string);
    add_update(actionType: string, payload: any): void;
    execute(): any;
  }
}

declare module '@gaesup-state/core-rust/pkg-web/gaesup_state_core.js' {
  export default function init(module?: unknown): Promise<void>;
  export * from '@gaesup-state/core-rust';
}

declare module '@gaesup-state/core-rust/pkg-node/gaesup_state_core.js' {
  export default function init(module?: unknown): Promise<void>;
  export * from '@gaesup-state/core-rust';
}
