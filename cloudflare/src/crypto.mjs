export const utf8 = new TextEncoder();
export const hex = (bytes) =>
  [...new Uint8Array(bytes)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
export const sha256 = async (value) =>
  hex(await crypto.subtle.digest("SHA-256", utf8.encode(value)));
export const hmacKey = (bytes) =>
  crypto.subtle.importKey(
    "raw",
    typeof bytes === "string" ? utf8.encode(bytes) : bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
export const hmac = async (key, value) =>
  crypto.subtle.sign("HMAC", await hmacKey(key), utf8.encode(value));
export const unbase64 = (value) =>
  Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
export const encode64 = (value) =>
  btoa(String.fromCharCode(...utf8.encode(value)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
export const decode64 = (value) => new TextDecoder().decode(unbase64(value));
export async function secureEqual(a, b) {
  if (!a || !b) return false;
  const k = await hmacKey("deli-berry-constant-time-comparison");
  return crypto.subtle.verify(
    "HMAC",
    k,
    await crypto.subtle.sign("HMAC", k, utf8.encode(a)),
    utf8.encode(b),
  );
}
