// A local forward proxy that OBSERVES the agent's outbound destinations and
// forwards them — it never blocks (Phase 1 of the egress allowlist, loom-xclx).
// For HTTPS the client sends `CONNECT host:port` and we read the host from that
// line WITHOUT decrypting the TLS that follows (no MITM, no certificates); for
// plain HTTP we read the `Host` header. Each destination is reported via onHost,
// then the bytes are piped straight through to the real upstream.
//
// Phase 2 will add an allowlist that refuses off-list CONNECTs and pair this with
// a network namespace so the agent can't bypass it.

import net from "node:net";

export interface EgressProxyOptions {
  /** Called with each observed destination. Best-effort — a throwing handler
   *  must not break forwarding. */
  onHost: (host: string, port: number) => void;
}

export interface EgressProxy {
  /** The localhost port the agent points HTTP(S)_PROXY at. */
  port: number;
  /** Stop accepting connections; optional callback fires once closed. */
  close: (cb?: () => void) => void;
}

/** Start the observe-only egress proxy on 127.0.0.1:0 (a random free port). */
export async function startEgressProxy(opts: EgressProxyOptions): Promise<EgressProxy> {
  const report = (host: string, port: number) => {
    try { opts.onHost(host, port); } catch { /* best-effort — never break forwarding */ }
  };

  const server = net.createServer((client) => {
    client.once("data", (first) => {
      const head = first.toString("latin1");
      const firstLine = head.slice(0, Math.max(0, head.indexOf("\r\n")));
      const connect = /^CONNECT\s+([^\s:]+):(\d+)\s+HTTP/i.exec(firstLine);

      if (connect) {
        // HTTPS tunnel: host:port from the CONNECT line, then blind-pipe both ways.
        const host = connect[1];
        const port = Number(connect[2]);
        report(host, port);
        const upstream = net.connect(port, host, () => {
          client.write("HTTP/1.1 200 Connection established\r\n\r\n");
          client.pipe(upstream);
          upstream.pipe(client);
        });
        upstream.on("error", () => client.destroy());
        client.on("error", () => upstream.destroy());
        return;
      }

      // Plain HTTP: the destination is in the Host header. Connect, replay the
      // bytes we already consumed, then pipe the rest.
      const hostHdr = /\r\nHost:\s*([^\s:\r]+)(?::(\d+))?/i.exec(head);
      if (hostHdr) {
        const host = hostHdr[1];
        const port = hostHdr[2] ? Number(hostHdr[2]) : 80;
        report(host, port);
        const upstream = net.connect(port, host, () => {
          upstream.write(first);
          client.pipe(upstream);
          upstream.pipe(client);
        });
        upstream.on("error", () => client.destroy());
        client.on("error", () => upstream.destroy());
        return;
      }

      client.destroy(); // not HTTP(S) forward-proxy traffic — drop
    });
    client.on("error", () => client.destroy());
  });

  await new Promise<void>((res) => server.listen(0, "127.0.0.1", () => res()));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    close: (cb) => server.close(cb),
  };
}
