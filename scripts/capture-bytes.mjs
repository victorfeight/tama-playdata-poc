#!/usr/bin/env node
import fs from "node:fs";

const out = process.argv[2] ?? "capture.bin";

console.error("capture-bytes is a placeholder until NodeSerialTransport is wired.");
console.error("Use the web-client byte log for the first POC captures.");
fs.writeFileSync(out, Buffer.alloc(0));
console.error(`wrote empty capture marker: ${out}`);
