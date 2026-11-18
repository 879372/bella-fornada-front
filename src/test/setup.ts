import '@testing-library/jest-dom/vitest';

// jsdom não implementa rolagem.
Element.prototype.scrollIntoView ??= function scrollIntoView() {};
