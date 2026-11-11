import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";

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


http.route({
  path: "/api/auth/signout",
  method: "POST",
  handler: httpAction(async () => json({ ok: true })),
});
http.route({
  path: "/api/auth/password",
  method: "PATCH",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      await ctx.runAction(api.legacy.updatePassword, { token: bearer(request), password: String(body.password ?? "") });
      return json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update password.";
      return json({ error: message }, message.includes("signed in") ? 401 : 400);
    }
  }),
});
http.route({
  path: "/api/events",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const after = Number(new URL(request.url).searchParams.get("after") || 0);
      return json(await ctx.runAction(api.legacy.listEvents, { token: bearer(request), after: Number.isFinite(after) ? after : 0 }));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Could not read events." }, 401);
    }
  }),
});
http.route({
  path: "/api/events/broadcast",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json();
      if (typeof body.channel !== "string" || typeof body.event !== "string") return json({ error: "Invalid event." }, 400);
      await ctx.runAction(api.legacy.publishEvent, { token: bearer(request), channel: body.channel, event: body.event, payload: body.payload ?? {} });
      return json({ ok: true });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Could not publish event." }, 401);
    }
  }),
});
http.route({
  path: "/api/health",
  method: "GET",
  handler: httpAction(async () => json({ ok: true, backend: "convex" })),
});
http.route({
  path: "/api/auth/signin",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS" } })),
});
http.route({
  path: "/api/auth/user",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS" } })),
});
http.route({
  path: "/api/auth/password",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS" } })),
});
http.route({
  path: "/api/events",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS" } })),
});
http.route({
  path: "/api/events/broadcast",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS" } })),
});


http.route({ path: "/api/storage/upload", method: "POST", handler: httpAction(async (ctx, request) => {
  try {
    const body = await request.json();
    const result = await ctx.runAction(api.storage.save, {
      token: bearer(request), bucket: String(body.bucket || ""), path: String(body.path || ""),
      contentType: String(body.contentType || "application/octet-stream"), data: String(body.data || "")
    });
    return json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed.";
    return json({ error: message }, message.includes("signed in") ? 401 : 400);
  }
})});
http.route({ path: "/api/storage/list", method: "POST", handler: httpAction(async (ctx, request) => {
  try {
    const body = await request.json();
    return json(await ctx.runAction(api.storage.list, { token: bearer(request), bucket: String(body.bucket || ""), prefix: String(body.prefix || "") }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not list files.";
    return json({ error: message }, message.includes("signed in") ? 401 : 400);
  }
})});
http.route({ path: "/api/storage/remove", method: "POST", handler: httpAction(async (ctx, request) => {
  try {
    const body = await request.json();
    const paths = Array.isArray(body.paths) ? body.paths.map(String) : [];
    return json(await ctx.runAction(api.storage.remove, { token: bearer(request), bucket: String(body.bucket || ""), paths }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not remove files.";
    return json({ error: message }, message.includes("signed in") ? 401 : 400);
  }
})});
http.route({ path: "/api/storage/public", method: "GET", handler: httpAction(async (ctx, request) => {
  try {
    const url = new URL(request.url);
    const item = await ctx.runQuery(internal.storage.find, { bucket: url.searchParams.get("bucket") || "", path: url.searchParams.get("path") || "" });
    if (!item) return new Response("Not found", { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
    const blob = await ctx.storage.get(item.storageId);
    if (!blob) return new Response("Not found", { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
    return new Response(blob, { status: 200, headers: { "Content-Type": item.contentType, "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } });
  } catch {
    return new Response("Could not read file", { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
  }
})});
for (const path of ["/api/storage/upload", "/api/storage/list", "/api/storage/remove"]) {
  http.route({ path, method: "OPTIONS", handler: httpAction(async () => new Response(null, { status: 204, headers: {
    "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS"
  }} )});
}


http.route({ path: "/api/blackjack/match", method: "POST", handler: httpAction(async (ctx, request) => {
  try {
    const body = await request.json();
    return json(await ctx.runAction(api.blackjack.join, { name: String(body.name || "") }));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not join a table." }, 400);
  }
})});
http.route({ path: "/api/blackjack/match/:matchId", method: "GET", handler: httpAction(async (ctx, request) => {
  try {
    const url = new URL(request.url);
    return json(await ctx.runAction(api.blackjack.get, { matchId: url.pathname.split("/").pop() || "", playerId: url.searchParams.get("playerId") || "" }));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not load the table." }, 400);
  }
})});
http.route({ path: "/api/blackjack/match/:matchId/action", method: "POST", handler: httpAction(async (ctx, request) => {
  try {
    const body = await request.json();
    const matchId = new URL(request.url).pathname.split("/").slice(-2, -1)[0] || "";
    return json(await ctx.runAction(api.blackjack.act, { matchId, playerId: String(body.playerId || ""), action: String(body.action || "") }));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Action failed." }, 400);
  }
})});


for (const path of ["/api/blackjack/match", "/api/blackjack/match/:matchId/action"]) {
  http.route({ path, method: "OPTIONS", handler: httpAction(async () => new Response(null, { status: 204, headers: {
    "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS"
  }} )});
}

export default http;
