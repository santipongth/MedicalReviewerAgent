// Minimal Server-Sent Events parser (WHATWG event-stream format) for fetch-based streaming.
// EventSource cannot listen for "any" named event and cannot set headers, so the app reads the stream itself.

export interface SSEMessage {
  id: string | undefined;
  event: string;
  data: string;
}

export class SSEParser {
  private buffer = "";

  feed(chunk: string): SSEMessage[] {
    this.buffer += chunk.replace(/\r\n?/g, "\n");
    const out: SSEMessage[] = [];
    let sep: number;
    while ((sep = this.buffer.indexOf("\n\n")) !== -1) {
      const block = this.buffer.slice(0, sep);
      this.buffer = this.buffer.slice(sep + 2);
      const msg = parseBlock(block);
      if (msg) out.push(msg);
    }
    return out;
  }
}

function parseBlock(block: string): SSEMessage | null {
  let id: string | undefined;
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "id") id = value;
    else if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  if (data.length === 0) return null;
  return { id, event, data: data.join("\n") };
}
