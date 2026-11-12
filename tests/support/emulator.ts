/**
 * TEST ONLY — a small stand-in for the parts of Supabase that cannot run in CI without Docker:
 * Auth (GoTrue) and Storage, speaking the same HTTP protocol the official supabase-js client
 * uses, plus a fake Resend endpoint. The database is NOT emulated: tests run against a real
 * Postgres with the real migration and real Row Level Security.
 *
 * Like real Supabase with no storage policies, Storage here refuses everything except the
 * service role and valid signed URLs.
 */
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import busboy from "busboy";
import postgres from "postgres";
import { JWT_SECRET, GOOD_RESEND_KEY, signJwt, verifyJwt } from "./env";

type Ctx = { sql: postgres.Sql; dir: string; outbox: unknown[]; refresh: Map<string, string> };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Expose-Headers": "*",
};

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(status, { ...CORS, "Content-Type": isBuf ? "application/octet-stream" : "application/json", ...headers });
  res.end(isBuf ? body : body === undefined ? "" : JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Reads an upload: either a raw body, or multipart form data as sent by browsers. */
function readUpload(req: IncomingMessage): Promise<{ bytes: Buffer; contentType: string }> {
  const type = req.headers["content-type"] ?? "application/octet-stream";
  if (!type.startsWith("multipart/form-data")) return readBody(req).then((bytes) => ({ bytes, contentType: type }));
  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: req.headers });
    let out: { bytes: Buffer; contentType: string } | null = null;
    bb.on("file", (_name, stream, info) => {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => (out = { bytes: Buffer.concat(chunks), contentType: info.mimeType }));
    });
    bb.on("close", () => (out ? resolve(out) : reject(new Error("no file part"))));
    bb.on("error", reject);
    req.pipe(bb);
  });
}

