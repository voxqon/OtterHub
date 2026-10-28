import type { Chunk } from "@shared/types";

type OpenChunk = (
  chunk: Chunk,
  range: { offset: number; length: number },
  signal: AbortSignal
) => Promise<ReadableStream<Uint8Array>>;

export function createChunkStream(
  chunks: Chunk[],
  start: number,
  end: number,
  open: OpenChunk
) {
  let offset = 0;
  const ranges = chunks.flatMap((chunk) => {
    const chunkStart = offset;
    offset += chunk.size;
    const from = Math.max(start, chunkStart);
    const to = Math.min(end + 1, offset);
    return from < to
      ? [{ chunk, range: { offset: from - chunkStart, length: to - from } }]
      : [];
  });
  const abort = new AbortController();
  let index = 0;
  let cancelled = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const source = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (!cancelled) {
          if (reader) {
            const result = await reader.read();
            if (cancelled) return;
            if (!result.done) {
              controller.enqueue(result.value);
              return;
            }
            reader.releaseLock();
            reader = undefined;
          }
          if (index === ranges.length) {
            controller.close();
            return;
          }
          const next = ranges[index++];
          const body = await open(next.chunk, next.range, abort.signal);
          if (cancelled) {
            await body.cancel();
            return;
          }
          reader = body.getReader();
        }
      } catch (error) {
        if (!cancelled) controller.error(error);
        abort.abort(error);
        await reader?.cancel(error).catch(() => undefined);
      }
    },
    async cancel(reason) {
      cancelled = true;
      abort.abort(reason);
      await reader?.cancel(reason).catch(() => undefined);
    },
  });

  // Workers derives Content-Length from this native stream; a manual header on a
  // general ReadableStream is removed by the runtime.
  const FixedLength = (
    globalThis as unknown as {
      FixedLengthStream?: new (
        length: number
      ) => TransformStream<Uint8Array, Uint8Array>;
    }
  ).FixedLengthStream;
  if (!FixedLength) return source;
  const fixed = new FixedLength(end - start + 1);
  void source.pipeTo(fixed.writable).catch(() => undefined);
  return fixed.readable;
}
