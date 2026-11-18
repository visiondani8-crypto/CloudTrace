import "@testing-library/jest-dom/vitest";

// jsdom lacks these browser APIs used by Radix primitives.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver ??= RO;
(globalThis as any).DOMRect ??= class { x = 0; y = 0; width = 0; height = 0; top = 0; left = 0; right = 0; bottom = 0; };
if (!(Element.prototype as any).hasPointerCapture) {
  (Element.prototype as any).hasPointerCapture = () => false;
  (Element.prototype as any).releasePointerCapture = () => {};
  (Element.prototype as any).scrollIntoView = () => {};
}
