import { GaesupCore } from '../index';

// Immer 스타일 produce 함수
export function produce<T = any>(
  baseState: T,
  recipe: (draft: T) => void | T
): T {
  // 프록시를 사용해 변경사항 추적
  const changes: Map<string[], any> = new Map();
  const draft = createDraft(baseState, changes);
  
  const result = recipe(draft);
  
  // recipe가 새로운 상태를 반환하면 그것을 사용
  if (result !== undefined) {
    return result;
  }
  
  // 변경사항 적용
  return applyChanges(baseState, changes);
}

// Draft 프록시 생성
function createDraft<T>(base: T, changes: Map<string[], any>, path: string[] = []): T {
  if (typeof base !== 'object' || base === null) {
    return base;
  }
  
  return new Proxy(base as any, {
    get(target, prop) {
      if (typeof prop === 'symbol') return target[prop];
      
      const currentPath = [...path, prop as string];
      const value = target[prop];
      
      // 중첩된 객체도 프록시로 감싸기
      if (typeof value === 'object' && value !== null) {
        return createDraft(value, changes, currentPath);
      }
      
      return value;
    },
    
    set(target, prop, value) {
      if (typeof prop === 'symbol') {
        target[prop] = value;
        return true;
      }
      
      const currentPath = [...path, prop as string];
      changes.set(currentPath, value);
      return true;
    },
    
    deleteProperty(target, prop) {
      if (typeof prop === 'symbol') {
        delete target[prop];
        return true;
      }
      
      const currentPath = [...path, prop as string];
      changes.set(currentPath, undefined);
      return true;
    },
    
    has(target, prop) {
      return prop in target;
    }
  });
}

// 변경사항 적용
function applyChanges<T>(base: T, changes: Map<string[], any>): T {
  if (changes.size === 0) {
    return base;
  }
  
  // 깊은 복사
  const result = deepClone(base);
  
  // 변경사항 적용
  for (const [path, value] of changes) {
    setNestedValue(result, path, value);
  }
  
  return result;
}

// 깊은 복사
function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  if (obj instanceof Date) {
    return new Date(obj.getTime()) as any;
  }
  
  if (obj instanceof Array) {
    return obj.map(item => deepClone(item)) as any;
  }
  
  if (obj instanceof Map) {
    return new Map(Array.from(obj.entries()).map(([k, v]) => [k, deepClone(v)])) as any;
  }
  
  if (obj instanceof Set) {
    return new Set(Array.from(obj).map(item => deepClone(item))) as any;
  }
  
  const cloned = {} as any;
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  
  return cloned;
}

// 중첩된 값 설정
function setNestedValue(obj: any, path: string[], value: any): void {
  let current = obj;
  
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    
    if (!(key in current) || typeof current[key] !== 'object') {
      current[key] = isNaN(Number(path[i + 1])) ? {} : [];
    }
    
    current = current[key];
  }
  
  const lastKey = path[path.length - 1];
  
  if (value === undefined) {
    delete current[lastKey];
  } else {
    current[lastKey] = value;
  }
}

// Gaesup-State와 통합된 produce
export function produceWithStore(
  storeId: string,
  recipe: (draft: any) => void | any
): Promise<any> {
  const currentState = GaesupCore.select('');
  const nextState = produce(currentState, recipe);
  
  return GaesupCore.dispatch('SET', nextState);
}

// Redux Toolkit 스타일 createSlice
export interface SliceConfig<T = any> {
  name: string;
  initialState: T;
  reducers: {
    [key: string]: (state: T, action?: { payload?: any }) => void | T;
  };
  extraReducers?: {
    [key: string]: (state: T, action: any) => void | T;
  };
}

