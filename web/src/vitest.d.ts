// Loads @testing-library/jest-dom's matcher augmentation (toBeInTheDocument,
// toHaveFocus, toHaveAttribute, …) into vitest's Assertion type so component
// tests type-check. Runtime registration happens in vitest.setup.ts.
import "@testing-library/jest-dom/vitest";
