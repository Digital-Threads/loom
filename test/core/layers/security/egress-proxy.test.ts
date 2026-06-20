import { describe, it, expect, afterEach } from "vitest";
import net from "node:net";
import { startEgressProxy } from "../../../../src/core/layers/security/egress-proxy.js";

// Read one chunk from a socket as a string.
function chunk(sock: net.Socket): Promise<string> {
  return new Promise((res) => sock.once("data", (d) => res(d.toString())));
}
function connected(sock: net.Socket): Promise<void> {
  return new Promise((res) => sock.once("connect", () => res()));
}

describe("egress proxy (audit — log host, never block)", () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { cleanup.forEach((c) => c()); cleanup.length = 0; });

  it("records the CONNECT host and tunnels bytes through to the upstream", async () => {
    // Fake upstream: echoes whatever it receives.
    const upstream = net.createServer((s) => s.on("data", (d) => s.write(d)));
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", () => r()));
    const upPort = (upstream.address() as net.AddressInfo).port;
    cleanup.push(() => upstream.close());

    const hosts: Array<{ host: string; port: number }> = [];
    const proxy = await startEgressProxy({ onHost: (host, port) => hosts.push({ host, port }) });
    cleanup.push(() => proxy.close());

    // Client speaks the forward-proxy CONNECT method.
    const client = net.connect(proxy.port, "127.0.0.1");
    await connected(client);
    client.write(`CONNECT 127.0.0.1:${upPort} HTTP/1.1\r\nHost: 127.0.0.1:${upPort}\r\n\r\n`);
    expect(await chunk(client)).toMatch(/200/); // "200 Connection established"

    client.write("ping");
    expect(await chunk(client)).toBe("ping"); // tunnelled through to the echo upstream

    expect(hosts).toContainEqual({ host: "127.0.0.1", port: upPort }); // host observed
    client.destroy();
  });

  it("exposes a random localhost port and closes cleanly", async () => {
    const proxy = await startEgressProxy({ onHost: () => {} });
    expect(proxy.port).toBeGreaterThan(0);
    await new Promise<void>((r) => proxy.close(r)); // close accepts a callback
    // a fresh connect should now fail (server gone)
    const c = net.connect(proxy.port, "127.0.0.1");
    await expect(new Promise((_, rej) => c.once("error", rej))).rejects.toBeTruthy();
    c.destroy();
  });
});
