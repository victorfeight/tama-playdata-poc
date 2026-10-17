// One pending read per open transport, even while its room/socket is replaced.
// A room owns the subscription, not the serial reader. No bytes are buffered
// for a disconnected room; an in-flight read is delivered to the current owner.
interface SerialSource {
  read(): Promise<Uint8Array>;
}
interface Sink {
  bytes(data: Uint8Array): void;
  error(error: unknown): void;
}
interface Reader {
  sink: Sink | undefined;
  running: boolean;
}
const readers = new WeakMap<SerialSource, Reader>();

export function subscribeSerial(source: SerialSource, sink: Sink): () => void {
  let reader = readers.get(source);
  if (!reader) {
    reader = { sink: undefined, running: false };
    readers.set(source, reader);
  }
  if (reader.sink) throw new Error("Serial transport already has an active bridge");
  reader.sink = sink;
  if (!reader.running) void pump(source, reader);
  return () => {
    if (reader.sink === sink) reader.sink = undefined;
  };
}

async function pump(source: SerialSource, reader: Reader): Promise<void> {
  reader.running = true;
  try {
    while (reader.sink) {
      const data = await source.read();
      if (data.length) reader.sink?.bytes(data);
    }
  } catch (error) {
    const sink = reader.sink;
    reader.sink = undefined;
    reader.running = false;
    sink?.error(error);
    return;
  }
  reader.running = false;
}
