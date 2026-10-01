/** Normalize a LAN host or an HTTP(S) origin without appending a second port. */
export function serverEndpoint(input: string): { http: string; ws: string } {
  const raw = input.trim();
  if (!raw) throw new Error("Enter your server address.");
  const explicit = /^[a-z][a-z\d+.-]*:\/\//i.test(raw);
  const url = new URL(explicit ? raw : `http://${raw}`);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname)
  ) {
    throw new Error(
      "Use a server origin, e.g. 192.168.1.10:8000 or https://server.example.com",
    );
  }
  if (!explicit && !url.port) url.port = "8000";
  const http = url.origin;
  return { http, ws: `${http.replace(/^http/, "ws")}/ws` };
}
