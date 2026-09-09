import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// The suite imports `expect`/`it` explicitly rather than running with globals,
// so React Testing Library's own auto-cleanup never arms itself. Unmounting
// here keeps one test's DOM out of the next one's queries.
afterEach(cleanup);

/**
 * jsdom ships no ResizeObserver, and `useElementWidth` builds one
 * unconditionally — without this every chart component throws on mount.
 *
 * The stub reports the element's current rect on `observe` and on demand,
 * which is enough for a test that has stubbed `getBoundingClientRect` to a
 * real width. Left alone it reports 0, and the charts skip their first paint
 * exactly as they do in a browser before layout.
 */
class TestResizeObserver implements ResizeObserver {
  targets = new Set<Element>();
  callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    observers.add(this);
  }

  observe(target: Element) {
    this.targets.add(target);
    this.emit();
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
    observers.delete(this);
  }

  emit() {
    const entries = [...this.targets].map(
      (target) =>
        ({ target, contentRect: target.getBoundingClientRect() }) as ResizeObserverEntry,
    );
    if (entries.length > 0) this.callback(entries, this);
  }
}

const observers = new Set<TestResizeObserver>();

/** Re-run every live observer, for tests that resize an element mid-flight. */
export function flushResizeObservers() {
  for (const observer of observers) observer.emit();
}

globalThis.ResizeObserver = TestResizeObserver;

afterEach(() => observers.clear());
