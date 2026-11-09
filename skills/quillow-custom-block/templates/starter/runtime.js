/*! @quillow/custom-block-sdk
MIT License

Copyright (c) 2026 Quillow

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
// src/protocol.ts
var PROTOCOL = "quillow:custom-block";
var VERSION = 1;
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isMessage(value, type) {
  return isRecord(value) && value.protocol === PROTOCOL && value.version === VERSION && value.type === type;
}
function isContext(value) {
  if (!isRecord(value) || !isRecord(value.theme) || !isRecord(value.layout)) return false;
  const { theme, layout } = value;
  return ["editor", "published"].includes(value.environment) && ["light", "dark"].includes(theme.mode) && ["Normal", "Pill", "Sharp"].includes(theme.cornerStyle) && isRecord(theme.variables) && Object.entries(theme.variables).every(
    ([key, val]) => /^--quillow-[a-z0-9-]+$/.test(key) && typeof val === "string"
  ) && (theme.fontStylesheet === null || typeof theme.fontStylesheet === "string" && isHttpUrl(theme.fontStylesheet)) && ["1:1", "2:1", "2:2"].includes(layout.size) && ["mobile", "desktop"].includes(layout.viewport) && typeof layout.width === "number" && Number.isFinite(layout.width) && layout.width >= 0 && typeof layout.height === "number" && Number.isFinite(layout.height) && layout.height >= 0;
}
function isHttpUrl(value) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
function message(type, context) {
  return { protocol: PROTOCOL, version: VERSION, type, ...context ? { context } : {} };
}

// src/errors.ts
var WidgetSDKError = class extends Error {
  code;
  details;
  /** True only when a sent mutation might have succeeded without an acknowledged result. */
  mutationMayHaveSucceeded;
  constructor(code, message2, options = {}) {
    super(message2, { cause: options.cause });
    this.name = "WidgetSDKError";
    this.code = code;
    this.details = options.details;
    this.mutationMayHaveSucceeded = options.mutationMayHaveSucceeded ?? false;
  }
};
function invalidArgument(message2) {
  throw new WidgetSDKError("INVALID_ARGUMENT", message2);
}
function protocolError(message2, cause) {
  return new WidgetSDKError("PROTOCOL_ERROR", message2, { cause });
}
function uncertainMutation(error) {
  return new WidgetSDKError(
    error.code,
    `${error.message}. This mutation may already have been saved; do not retry it automatically.`,
    { details: error.details, cause: error, mutationMayHaveSucceeded: true }
  );
}

// src/json.ts
function isPlainObject(value) {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function snapshotJson(value) {
  const ancestors = /* @__PURE__ */ new Set();
  const visit = (input) => {
    if (input === null || typeof input === "string" || typeof input === "boolean") return input;
    if (typeof input === "number" && Number.isFinite(input)) return input;
    if (typeof input !== "object" || input === null)
      return invalidArgument("Storage values must contain only finite numbers and plain JSON data");
    const array = Array.isArray(input);
    if (array ? Object.getPrototypeOf(input) !== Array.prototype : !isPlainObject(input))
      return invalidArgument(
        "Storage values must use plain objects and arrays, not class instances"
      );
    if (ancestors.has(input)) return invalidArgument("Storage values must not contain cycles");
    ancestors.add(input);
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    const result = array ? [] : {};
    if (array && keys.length !== input.length + 1)
      return invalidArgument("Storage arrays must not contain holes or extra properties");
    for (const key of keys) {
      if (array && key === "length") continue;
      if (typeof key !== "string")
        return invalidArgument("Storage objects must not contain symbol properties");
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !("value" in descriptor))
        return invalidArgument(
          "Storage values must not contain getters or non-enumerable properties"
        );
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= input.length))
        return invalidArgument("Storage arrays must not contain extra properties");
      Object.defineProperty(result, key, {
        value: visit(descriptor.value),
        enumerable: true,
        configurable: true,
        writable: true
      });
    }
    ancestors.delete(input);
    return result;
  };
  try {
    return visit(value);
  } catch (error) {
    if (error instanceof WidgetSDKError) throw error;
    throw new WidgetSDKError("INVALID_ARGUMENT", "Unable to read the JSON value safely", {
      cause: error
    });
  }
}
function readOptions(value, allowed) {
  if (!isPlainObject(value)) return invalidArgument("Options must be a plain object");
  const result = /* @__PURE__ */ Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !allowed.includes(key) || !("value" in descriptor))
      return invalidArgument("Options contain an unknown property or getter");
    result[key] = descriptor.value;
  }
  return result;
}

