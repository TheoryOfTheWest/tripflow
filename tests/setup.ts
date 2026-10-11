import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { Blob, File } from 'node:buffer';
// jsdom's Blob is not structured-cloneable; IndexedDB in a real browser is.
Object.assign(globalThis, { Blob, File });
