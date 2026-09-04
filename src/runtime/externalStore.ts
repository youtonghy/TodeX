export type StoreListener = () => void;

const EMPTY_RECORD = Object.freeze({}) as Readonly<Record<string, never>>;
const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

export class RuntimeTransaction {
  private depth = 0;
  private pending = new Set<StoreListener>();

  run<Result>(operation: () => Result): Result {
    this.depth += 1;
    let result: Result | undefined;
    let operationFailed = false;
    let operationError: unknown;
    try {
      result = operation();
    } catch (error: unknown) {
      operationFailed = true;
      operationError = error;
    } finally {
      this.depth -= 1;
    }

    let notificationError: unknown;
    if (this.depth === 0) {
      const listeners = [...this.pending];
      this.pending.clear();
      for (const listener of listeners) {
        try {
          listener();
        } catch (error: unknown) {
          notificationError ??= error;
        }
      }
    }
    if (operationFailed) throw operationError;
    if (notificationError !== undefined) throw notificationError;
    return result as Result;
  }

  notify(listener: StoreListener): void {
    if (this.depth > 0) {
      this.pending.add(listener);
      return;
    }
    listener();
  }
}

export class ExternalStore<Value> {
  private listeners = new Set<StoreListener>();

  constructor(
    private snapshot: Value,
    private readonly transaction = new RuntimeTransaction(),
  ) {}

  getSnapshot = (): Value => this.snapshot;

  subscribe = (listener: StoreListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(value: Value): void {
    if (Object.is(value, this.snapshot)) return;
    this.transaction.run(() => {
      this.snapshot = value;
      this.listeners.forEach((listener) => this.transaction.notify(listener));
    });
  }

  update(updater: (current: Value) => Value): void {
    this.set(updater(this.snapshot));
  }
}

export class KeyedExternalStore<Value> {
  private snapshot: Readonly<Record<string, Value>> = EMPTY_RECORD;
  private listeners = new Set<StoreListener>();
  private keyListeners = new Map<string, Set<StoreListener>>();

  constructor(private readonly transaction = new RuntimeTransaction()) {}

  getAllSnapshot = (): Readonly<Record<string, Value>> => this.snapshot;

  getSnapshot = (key: string): Value | null => (
    hasOwn(this.snapshot, key) ? this.snapshot[key] : null
  );

  subscribe = (listener: StoreListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  subscribeKey = (key: string, listener: StoreListener): (() => void) => {
    const listeners = this.keyListeners.get(key) ?? new Set<StoreListener>();
    listeners.add(listener);
    this.keyListeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.keyListeners.delete(key);
    };
  };

  set(key: string, value: Value): void {
    if (!key || (hasOwn(this.snapshot, key) && this.snapshot[key] === value)) return;
    this.commit({ ...this.snapshot, [key]: value }, [key]);
  }

  update(key: string, updater: (current: Value | null) => Value | null): void {
    const current = this.getSnapshot(key);
    const next = updater(current);
    if (next === current) return;
    if (next === null) {
      this.delete(key);
      return;
    }
    this.set(key, next);
  }

  delete(key: string): void {
    if (!key || !hasOwn(this.snapshot, key)) return;
    const next = { ...this.snapshot };
    delete next[key];
    this.commit(next, [key]);
  }

  replace(values: Readonly<Record<string, Value>>): void {
    const keys = new Set([...Object.keys(this.snapshot), ...Object.keys(values)]);
    const changedKeys = [...keys].filter((key) => this.snapshot[key] !== values[key]);
    if (changedKeys.length === 0) return;
    this.commit({ ...values }, changedKeys);
  }

  clear(): void {
    const keys = Object.keys(this.snapshot);
    if (keys.length === 0) return;
    this.commit(EMPTY_RECORD, keys);
  }

  private commit(next: Readonly<Record<string, Value>>, changedKeys: readonly string[]): void {
    this.transaction.run(() => {
      this.snapshot = next;
      this.listeners.forEach((listener) => this.transaction.notify(listener));
      changedKeys.forEach((key) => {
        this.keyListeners.get(key)?.forEach((listener) => this.transaction.notify(listener));
      });
    });
  }
}

export class RuntimeActionRegistry {
  private implementations = new Map<string, object>();
  private facades = new Map<string, object>();

  bind<Actions extends object>(namespace: string, actions: Actions): void {
    this.implementations.set(namespace, actions);
  }

  get<Actions extends object>(namespace: string): Actions {
    const existing = this.facades.get(namespace);
    if (existing) return existing as Actions;

    const methods = new Map<PropertyKey, (...args: unknown[]) => unknown>();
    const facade = new Proxy({}, {
      get: (_target, property) => {
        const cached = methods.get(property);
        if (cached) return cached;
        const method = (...args: unknown[]) => {
          const implementation = this.implementations.get(namespace) as Record<PropertyKey, unknown> | undefined;
          const action = implementation?.[property];
          if (typeof action !== 'function') throw new Error(`Runtime action ${namespace}.${String(property)} is not bound`);
          return Reflect.apply(action, implementation, args);
        };
        methods.set(property, method);
        return method;
      },
      ownKeys: () => {
        const implementation = this.implementations.get(namespace);
        return implementation ? Reflect.ownKeys(implementation) : [];
      },
      getOwnPropertyDescriptor: (_target, property) => {
        const implementation = this.implementations.get(namespace);
        if (!implementation || !Object.prototype.hasOwnProperty.call(implementation, property)) {
          return undefined;
        }
        return {
          configurable: true,
          enumerable: true,
        };
      },
    });
    this.facades.set(namespace, facade);
    return facade as Actions;
  }
}