// src/storage.ts
function validKey(key) {
  return typeof key === "string" && key.length > 0 && !/[\p{Cc}\uD800-\uDFFF]/u.test(key) && new TextEncoder().encode(key).length <= 128;
}
function checkKey(key) {
  if (!validKey(key)) invalidArgument("Keys must be 1\u2013128 UTF-8 bytes without control characters");
}
function checkRevision(revision) {
  if (typeof revision !== "string" || revision.length === 0)
    invalidArgument("expectedRevision must be a non-empty revision token");
}
function validValue(value) {
  return typeof value === "string" && !/[\u0000\uD800-\uDFFF]/u.test(value);
}
function timestamp(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}
function entry(value, expectedKey) {
  if (!isRecord(value) || !validKey(value.key) || expectedKey !== void 0 && value.key !== expectedKey || !Object.hasOwn(value, "value") || !validValue(value.value) || typeof value.revision !== "string" || value.revision.length === 0 || !timestamp(value.createdAt) || !timestamp(value.updatedAt))
    throw protocolError("The host returned an invalid storage entry");
  return Object.freeze({
    key: value.key,
    value: value.value,
    revision: value.revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  });
}
function createStorage(context, request, assertOpen) {
  const authorize = (method) => {
    assertOpen();
    if (!context.capabilities.includes(method) || (method === "storage.set" || method === "storage.delete") && context.mode !== "editor")
      throw new WidgetSDKError("PERMISSION_DENIED", `The host has not permitted ${method}`);
  };
  return Object.freeze({
    async get(key) {
      authorize("storage.get");
      checkKey(key);
      const result = await request("storage.get", { key });
      return result === null ? null : entry(result, key);
    },
    async list(options = {}) {
      authorize("storage.list");
      const { after, limit = 50 } = readOptions(options, ["after", "limit"]);
      if (after !== void 0 && (typeof after !== "string" || after.length === 0))
        invalidArgument("after must be a non-empty cursor string");
      if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 100)
        invalidArgument("limit must be an integer from 1 to 100");
      const result = await request("storage.list", {
        limit,
        ...after !== void 0 ? { after } : {}
      });
      if (!isRecord(result) || !Array.isArray(result.entries) || result.entries.length > limit || result.nextCursor !== null && (typeof result.nextCursor !== "string" || result.nextCursor.length === 0) || result.entries.length === 0 && result.nextCursor !== null)
        throw protocolError("The host returned an invalid storage page");
      const entries = result.entries.map((item) => entry(item));
      if (new Set(entries.map((item) => item.key)).size !== entries.length)
        throw protocolError("The host returned duplicate storage keys");
      return Object.freeze({
        entries: Object.freeze(entries),
        nextCursor: result.nextCursor
      });
    },
    async set(key, value, options = {}) {
      authorize("storage.set");
      checkKey(key);
      const { expectedRevision } = readOptions(options, ["expectedRevision"]);
      if (!validValue(value))
        invalidArgument("Storage values must be strings without zero bytes or lone surrogates");
      if (expectedRevision !== void 0) checkRevision(expectedRevision);
      const result = await request("storage.set", {
        key,
        value,
        ...expectedRevision !== void 0 ? { expectedRevision } : {}
      });
      try {
        return entry(result, key);
      } catch (error) {
        throw uncertainMutation(error);
      }
    },
    async delete(key, options) {
      authorize("storage.delete");
      checkKey(key);
      const { expectedRevision } = readOptions(options, ["expectedRevision"]);
      checkRevision(expectedRevision);
      const result = await request("storage.delete", { key, expectedRevision });
      if (result !== true)
        throw uncertainMutation(protocolError("The host did not confirm deletion"));
      return true;
    }
  });
}

