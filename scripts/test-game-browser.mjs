// Direct Versus counterpart of the shared real-browser/native-client harness.
// Usage: URL OUTPUT NATIVE_CLIENT_BINARY [GAME]
process.argv[6] = 'direct';
await import('./test-hosted-browser.mjs');
