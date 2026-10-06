import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pg from "pg";

const { Pool } = pg;
const app = express();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false });
const jwtSecret = process.env.JWT_SECRET || "change-this-before-production";
const eventLog = [];
let eventCursor = 0;

app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (/^https:\/\/[a-z0-9-]+\.github\.io$/i.test(origin) || /^http:\/\/localhost(?::\d+)?$/i.test(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function publicUser(user) {
  if (!user) return null;
  const { password_hash: ignored, ...safeUser } = user;
  return safeUser;
}

function issueSession(user, res) {
  const token = jwt.sign({ id: user.id }, jwtSecret, { expiresIn: "30d" });
  res.cookie("carsongames_session", token, { httpOnly: true, sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", secure: process.env.NODE_ENV === "production", maxAge: 30 * 24 * 60 * 60 * 1000 });
  return token;
}

async function currentUser(req) {
  try {
    const authorization = req.get("Authorization");
    const bearerToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const payload = jwt.verify(bearerToken || req.cookies.carsongames_session, jwtSecret);
    const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [payload.id]);
    return rows[0] || null;
  } catch {
    return null;
  }
}

function requireUser(handler) {
  return async (req, res, next) => {
    req.user = await currentUser(req);
    if (!req.user) return res.status(401).json({ error: "You must be signed in." });
    return handler(req, res, next);
  };
}

function safeIdentifier(value) {
  return typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function publishEvent(channel, event, payload) {
  eventLog.push({ cursor: ++eventCursor, channel, event, payload });
  if (eventLog.length > 2000) eventLog.shift();
}

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (error) {
    res.status(503).json({ ok: false, error: error.message });
  }
});

app.post("/api/auth/signup", async (req, res) => {
  const { password, username } = req.body;
  const normalizedUsername = String(username || "").trim();
  if (!password || !normalizedUsername || /\s/.test(normalizedUsername)) return res.status(400).json({ error: "A valid username and password are required." });
  try {
    const id = crypto.randomUUID();
    const hash = await bcrypt.hash(password, 12);
    const internalEmail = `${normalizedUsername.toLowerCase()}@accounts.carsongames.local`;
    const { rows } = await pool.query("INSERT INTO users (id, email, password_hash, username) VALUES ($1, $2, $3, $4) RETURNING *", [id, internalEmail, hash, normalizedUsername]);
    const token = issueSession(rows[0], res);
    res.status(201).json({ user: publicUser(rows[0]), token });
  } catch (error) {
    res.status(error.code === "23505" ? 409 : 500).json({ error: error.code === "23505" ? "Username is already in use." : "Could not create account." });
  }
});

app.post("/api/auth/signin", async (req, res) => {
  const { username, password } = req.body;
  const { rows } = await pool.query("SELECT * FROM users WHERE LOWER(username) = LOWER($1)", [String(username || "").trim()]);
  if (!rows[0] || !(await bcrypt.compare(password || "", rows[0].password_hash))) return res.status(401).json({ error: "Invalid username or password." });
  const token = issueSession(rows[0], res);
  res.json({ user: publicUser(rows[0]), token });
});

app.post("/api/auth/signout", (_req, res) => {
  res.clearCookie("carsongames_session");
  res.json({ ok: true });
});

app.get("/api/events", requireUser(async (req, res) => {
  const after = Number(req.query.after || 0);
  res.json({ events: eventLog.filter(event => event.cursor > after), nextCursor: eventCursor });
}));

app.post("/api/events/broadcast", requireUser(async (req, res) => {
  if (typeof req.body.channel !== "string" || typeof req.body.event !== "string") return res.status(400).json({ error: "Invalid event." });
  publishEvent(req.body.channel, req.body.event, req.body.payload || {});
  res.json({ ok: true });
}));

app.put("/api/storage/:bucket/*", requireUser(async (req, res) => {
  const objectPath = req.params[0];
  const chunks = [];
  req.on("data", chunk => chunks.push(chunk));
  req.on("end", async () => {
    try {
      await pool.query("INSERT INTO storage_objects (bucket, path, content_type, data) VALUES ($1, $2, $3, $4) ON CONFLICT (bucket, path) DO UPDATE SET content_type = EXCLUDED.content_type, data = EXCLUDED.data", [req.params.bucket, objectPath, req.headers["content-type"] || "application/octet-stream", Buffer.concat(chunks)]);
      res.json({ ok: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });
}));

app.get("/api/storage/:bucket", requireUser(async (req, res) => {
  const { rows } = await pool.query("SELECT path AS name, octet_length(data) AS size FROM storage_objects WHERE bucket = $1 AND path LIKE $2 ORDER BY path", [req.params.bucket, `${req.query.prefix || ""}%`]);
  res.json({ files: rows });
}));

app.get("/api/storage/:bucket/*", async (req, res) => {
  const { rows } = await pool.query("SELECT content_type, data FROM storage_objects WHERE bucket = $1 AND path = $2", [req.params.bucket, req.params[0]]);
  if (!rows[0]) return res.sendStatus(404);
  res.type(rows[0].content_type).send(rows[0].data);
});

app.delete("/api/storage/:bucket", requireUser(async (req, res) => {
  await pool.query("DELETE FROM storage_objects WHERE bucket = $1 AND path = ANY($2)", [req.params.bucket, req.body.paths || []]);
  res.json({ ok: true });
}));

app.get("/api/auth/user", async (req, res) => res.json({ user: publicUser(await currentUser(req)) }));

app.patch("/api/auth/password", requireUser(async (req, res) => {
  const hash = await bcrypt.hash(req.body.password || "", 12);
  await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, req.user.id]);
  res.json({ ok: true });
}));

app.post("/api/db/query", requireUser(async (req, res) => {
  const { table, operation, values = [], filters = [], select = "*", order, offset = 0, limit, rows: inputRows, returning } = req.body;
  if (!safeIdentifier(table)) return res.status(400).json({ error: "Invalid collection." });
  if (table === "users" && !["select", "update"].includes(operation)) return res.status(400).json({ error: "Unsupported users operation." });
  const isNative = table === "users" || table === "announcements";
  const params = [];
  const where = filters.map(({ column, operator = "eq", value }) => {
    if (!safeIdentifier(column) || !["eq", "neq", "in", "not_null", "ilike", "contains", "gte"].includes(operator)) throw new Error("Invalid filter.");
    const field = isNative ? `"${column}"` : (column === "id" ? `"id"` : `data->>'${column}'`);
    if (operator === "not_null") return `${field} IS NOT NULL`;
    if (operator === "in") { params.push(value); return `${field} = ANY($${params.length})`; }
    if (operator === "contains") { params.push(JSON.stringify(value)); return `${isNative ? field : `data->'${column}'`} @> $${params.length}::jsonb`; }
    if (operator === "ilike") { params.push(value); return `${field} ILIKE $${params.length}`; }
    if (operator === "gte") { params.push(value); return `${field} >= $${params.length}`; }
    params.push(value); return `${field} ${operator === "neq" ? "<>" : "="} $${params.length}`;
  });
  const whereSql = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const tableSql = isNative ? `"${table}"` : "app_records";
  const collectionSql = isNative ? "" : (where.length ? " AND" : " WHERE") + ` collection = $${params.length + 1}`;
  if (!isNative) params.push(table);
  if (operation === "select") {
    const columns = isNative ? (select === "*" ? "*" : select.split(",").filter(safeIdentifier).map(column => `"${column}"`).join(",")) : "id, data";
    const orderField = order?.column && safeIdentifier(order.column) ? (isNative ? `"${order.column}"` : (order.column === "id" ? `"id"` : `data->>'${order.column}'`)) : "created_at";
    const orderSql = ` ORDER BY ${orderField} ${order?.ascending === false ? "DESC" : "ASC"}`;
    const limitSql = Number.isInteger(limit) ? ` LIMIT ${Math.max(1, Math.min(limit, 100))}` : "";
    const offsetSql = Number.isInteger(offset) && offset > 0 ? ` OFFSET ${offset}` : "";
    const { rows } = await pool.query(`SELECT ${columns} FROM ${tableSql}${whereSql}${collectionSql}${orderSql}${limitSql}${offsetSql}`, params);
    const result = isNative ? rows : rows.map(row => ({ id: row.id, ...row.data }));
    return res.json({ data: result, error: null });
  }
  if (operation === "insert") {
    const items = inputRows || values;
    const inserted = [];
    for (const item of items) {
      const id = item.id || crypto.randomUUID();
      if (isNative) {
        const columns = Object.keys(item).filter(column => safeIdentifier(column) && column !== "id");
        const insertValues = columns.map(column => item[column]);
        await pool.query(`INSERT INTO "${table}" (id, ${columns.map(column => `"${column}"`).join(",")}) VALUES ($1, ${columns.map((_, index) => `$${index + 2}`).join(",")})`, [id, ...insertValues]);
      } else await pool.query("INSERT INTO app_records (id, collection, data) VALUES ($1, $2, $3)", [id, table, item]);
      inserted.push({ id, ...item });
    }
    return res.json({ data: inserted, error: null });
  }
  if (operation === "update" || operation === "delete") {
    if (!isNative) {
      const data = operation === "update" ? values[0] : null;
      const mutationFilterParams = [];
      const genericWhere = filters.map(({ column, operator = "eq", value }) => {
        const field = operator === "contains" ? `data->'${column}'` : `data->>'${column}'`;
        if (operator === "not_null") return `${field} IS NOT NULL`;
        if (operator === "in") {
          mutationFilterParams.push(value);
          return `${field} = ANY($${mutationFilterParams.length + (operation === "update" ? 2 : 1)})`;
        }
        mutationFilterParams.push(operator === "contains" ? JSON.stringify(value) : value);
        const parameter = mutationFilterParams.length + (operation === "update" ? 2 : 1);
        if (operator === "contains") return `${field} @> $${parameter}::jsonb`;
        if (operator === "ilike") return `${field} ILIKE $${parameter}`;
        if (operator === "gte") return `${field} >= $${parameter}`;
        return `${field} ${operator === "neq" ? "<>" : "="} $${parameter}`;
      }).join(" AND ");
      const updateParams = operation === "update" ? [JSON.stringify(data), table, ...mutationFilterParams] : [table, ...mutationFilterParams];
      const collectionParameter = operation === "update" ? 2 : 1;
      const mutation = `${operation === "update" ? "UPDATE app_records SET data = data || $1::jsonb" : "DELETE FROM app_records"} WHERE collection = $${collectionParameter}${genericWhere ? ` AND ${genericWhere}` : ""}${operation === "update" && returning ? " RETURNING id, data" : ""}`;
      const result = await pool.query(mutation, updateParams);
      if (operation === "update" && returning) return res.json({ data: result.rows.map(row => ({ id: row.id, ...row.data })), error: null });
    } else if (operation === "delete") await pool.query(`DELETE FROM "${table}"${whereSql}`, params);
    else {
      const entries = Object.keys(values[0] || {}).filter(safeIdentifier);
      const result = await pool.query(`UPDATE "${table}" SET ${entries.map((column, index) => `"${column}" = $${index + 1}`).join(", ")} ${whereSql}${returning ? " RETURNING *" : ""}`, [...entries.map(column => values[0][column]), ...params]);
      if (returning) return res.json({ data: result.rows, error: null });
    }
    if (returning) {
      const { rows } = await pool.query(`SELECT * FROM ${tableSql}${whereSql}${collectionSql}`, params);
      return res.json({ data: isNative ? rows : rows.map(row => ({ id: row.id, ...row.data })), error: null });
    }
    return res.json({ data: [], error: null });
  }
  res.status(400).json({ error: "Unsupported database operation." });
}));

app.use(express.static(root));
app.get("*", (req, res, next) => req.path.startsWith("/api/") ? next() : res.sendFile(path.join(root, "index.html")));
app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));

const port = process.env.PORT || 3000;
const schema = await fs.readFile(new URL("./schema.sql", import.meta.url), "utf8");
try {
  await pool.query(schema);
  app.listen(port, () => console.log(`CarsonGames server listening on ${port}`));
} catch (error) {
  console.error("Database initialization failed:", error.message);
  process.exitCode = 1;
}