// src/connect.ts
var HEARTBEAT_INTERVAL = 15e3;
var HEARTBEAT_TIMEOUT = 1e4;
function timeoutOption(value, name) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 2147483647)
    invalidArgument(`${name} must be a positive integer no greater than 2147483647 milliseconds`);
  return value;
}
function readContext(value) {
  if (!isRecord(value) || typeof value.blockId !== "string" || value.blockId.length === 0 || typeof value.versionId !== "string" || value.versionId.length === 0 || value.mode !== "public" && value.mode !== "editor" || !Array.isArray(value.capabilities) || !value.capabilities.every(
    (capability) => typeof capability === "string" && capability.length > 0
  ) || new Set(value.capabilities).size !== value.capabilities.length || value.editor !== void 0 && (!isRecord(value.editor) || typeof value.editor.available !== "boolean"))
    throw protocolError("The host returned an invalid widget context");
  return Object.freeze({
    blockId: value.blockId,
    versionId: value.versionId,
    mode: value.mode,
    capabilities: Object.freeze([...value.capabilities]),
    ...isRecord(value.editor) ? { editor: Object.freeze({ available: value.editor.available }) } : {}
  });
}
function readError(value) {
  if (!isRecord(value) || typeof value.code !== "string" || value.code.length === 0 || typeof value.message !== "string" || value.message.length === 0)
    throw protocolError("The host returned an invalid error");
  try {
    return new WidgetSDKError(value.code, value.message, {
      ...Object.hasOwn(value, "details") ? { details: snapshotJson(value.details) } : {}
    });
  } catch (error) {
    throw protocolError("The host returned non-JSON error details", error);
  }
}
function createWidget(context, port, connectionId, requestTimeout) {
  let closed;
  let sequence = 0;
  let heartbeatTimer;
  let heartbeatId;
  const pending = /* @__PURE__ */ new Map();
  const frame = (type) => ({ ...message(type), connectionId });
  const mutation = (method) => method === "storage.set" || method === "storage.delete";
  const assertOpen = () => {
    if (closed) throw closed;
  };
  const close = (error) => {
    if (closed) return;
    closed = error;
    clearTimeout(heartbeatTimer);
    port.removeEventListener("message", receive);
    port.removeEventListener("messageerror", messageError);
    window.removeEventListener("pagehide", pagehide);
    document.removeEventListener("visibilitychange", visibilityChanged);
    port.close();
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(mutation(waiter.method) ? uncertainMutation(error) : error);
    }
    pending.clear();
  };
  const send = (data) => {
    try {
      port.postMessage(data);
    } catch (cause) {
      close(new WidgetSDKError("DISCONNECTED", "Unable to send a message to the host", { cause }));
    }
  };
  const scheduleHeartbeat = () => {
    clearTimeout(heartbeatTimer);
    heartbeatId = void 0;
    if (closed || document.hidden) return;
    heartbeatTimer = setTimeout(() => {
      heartbeatId = `ping:${++sequence}`;
      send({ ...frame("ping"), requestId: heartbeatId });
      if (closed) return;
      heartbeatTimer = setTimeout(() => {
        close(new WidgetSDKError("DISCONNECTED", "The Quillow host stopped responding"));
      }, HEARTBEAT_TIMEOUT);
    }, HEARTBEAT_INTERVAL);
  };
  const visibilityChanged = () => scheduleHeartbeat();
  const pagehide = () => close(new WidgetSDKError("DISCONNECTED", "The widget document was unloaded"));
  const messageError = () => close(protocolError("Unable to decode a host message"));
  const receive = (event) => {
    const data = event.data;
    if (isRecord(data) && typeof data.connectionId === "string" && data.connectionId !== connectionId)
      return;
    try {
      if (event.ports.length > 0) {
        for (const transferred of event.ports) transferred.close();
        throw protocolError("Unexpected MessagePort in a host RPC message");
      }
      if (!isRecord(data) || data.protocol !== PROTOCOL || data.connectionId !== connectionId)
        throw protocolError("Invalid host message envelope");
      if (data.version !== VERSION)
        throw new WidgetSDKError(
          "PROTOCOL_MISMATCH",
          "The host uses an incompatible bridge protocol"
        );
      if (data.type === "disconnect") {
        if (data.reason !== void 0 && typeof data.reason !== "string")
          throw protocolError("Invalid disconnect message");
        close(new WidgetSDKError("DISCONNECTED", data.reason || "The Quillow host disconnected"));
        return;
      }
      if (typeof data.requestId !== "string" || data.requestId.length === 0)
        throw protocolError("The host message is missing its request ID");
      if (data.type === "ping") {
        send({ ...frame("pong"), requestId: data.requestId });
        return;
      }
      if (data.type === "pong") {
        if (data.requestId === heartbeatId) scheduleHeartbeat();
        return;
      }
      if (data.type !== "response") throw protocolError("Unknown host message type");
      const waiter = pending.get(data.requestId);
      if (!waiter) return;
      const success = data.ok === true && Object.hasOwn(data, "result") && !Object.hasOwn(data, "error");
      const failure = data.ok === false && Object.hasOwn(data, "error") && !Object.hasOwn(data, "result");
      if (!success && !failure) throw protocolError("Invalid host response");
      const error = failure ? readError(data.error) : void 0;
      pending.delete(data.requestId);
      clearTimeout(waiter.timer);
      if (error) waiter.reject(error);
      else waiter.resolve(data.result);
    } catch (error) {
      close(error instanceof WidgetSDKError ? error : protocolError("Invalid host message", error));
    }
  };
  const request = (method, params) => new Promise((resolve, reject) => {
    assertOpen();
    const requestId = `request:${++sequence}`;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      const error = new WidgetSDKError("REQUEST_TIMEOUT", `Timed out waiting for ${method}`);
      reject(mutation(method) ? uncertainMutation(error) : error);
    }, requestTimeout);
    pending.set(requestId, { method, resolve, reject, timer });
    send({ ...frame("request"), requestId, method, params });
  });
  try {
    port.addEventListener("message", receive);
    port.addEventListener("messageerror", messageError);
    window.addEventListener("pagehide", pagehide);
    document.addEventListener("visibilitychange", visibilityChanged);
    port.start();
    scheduleHeartbeat();
  } catch (cause) {
    const error = new WidgetSDKError("DISCONNECTED", "Unable to start the host transport", {
      cause
    });
    close(error);
    throw error;
  }
  return Object.freeze({
    ...context,
    storage: createStorage(context, request, assertOpen),
    async openEditor() {
      assertOpen();
      if (context.mode !== "editor")
        throw new WidgetSDKError(
          "PERMISSION_DENIED",
          "Opening the block editor requires editor mode"
        );
      if (context.editor?.available === false)
        throw new WidgetSDKError(
          "EDITOR_UNAVAILABLE",
          "This block has no available manifest.editor screen"
        );
      if (!context.capabilities.includes("editor.open"))
        throw new WidgetSDKError("PERMISSION_DENIED", "The host has not permitted editor.open");
      const result = await request("editor.open", {});
      if (result !== true) throw protocolError("The host did not confirm opening the block editor");
    },
    destroy() {
      if (closed) return;
      try {
        port.postMessage({ ...frame("disconnect"), reason: "The widget destroyed its connection" });
      } catch {
      }
      close(new WidgetSDKError("DESTROYED", "The widget connection has been destroyed"));
    }
  });
}
async function connect(options = {}) {
  const settings = readOptions(options, ["parentOrigin", "timeout", "requestTimeout"]);
  const timeout = timeoutOption(
    settings.timeout === void 0 ? 1e4 : settings.timeout,
    "timeout"
  );
  const requestTimeout = timeoutOption(
    settings.requestTimeout === void 0 ? 1e4 : settings.requestTimeout,
    "requestTimeout"
  );
  const origin = settings.parentOrigin;
  if (origin !== void 0 && (typeof origin !== "string" || !isHttpUrl(origin) || new URL(origin).origin !== origin))
    invalidArgument("parentOrigin must be an exact HTTP(S) origin");
  if (typeof window === "undefined" || window.parent === window)
    throw new WidgetSDKError("HOST_UNAVAILABLE", "Quillow connect() requires an iframe with a host");
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function")
    throw new WidgetSDKError(
      "HOST_UNAVAILABLE",
      "Quillow connect() requires a secure browser context"
    );
  const parent = window.parent;
  const connectionId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
    };
    const fail = (error) => {
      cleanup();
      reject(error);
    };
    const request = (targetOrigin) => {
      try {
        parent.postMessage({ ...message("connect"), connectionId }, targetOrigin);
      } catch (cause) {
        fail(
          new WidgetSDKError("HOST_UNAVAILABLE", "Unable to contact the Quillow host", { cause })
        );
      }
    };
    const receive = (event) => {
      if (event.source !== parent || !isHttpUrl(event.origin) || new URL(event.origin).origin !== event.origin || origin !== void 0 && event.origin !== origin)
        return;
      if (isMessage(event.data, "hello")) {
        request(event.origin);
        return;
      }
      const data = event.data;
      if (!isRecord(data) || data.protocol !== PROTOCOL || data.connectionId !== connectionId)
        return;
      try {
        if (data.version !== VERSION)
          throw new WidgetSDKError(
            "PROTOCOL_MISMATCH",
            "The host uses an incompatible bridge protocol"
          );
        if (data.type === "connect-error") throw readError(data.error);
        if (data.type !== "connected" || event.ports.length !== 1)
          throw protocolError(
            "The host must return a connected message with exactly one MessagePort"
          );
        const context = readContext(data.context);
        const widget = createWidget(context, event.ports[0], connectionId, requestTimeout);
        cleanup();
        resolve(widget);
      } catch (error) {
        for (const port of event.ports) port.close();
        fail(
          error instanceof WidgetSDKError ? error : protocolError("Invalid host handshake", error)
        );
      }
    };
    const timer = setTimeout(() => {
      fail(
        new WidgetSDKError(
          "CONNECT_TIMEOUT",
          "Timed out connecting to Quillow: no compatible host responded"
        )
      );
    }, timeout);
    window.addEventListener("message", receive);
    request(origin ?? "*");
  });
}

