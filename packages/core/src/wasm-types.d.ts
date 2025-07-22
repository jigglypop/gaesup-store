// WASM 모듈 타입 정의
declare module '@gaesup-state/core-rust' {
  export function create_store(storeId: string, initialState: any): void;
  export function dispatch(storeId: string, actionType: string, payload: any): any;
  export function select(storeId: string, path: string): any;
  export function subscribe(storeId: string, path: string, callbackId: string): string;
  export function unsubscribe(subscriptionId: string): void;
  export function create_snapshot(storeId: string): string;
  export function restore_snapshot(storeId: string, snapshotId: string): any;
  export function get_metrics(storeId: string): any;
  export function cleanup_store(storeId: string): void;
  export function garbage_collect(): void;
  
  export class BatchUpdate {
    constructor(storeId: string);
    add_update(actionType: string, payload: any): void;
    execute(): any;
  }
} 