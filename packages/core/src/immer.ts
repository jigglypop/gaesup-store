import { GaesupCore, type Action } from './index';

export type CaseReducer<T, P = any> = (state: T, action: Action<P>) => void | T;

export interface CreateSliceOptions<T> {
  name: string;
  initialState: T;
  reducers: Record<string, CaseReducer<T>>;
}

export function produce<T>(baseState: T, recipe: (draft: T) => void | T): T {
  const draft = clonePlain(baseState);
  const result = recipe(draft);
  return result === undefined ? draft : result;
}

export function createSlice<T extends Record<string, any>>(options: CreateSliceOptions<T>) {
  const { name, initialState, reducers } = options;
  const actions = Object.fromEntries(
    Object.keys(reducers).map((actionName) => [
      actionName,
      (payload?: any): Action => ({
        type: `${name}/${actionName}`,
        payload
      })
    ])
  ) as Record<keyof typeof reducers, (payload?: any) => Action>;

  const reducer = (state: T = initialState, action: Action): T => {
    const actionName = action.type.startsWith(`${name}/`)
      ? action.type.slice(name.length + 1)
      : '';
    const caseReducer = reducers[actionName];
    if (!caseReducer) return state;
    return produce(state, (draft) => caseReducer(draft, action));
  };

  return {
    name,
    actions,
    reducer,
    async createStore(storeId = name) {
      await GaesupCore.createStore(storeId, clonePlain(initialState));
      return GaesupCore.registerReducer(storeId, reducer);
    }
  };
}

function clonePlain<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}