export function createSlice<T>(config: SliceConfig<T>) {
  const { name, initialState, reducers, extraReducers = {} } = config;
  
  // 액션 생성자들
  const actions: Record<string, Function> = {};
  
  for (const actionName in reducers) {
    actions[actionName] = (payload?: any) => ({
      type: `${name}/${actionName}`,
      payload
    });
  }
  
  // 리듀서
  const reducer = (state: T = initialState, action: { type: string; payload?: any }): T => {
    // 슬라이스 액션 처리
    const actionType = action.type.replace(`${name}/`, '');
    
    if (reducers[actionType]) {
      return produce(state, draft => {
        reducers[actionType](draft, action);
      });
    }
    
    // extraReducers 처리
    if (extraReducers[action.type]) {
      return produce(state, draft => {
        extraReducers[action.type](draft, action);
      });
    }
    
    return state;
  };
  
  return {
    name,
    actions,
    reducer,
    // Gaesup-State 통합
    createStore: async () => {
      await GaesupCore.initStore(initialState);
      
      // 리듀서 등록 (커스텀 액션 처리)
      const originalDispatch = GaesupCore.dispatch.bind(GaesupCore);
      
  const originalDispatch = GaesupCore.dispatch;
  (GaesupCore as any).dispatch = async (actionType: string, payload: any) => {
        if (storeId === name) {
          const currentState = GaesupCore.select('');
          const action = { type: actionType, payload };
          const nextState = reducer(currentState, action);
          
          if (nextState !== currentState) {
            return originalDispatch('SET', nextState);
          }
        }
        
        return originalDispatch(actionType, payload);
      };
    }
  };
}

// 헬퍼 함수들

// 배열 업데이트 헬퍼
export const arrayHelpers = {
  push<T>(array: T[], ...items: T[]): T[] {
    return produce(array, draft => {
      draft.push(...items);
    });
  },
  
  pop<T>(array: T[]): T[] {
    return produce(array, draft => {
      draft.pop();
    });
  },
  
  shift<T>(array: T[]): T[] {
    return produce(array, draft => {
      draft.shift();
    });
  },
  
  unshift<T>(array: T[], ...items: T[]): T[] {
    return produce(array, draft => {
      draft.unshift(...items);
    });
  },
  
  remove<T>(array: T[], index: number): T[] {
    return produce(array, draft => {
      draft.splice(index, 1);
    });
  },
  
  update<T>(array: T[], index: number, value: T): T[] {
    return produce(array, draft => {
      draft[index] = value;
    });
  },
  
  filter<T>(array: T[], predicate: (item: T, index: number) => boolean): T[] {
    return array.filter(predicate);
  },
  
  map<T, U>(array: T[], mapper: (item: T, index: number) => U): U[] {
    return array.map(mapper);
  }
};

// 객체 업데이트 헬퍼
export const objectHelpers = {
  set<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): T {
    return produce(obj, draft => {
      draft[key] = value;
    });
  },
  
  merge<T extends object>(obj: T, updates: Partial<T>): T {
    return produce(obj, draft => {
      Object.assign(draft, updates);
    });
  },
  
  omit<T extends object, K extends keyof T>(obj: T, ...keys: K[]): Omit<T, K> {
    return produce(obj, draft => {
      keys.forEach(key => {
        delete draft[key];
      });
    }) as Omit<T, K>;
  },
  
  pick<T extends object, K extends keyof T>(obj: T, ...keys: K[]): Pick<T, K> {
    const result = {} as Pick<T, K>;
    keys.forEach(key => {
      result[key] = obj[key];
    });
    return result;
  }
};

// 패치 함수 (여러 업데이트를 한번에)
export function createPatcher<T>() {
  const patches: Array<(draft: T) => void> = [];
  
  return {
    add(patch: (draft: T) => void) {
      patches.push(patch);
      return this;
    },
    
    apply(base: T): T {
      return produce(base, draft => {
        patches.forEach(patch => patch(draft));
      });
    }
  };
}

// 사용 예시:
/*
// 1. 기본 produce
const nextState = produce(state, draft => {
  draft.user.name = 'New Name';
  draft.posts.push({ id: 1, title: 'New Post' });
});

// 2. Redux Toolkit 스타일
const todosSlice = createSlice({
  name: 'todos',
  initialState: [],
  reducers: {
    addTodo: (state, action) => {
      state.push(action.payload);
    },
    removeTodo: (state, action) => {
      const index = state.findIndex(todo => todo.id === action.payload);
      if (index !== -1) state.splice(index, 1);
    }
  }
});

// 3. 헬퍼 사용
const newArray = arrayHelpers.push(myArray, newItem);
const newObject = objectHelpers.merge(myObject, { name: 'Updated' });

// 4. 패처 사용
const patcher = createPatcher<State>();
const newState = patcher
  .add(draft => { draft.count++ })
  .add(draft => { draft.user.name = 'New Name' })
  .apply(currentState);
*/ 