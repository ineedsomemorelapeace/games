import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const http = httpRouter();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
      "Cache-Control": "no-store",
    },
  });
}

function bearer(request: Request) {
  return request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
}

http.route({
  path: "/api/auth/signup",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    },
  })),
});

http.route({
  path: "/api/auth/signup",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const result = await ctx.runAction(api.auth.signUp, {
        username: String(body.username ?? ""),
        password: String(body.password ?? ""),
      });
      return json(result, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create account.";
      return json({ error: message.includes("already in use") ? message : message }, message.includes("already in use") ? 409 : 400);
    }
  }),
});

http.route({
  path: "/api/auth/signin",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const result = await ctx.runAction(api.auth.signIn, {
        username: String(body.username ?? ""),
        password: String(body.password ?? ""),
      });
      return json(result);
    } catch {
      return json({ error: "Invalid username or password." }, 401);
    }
  }),
});

http.route({
  path: "/api/auth/user",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const user = await ctx.runAction(api.auth.getUser, { token: bearer(request) });
      return user ? json({ user }) : json({ user: null }, 401);
    } catch {
      return json({ user: null }, 401);
    }
  }),
});

export default http;

http.route({
  path: "/api/db/query",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      const token = bearer(request);
      const result = await ctx.runAction(api.db.runQuery, {
        token,
        table: String(body.table ?? ""),
        operation: String(body.operation ?? "select"),
        filters: Array.isArray(body.filters) ? body.filters : [],
        order: body.order ?? undefined,
        limit: typeof body.limit === "number" ? body.limit : undefined,
        offset: typeof body.offset === "number" ? body.offset : undefined,
        rows: body.rows,
        values: body.values,
      });
      return json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Database request failed.";
      return json({ error: message }, message.includes("signed in") ? 401 : 400);
    }
  }),
});

http.route({
  path: "/api/db/query",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    },
  })),
});