const bearer = (req: IncomingMessage) => verifyJwt((req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
const hashPw = (pw: string) => createHash("sha256").update(`emulator:${pw}`).digest("hex");
const signPath = (p: string, exp: number, purpose: string) => createHmac("sha256", JWT_SECRET).update(`${purpose}:${p}:${exp}`).digest("base64url");

function userJson(u: { id: string; email: string; raw_user_meta_data: unknown; created_at: Date }) {
  const at = new Date(u.created_at).toISOString();
  return {
    id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: at, phone: "",
    confirmed_at: at, last_sign_in_at: at, app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: u.raw_user_meta_data ?? {}, identities: [], created_at: at, updated_at: at, is_anonymous: false,
  };
}

function session(ctx: Ctx, u: Parameters<typeof userJson>[0]) {
  const now = Math.floor(Date.now() / 1000);
  const refresh = randomBytes(18).toString("base64url");
  ctx.refresh.set(refresh, u.id);
  return {
    access_token: signJwt({ sub: u.id, email: u.email, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600, session_id: randomUUID() }),
    token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: refresh, user: userJson(u),
  };
}

async function auth(ctx: Ctx, req: IncomingMessage, res: ServerResponse, url: URL) {
  const route = url.pathname.replace("/auth/v1", "");
  const body = req.method === "POST" || req.method === "PUT" ? JSON.parse((await readBody(req)).toString() || "{}") : {};

  if (route === "/signup" && req.method === "POST") {
    const email = String(body.email ?? "").toLowerCase();
    if (!email || String(body.password ?? "").length < 6) return send(res, 422, { code: 422, error_code: "weak_password", msg: "Password should be at least 6 characters" });
    const [dupe] = await ctx.sql`select id from auth.users where email = ${email}`;
    if (dupe) return send(res, 422, { code: 422, error_code: "user_already_exists", msg: "User already registered" });
    const [u] = await ctx.sql`insert into auth.users (email, encrypted_password, raw_user_meta_data) values (${email}, ${hashPw(body.password)}, ${ctx.sql.json(body.data ?? {})}) returning *`;
    return send(res, 200, session(ctx, u as never));
  }
  if (route === "/token" && req.method === "POST") {
    const grant = url.searchParams.get("grant_type");
    if (grant === "password") {
      const [u] = await ctx.sql`select * from auth.users where email = ${String(body.email ?? "").toLowerCase()}`;
      if (!u || u.encrypted_password !== hashPw(String(body.password ?? ""))) return send(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
      return send(res, 200, session(ctx, u as never));
    }
    if (grant === "refresh_token") {
      const id = ctx.refresh.get(String(body.refresh_token ?? ""));
      const [u] = id ? await ctx.sql`select * from auth.users where id = ${id}` : [];
      if (!u) return send(res, 400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
      ctx.refresh.delete(String(body.refresh_token));
      return send(res, 200, session(ctx, u as never));
    }
  }
  if (route === "/user" && req.method === "GET") {
    const claims = bearer(req);
    const [u] = claims?.sub ? await ctx.sql`select * from auth.users where id = ${String(claims.sub)}` : [];
    if (!u) return send(res, 403, { code: 403, error_code: "bad_jwt", msg: "invalid JWT" });
    return send(res, 200, userJson(u as never));
  }
  if (route === "/logout" && req.method === "POST") return send(res, 204, undefined);
  if (route === "/admin/users" && req.method === "POST") {
    if (bearer(req)?.role !== "service_role") return send(res, 403, { code: 403, msg: "not allowed" });
    const [u] = await ctx.sql`
      insert into auth.users (email, encrypted_password, raw_user_meta_data) values (${String(body.email).toLowerCase()}, ${hashPw(body.password)}, ${ctx.sql.json(body.user_metadata ?? {})})
      on conflict (email) do update set encrypted_password = excluded.encrypted_password returning *`;
    return send(res, 200, userJson(u as never));
  }
  return send(res, 404, { code: 404, msg: `emulator: unsupported auth route ${req.method} ${route}` });
}

const storageError = (res: ServerResponse, status: number, error: string, message: string) => send(res, status === 404 ? 400 : status, { statusCode: String(status), error, message });

async function storage(ctx: Ctx, req: IncomingMessage, res: ServerResponse, url: URL) {
  const route = decodeURIComponent(url.pathname.replace("/storage/v1", ""));
  const isService = bearer(req)?.role === "service_role";
  const denied = () => storageError(res, 403, "Unauthorized", "new row violates row-level security policy");
  const fileOf = (key: string) => {
    const full = path.join(ctx.dir, key);
    if (!full.startsWith(ctx.dir + path.sep) || key.includes("..")) throw new Error("bad path");
    return full;
  };
  const bucketOf = async (key: string) => (await ctx.sql`select * from storage.buckets where id = ${key.split("/")[0]}`)[0];

  const store = async (key: string, upsert: boolean) => {
    const bucket = await bucketOf(key);
    if (!bucket) return storageError(res, 404, "Bucket not found", "Bucket not found");
    const { bytes, contentType } = await readUpload(req);
    const mime = contentType.split(";")[0].trim();
    if (bucket.allowed_mime_types && !bucket.allowed_mime_types.includes(mime)) return storageError(res, 415, "invalid_mime_type", `mime type ${mime} is not supported`);
    if (bucket.file_size_limit && bytes.length > Number(bucket.file_size_limit)) return storageError(res, 413, "Payload too large", "The object exceeded the maximum allowed size");
    const full = fileOf(key);
    if (existsSync(full) && !upsert) return storageError(res, 409, "Duplicate", "The resource already exists");
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, bytes);
    writeFileSync(`${full}.meta`, mime);
    return send(res, 200, { Id: randomUUID(), Key: key });
  };
  const serve = (key: string, download: string | null) => {
    const full = fileOf(key);
    if (!existsSync(full)) return storageError(res, 404, "not_found", "Object not found");
    const headers: Record<string, string> = { "Content-Type": readFileSync(`${full}.meta`, "utf8"), "Cache-Control": "no-store" };
    if (download !== null) headers["Content-Disposition"] = `attachment; filename="${download || path.basename(key)}"`;
    res.writeHead(200, { ...CORS, ...headers });
    res.end(readFileSync(full));
  };

  let m: RegExpExecArray | null;
  if ((m = /^\/bucket\/([^/]+)$/.exec(route)) && req.method === "GET") {
    if (!isService) return denied();
    const [b] = await ctx.sql`select * from storage.buckets where id = ${m[1]}`;
    return b ? send(res, 200, b) : storageError(res, 404, "Bucket not found", "Bucket not found");
  }
  if ((m = /^\/object\/upload\/sign\/(.+)$/.exec(route))) {
    if (req.method === "POST") {
      if (!isService) return denied();
      const exp = Math.floor(Date.now() / 1000) + 7200;
      return send(res, 200, { url: `/object/upload/sign/${m[1]}?token=${exp}.${signPath(m[1], exp, "upload")}` });
    }
    if (req.method === "PUT") {
      const [exp, sig] = (url.searchParams.get("token") ?? "").split(".");
      if (!exp || Number(exp) < Date.now() / 1000 || sig !== signPath(m[1], Number(exp), "upload")) return storageError(res, 400, "InvalidSignature", "signature verification failed");
      return store(m[1], false);
    }
  }
  if ((m = /^\/object\/sign\/(.+)$/.exec(route))) {
    if (req.method === "POST") {
      if (!isService) return denied();
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      if (!existsSync(fileOf(m[1]))) return storageError(res, 404, "not_found", "Object not found");
      const exp = Math.floor(Date.now() / 1000) + Number(body.expiresIn ?? 60);
      return send(res, 200, { signedURL: `/object/sign/${m[1]}?token=${exp}.${signPath(m[1], exp, "read")}` });
    }
    if (req.method === "GET") {
      const [exp, sig] = (url.searchParams.get("token") ?? "").split(".");
      if (!exp || Number(exp) < Date.now() / 1000 || sig !== signPath(m[1], Number(exp), "read")) return storageError(res, 400, "InvalidJWT", "signature verification failed or expired");
      return serve(m[1], url.searchParams.get("download"));
    }
  }
  if ((m = /^\/object\/(?:authenticated\/|public\/)?(.+)$/.exec(route))) {
    if (req.method === "POST" || req.method === "PUT") {
      if (!isService) return denied();
      return store(m[1], req.method === "PUT" || req.headers["x-upsert"] === "true");
    }
    if (req.method === "GET") {
      if (!isService) return denied();
      return serve(m[1], null);
    }
    if (req.method === "DELETE") {
      if (!isService) return denied();
      const body = JSON.parse((await readBody(req)).toString() || "{}") as { prefixes?: string[] };
      for (const p of body.prefixes ?? []) {
        rmSync(fileOf(`${m[1]}/${p}`), { force: true });
        rmSync(`${fileOf(`${m[1]}/${p}`)}.meta`, { force: true });
      }
      return send(res, 200, (body.prefixes ?? []).map((name) => ({ name })));
    }
  }
  return storageError(res, 404, "not_found", `emulator: unsupported storage route ${req.method} ${route}`);
}

async function resend(ctx: Ctx, req: IncomingMessage, res: ServerResponse, url: URL) {
  if (url.pathname === "/resend/outbox") {
    if (req.method === "DELETE") ctx.outbox.length = 0;
    return send(res, 200, ctx.outbox);
  }
  if (url.pathname === "/resend/emails" && req.method === "POST") {
    const key = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (key !== GOOD_RESEND_KEY) return send(res, 401, { statusCode: 401, name: "validation_error", message: "API key is invalid" });
    const body = JSON.parse((await readBody(req)).toString());
    ctx.outbox.push(body);
    return send(res, 200, { id: randomUUID() });
  }
  return send(res, 404, {});
}

export async function startEmulator(opts: { port: number; databaseUrl: string; dir: string; reset?: boolean }): Promise<{ close: () => Promise<void>; server: Server }> {
  if (opts.reset) rmSync(opts.dir, { recursive: true, force: true });
  mkdirSync(opts.dir, { recursive: true });
  const ctx: Ctx = { sql: postgres(opts.databaseUrl, { max: 3, onnotice: () => {} }), dir: path.resolve(opts.dir), outbox: [], refresh: new Map() };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (req.method === "OPTIONS") return send(res, 204, undefined);
    const run = url.pathname.startsWith("/auth/v1") ? auth : url.pathname.startsWith("/storage/v1") ? storage : url.pathname.startsWith("/resend") ? resend : null;
    if (!run) return send(res, url.pathname === "/health" ? 200 : 404, { ok: url.pathname === "/health" });
    run(ctx, req, res, url).catch((err) => {
      if (!res.headersSent) send(res, 500, { message: `emulator error: ${err instanceof Error ? err.message : err}` });
    });
  });
  await new Promise<void>((resolve) => server.listen(opts.port, "127.0.0.1", resolve));
  return { server, close: async () => { await new Promise((r) => server.close(r)); await ctx.sql.end({ timeout: 2 }); } };
}
