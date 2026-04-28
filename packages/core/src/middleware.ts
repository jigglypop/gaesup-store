import { GaesupCore, type Action } from './index';

export interface MiddlewareStore {
  storeId: string;
  getState(): any;
  dispatch: Dispatch;
}

export type Dispatch = (action: Action | ThunkAction) => any;
export type Middleware = (store: MiddlewareStore) => (next: Dispatch) => Dispatch;
export type ThunkAction = (dispatch: Dispatch, getState: () => any) => any;

export const thunk: Middleware = (store) => (next) => (action) => {
  if (typeof action === 'function') {
    return action(store.dispatch, store.getState);
  }
  return next(action);
};

export const logger: Middleware = (store) => (next) => async (action) => {
  const startedAt = Date.now();
  const result = await next(action);
  if (typeof console !== 'undefined' && typeof action !== 'function') {
    console.debug('[gaesup-state]', store.storeId, action.type, `${Date.now() - startedAt}ms`);
  }
  return result;
};

export const devTools: Middleware = (store) => (next) => async (action) => {
  const result = await next(action);
  const extension = getReduxDevToolsExtension();
  if (extension && typeof action !== 'function') {
    const connection = extension.connect({ name: `Gaesup:${store.storeId}` });
    connection.send(action, store.getState());
  }
  return result;
};

export function applyMiddleware(storeId: string, ...middlewares: Middleware[]) {
  const store: MiddlewareStore = {
    storeId,
    getState: () => GaesupCore.select(storeId, ''),
    dispatch: (action) => dispatch(action)
  };

  const baseDispatch: Dispatch = (action) => {
    if (typeof action === 'function') {
      return action(dispatch, store.getState);
    }
    return GaesupCore.dispatch(storeId, action.type, action.payload);
  };

  const dispatch = middlewares
    .slice()
    .reverse()
    .reduce((next, middleware) => middleware(store)(next), baseDispatch);

  return dispatch;
}

export const createMiddlewarePipeline = applyMiddleware;

function getReduxDevToolsExtension() {
  if (typeof window === 'undefined') return undefined;
  return (window as any).__REDUX_DEVTOOLS_EXTENSION__;
}
