import { endianness } from "node:os";
import { MAX_NATIVE_BYTES } from "../../../packages/contracts/src/companion.js";

// Chrome's native transport uses a four-byte length in host byte order.
export function encodeNative(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  if (body.length > MAX_NATIVE_BYTES)
    throw new Error("Native response is too large");
  const header = Buffer.alloc(4);
  if (endianness() === "LE") header.writeUInt32LE(body.length);
  else header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}
export class NativeDecoder {
  private buffer: Buffer = Buffer.alloc(0);
  push(chunk: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const values: unknown[] = [];
    while (this.buffer.length >= 4) {
      const length =
        endianness() === "LE"
          ? this.buffer.readUInt32LE(0)
          : this.buffer.readUInt32BE(0);
      if (length === 0 || length > 64 * 1024)
        throw new Error("Invalid native request size");
      if (this.buffer.length < length + 4) break;
      values.push(
        JSON.parse(this.buffer.subarray(4, length + 4).toString("utf8")),
      );
      this.buffer = this.buffer.subarray(length + 4);
    }
    return values;
  }
}