// src/index.ts
function createCustomBlockSDK(options = {}) {
  let origin = options.parentOrigin;
  if (origin && (!isHttpUrl(origin) || new URL(origin).origin !== origin)) {
    throw new Error("parentOrigin must be an HTTP(S) origin");
  }
  let context;
  let started = false;
  let destroyed = false;
  let font;
  const listeners = /* @__PURE__ */ new Set();
  const pending = /* @__PURE__ */ new Set();
  const previousVariables = /* @__PURE__ */ new Map();
  const previousAttributes = /* @__PURE__ */ new Map();
  let appliedVariables = /* @__PURE__ */ new Set();
  const restoreVariable = (key) => {
    const previous = previousVariables.get(key);
    if (previous?.value)
      document.documentElement.style.setProperty(key, previous.value, previous.priority);
    else document.documentElement.style.removeProperty(key);
  };
  const apply = (next) => {
    const root = document.documentElement;
    for (const key of appliedVariables) {
      if (!(key in next.theme.variables)) restoreVariable(key);
    }
    for (const [key, value] of Object.entries(next.theme.variables)) {
      if (!previousVariables.has(key))
        previousVariables.set(key, {
          value: root.style.getPropertyValue(key),
          priority: root.style.getPropertyPriority(key)
        });
      root.style.setProperty(key, value);
    }
    appliedVariables = new Set(Object.keys(next.theme.variables));
    const attributes = {
      "data-quillow-theme": next.theme.mode,
      "data-quillow-size": next.layout.size,
      "data-quillow-viewport": next.layout.viewport,
      "data-quillow-corner-style": next.theme.cornerStyle,
      "data-quillow-environment": next.environment
    };
    for (const [name, value] of Object.entries(attributes)) {
      if (!previousAttributes.has(name)) previousAttributes.set(name, root.getAttribute(name));
      root.setAttribute(name, value);
    }
    if (next.theme.fontStylesheet) {
      if (!font) {
        font = document.createElement("link");
        font.rel = "stylesheet";
        (document.head ?? root).append(font);
      }
      if (font.href !== next.theme.fontStylesheet) font.href = next.theme.fontStylesheet;
    } else {
      font?.remove();
      font = void 0;
    }
  };
  const request = () => window.parent.postMessage(message("ready"), origin ?? "*");
  const notify = (listener, value) => {
    try {
      listener(value);
    } catch (error) {
      console.error("[Quillow SDK] Subscriber failed", error);
    }
  };
  const receive = (event) => {
    if (event.source !== window.parent || !isHttpUrl(event.origin) || origin && event.origin !== origin)
      return;
    if (isMessage(event.data, "hello")) {
      origin = event.origin;
      request();
      return;
    }
    if (!isMessage(event.data, "context") || !isContext(event.data.context)) return;
    origin = event.origin;
    const next = event.data.context;
    context = Object.freeze({
      ...next,
      theme: Object.freeze({
        ...next.theme,
        variables: Object.freeze({ ...next.theme.variables })
      }),
      layout: Object.freeze({ ...next.layout })
    });
    if (options.applyStyles !== false) apply(context);
    for (const waiter of pending) waiter.resolve(context);
    pending.clear();
    for (const listener of listeners) {
      notify(listener, context);
    }
  };
  const start = () => {
    if (destroyed) throw new Error("Quillow SDK has been destroyed");
    if (started) return;
    if (typeof window === "undefined" || window.parent === window)
      throw new Error("Quillow SDK requires an embedded browser window");
    started = true;
    window.addEventListener("message", receive);
    request();
  };
  return {
    /** Starts the bridge. Importing the module alone has no browser side effects. */
    start,
    getContext: () => context,
    ready({ timeout = 1e4 } = {}) {
      return new Promise((resolve, reject) => {
        start();
        if (context) {
          resolve(context);
          return;
        }
        const timer = setTimeout(() => {
          pending.delete(waiter);
          reject(new Error("Timed out waiting for the Quillow host"));
        }, timeout);
        const waiter = {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          }
        };
        pending.add(waiter);
      });
    },
    /** Immediately replays the current context if already connected. */
    subscribe(listener) {
      start();
      listeners.add(listener);
      if (context) notify(listener, context);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (started) window.removeEventListener("message", receive);
      for (const waiter of pending) waiter.reject(new Error("Quillow SDK has been destroyed"));
      pending.clear();
      listeners.clear();
      for (const key of appliedVariables) restoreVariable(key);
      for (const [name, value] of previousAttributes) {
        if (value === null) document.documentElement.removeAttribute(name);
        else document.documentElement.setAttribute(name, value);
      }
      font?.remove();
      context = void 0;
    }
  };
}
var Quillow = createCustomBlockSDK();
export {
  Quillow,
  WidgetSDKError,
  connect,
  createCustomBlockSDK
};
