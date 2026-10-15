import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const nodeKinds = {
  CheapBuddyTextGenerate: "text",
  CheapBuddyImageGenerate: "image",
  CheapBuddyVideoGenerate: "video",
};
const modelRequests = new Map();
const reportedModelErrors = new Set();

function supportsKind(model, kind) {
  const type = String(model?.type || "").trim().toLowerCase();
  const capabilities = Array.isArray(model?.capabilities) ? model.capabilities.map((value) => String(value).trim().toLowerCase()) : [];
  const endpoints = Array.isArray(model?.supported_endpoint_types) ? model.supported_endpoint_types.map((value) => String(value).trim().toLowerCase()) : [];
  const types = {
    text: ["text", "language", "llm", "vision", "chat", "chat.completion"],
    image: ["image", "image_generation"],
    video: ["video", "video_generation"],
  }[kind] || [];
  const requiredCapabilities = {
    text: ["text_generation", "vision"],
    image: ["text_to_image", "image_edit", "variation"],
    video: ["text_to_video", "image_to_video", "reference_to_video"],
  }[kind] || [];
  const requiredEndpoints = {
    text: [],
    image: ["image-generation"],
    video: ["openai-video"],
  }[kind] || [];
  const matches = types.includes(type)
    || capabilities.some((value) => requiredCapabilities.includes(value))
    || endpoints.some((value) => requiredEndpoints.includes(value));
  if (kind === "text") {
    if (type === "model" && !capabilities.some((value) => ["text_generation", "vision"].includes(value))) return false;
    const mediaOnly = ["image", "image_generation", "video", "video_generation"].includes(type)
      || capabilities.some((value) => ["text_to_image", "image_edit", "variation", "text_to_video", "image_to_video", "reference_to_video"].includes(value))
      || endpoints.some((value) => ["image-generation", "openai-video"].includes(value));
    const explicitTextCapability = capabilities.some((value) => ["text_generation", "vision"].includes(value));
    if (mediaOnly && !explicitTextCapability) return false;
  }
  return matches;
}

function resizeForWidgets(node) {
  if (typeof node.computeSize !== "function" || typeof node.setSize !== "function") return;
  const current = node.size || [0, 0];
  const computed = node.computeSize();
  node.setSize([Math.max(current[0], computed[0]), Math.max(current[1], computed[1])]);
}

function setSchemaWidgets(node, schema) {
  node.widgets = (node.widgets || []).filter((widget) => !widget.options?.cheapbuddyParameter);
  const paramsWidget = node.widgets.find((widget) => widget.name === "parameters_json");
  if (!paramsWidget) return;
  let values = {};
  try { values = JSON.parse(paramsWidget.value || "{}"); } catch (_) { values = {}; }
  if (!values || typeof values !== "object" || Array.isArray(values)) values = {};
  values = Object.fromEntries(Object.entries(values).filter(([name]) => Object.hasOwn(schema || {}, name)));
  for (const [name, rule] of Object.entries(schema || {})) {
    if (!rule || typeof rule !== "object") continue;
    const options = rule.enum || rule.options;
    let type, widgetOptions = {};
    if (Array.isArray(options) && options.length && options.length <= 64) {
      type = "combo";
      widgetOptions = { values: options };
    } else if (rule.type === "integer" || rule.type === "number") {
      type = "number";
      widgetOptions = { min: rule.minimum, max: rule.maximum, step: rule.type === "integer" ? 1 : 0.01 };
    } else if (rule.type === "boolean") {
      type = "toggle";
    } else if (rule.type === "string") {
      type = "text";
    } else {
      continue;
    }
    const hasValue = Object.hasOwn(values, name);
    let initial = hasValue ? values[name] : rule.default;
    if (initial === undefined && type === "combo") initial = widgetOptions.values[0];
    if (initial === undefined && type === "boolean") initial = false;
    if (initial === undefined && type === "number") initial = rule.minimum ?? 0;
    if (initial === undefined) initial = "";
    if (!hasValue && rule.default !== undefined) values = { ...values, [name]: initial };
    const widget = node.addWidget(type, rule.title || name, initial, (value) => {
      values = Object.assign({}, values, { [name]: value });
      paramsWidget.value = JSON.stringify(values, null, 2);
      node.setDirtyCanvas(true, true);
    }, widgetOptions);
    widget.options = Object.assign({}, widget.options, { cheapbuddyParameter: true, tooltip: rule.description || "Model parameter" });
  }
  if (!paramsWidget.value || paramsWidget.value === "{}") paramsWidget.value = JSON.stringify(values, null, 2);
  resizeForWidgets(node);
}

async function cacheKey(baseUrl, apiKey, kind) {
  const bytes = new TextEncoder().encode(`${baseUrl}\0${apiKey}\0${kind}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `cheapbuddy-models-v11-${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

async function discoverModels(baseUrl, apiKey, kind) {
  const key = await cacheKey(baseUrl, apiKey, kind);
  try {
    const cached = JSON.parse(localStorage.getItem(key) || "null");
    if (cached?.models?.length && Date.now() - cached.savedAt < 5 * 60 * 1000) return cached.models;
  } catch (_) { /* refresh from the API when cache is malformed */ }

  if (!modelRequests.has(key)) {
    const request = (async () => {
      const response = await api.fetchApi("/cheapbuddy/models", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_url: baseUrl, api_key: apiKey, kind }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `Model refresh failed (${response.status}).`);
      const models = (payload.data || []).filter((item) => typeof item?.id === "string" && item.id.trim() && supportsKind(item, kind));
      if (!models.length) {
        const required = {
          text: "text_generation or vision",
          image: "text_to_image, image_edit, or variation",
          video: "text_to_video, image_to_video, or reference_to_video",
        }[kind];
        throw new Error(`Relay returned no ${kind}-compatible models. GET /v1/models must include an explicit model type or capability (${required}).`);
      }
      localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), models }));
      return models;
    })();
    modelRequests.set(key, request);
  }

  const request = modelRequests.get(key);
  try {
    return await request;
  } finally {
    if (modelRequests.get(key) === request) modelRequests.delete(key);
  }
}

app.registerExtension({
  name: "CheapBuddy.DynamicModels",
  loadedGraphNode(node) {
    if (nodeKinds[node.comfyClass]) node.cheapbuddyRefreshModels?.();
  },
  async nodeCreated(node) {
    const kind = nodeKinds[node.comfyClass];
    if (!kind || !node.widgets) return;
    const find = (name) => node.widgets.find((widget) => widget.name === name);
    const originalModelWidget = find("model");
    if (!originalModelWidget) return;
    const modelIndex = node.widgets.indexOf(originalModelWidget);
    const initialModel = originalModelWidget.value && originalModelWidget.value !== "Refresh models"
      ? originalModelWidget.value : "Select model";
    let modelValues = ["Select model"];
    let refreshOnEmpty;
    const resolveModelValues = () => {
      refreshOnEmpty?.();
      return modelValues;
    };
    node.widgets.splice(modelIndex, 1);
    const modelWidget = node.addWidget("combo", "model", initialModel, () => {}, { values: resolveModelValues });
    node.widgets.splice(node.widgets.indexOf(modelWidget), 1);
    node.widgets.splice(modelIndex, 0, modelWidget);
    const hasCredentials = () => {
      const key = String(find("api_key")?.value || "").trim();
      return key && key !== "YOUR_CHEAPBUDDY_API_KEY";
    };
    const setModelValues = (values) => {
      modelValues = values;
      // Both canvas widgets and Vue widgets resolve function-valued options.
      // Vue does not invoke the canvas widget's mouse/onPointerDown hooks.
      // Preserve the options object shared with ComfyUI's widget value store.
      modelWidget.options.values = resolveModelValues;
    };

    const refresh = async () => {
      const baseUrl = find("base_url")?.value || "https://api.cheapbuddy.cc";
      const apiKey = find("api_key")?.value || "";
      if (!apiKey) throw new Error("Enter the API Key before refreshing models.");
      const models = await discoverModels(baseUrl, apiKey, kind);
      applyModels(models);
      await modelWidget.callback?.(modelWidget.value);
    };

    const applyModels = (models) => {
      setModelValues(models.map((item) => item.id));
      if (!modelValues.includes(modelWidget.value)) modelWidget.value = modelValues[0];
      node.setDirtyCanvas(true, true);
    };

    const placeholders = new Set(["Select model", "Refresh models", "Loading models…"]);
    const hasModels = () => modelValues.some((value) => !placeholders.has(value));
    let refreshPromise;
    let retryAfter = 0;
    refreshOnEmpty = () => {
      if (hasModels() || !hasCredentials() || Date.now() < retryAfter) return false;
      if (!refreshPromise) {
        setModelValues(["Loading models…"]);
        modelWidget.value = "Loading models…";
        node.setDirtyCanvas(true, true);
        refreshPromise = refresh()
          .catch((error) => {
            retryAfter = Date.now() + 10000;
            setModelValues(["Select model"]);
            modelWidget.value = "Select model";
            node.setDirtyCanvas(true, true);
            const apiKey = find("api_key")?.value || "";
            const baseUrl = find("base_url")?.value || "https://api.cheapbuddy.cc";
            cacheKey(baseUrl, apiKey, kind).then((key) => {
              if (reportedModelErrors.has(key)) return;
              reportedModelErrors.add(key);
              setTimeout(() => reportedModelErrors.delete(key), 10000);
              alert(`CheapBuddy model refresh failed: ${error.message}`);
            });
          })
          .finally(() => { refreshPromise = undefined; });
      }
      return true;
    };
    const originalPointerDown = modelWidget.onPointerDown;
    modelWidget.onPointerDown = function (pointer, targetNode, canvas) {
      refreshOnEmpty();
      return originalPointerDown?.call(this, pointer, targetNode, canvas) ?? false;
    };
    modelWidget.mouse = () => { refreshOnEmpty(); };

    // A changed endpoint or key invalidates the current selection. Both renderers
    // resolve the options again when the dropdown opens.
    for (const name of ["base_url", "api_key"]) {
      const widget = find(name);
      if (!widget) continue;
      const originalCallback = widget.callback;
      widget.callback = function (value) {
        originalCallback?.call(this, value);
        retryAfter = 0;
        setModelValues(["Select model"]);
        modelWidget.value = "Select model";
        node.setDirtyCanvas(true, true);
      };
    }
    resizeForWidgets(node);

    modelWidget.callback = async function (value) {
      this.value = value;
      if (placeholders.has(value)) { refreshOnEmpty(); return; }
      const apiKey = find("api_key")?.value || "";
      const baseUrl = find("base_url")?.value || "https://api.cheapbuddy.cc";
      if (!apiKey || !value) return;
      const response = await api.fetchApi("/cheapbuddy/model", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_url: baseUrl, api_key: apiKey, model: value }),
      });
      if (!response.ok) return;
      const detail = await response.json();
      setSchemaWidgets(node, detail.parameter_schema);
      const operation = find("operation") || find("generation_type");
      if (kind === "video" && operation?.name === "generation_type") {
        const choices = ["text_to_video", "image_to_video", "reference_to_video"].filter((cap) => (detail.capabilities || []).includes(cap));
        operation.options.values = choices.length ? choices : ["No supported generation type"];
        if (!choices.includes(operation.value)) operation.value = choices[0] || operation.options.values[0];
      }
      if (kind === "image") {
        const imageOperation = find("operation");
        const choices = ["text_to_image", "image_edit", "variation"].filter((cap) => (detail.capabilities || []).includes(cap));
        if (imageOperation) {
          imageOperation.options.values = choices.length ? choices : ["No supported operation"];
          if (!choices.includes(imageOperation.value)) imageOperation.value = imageOperation.options.values[0];
        }
      }
      node.setDirtyCanvas(true, true);
    };
    setModelValues(modelValues);
    if (hasCredentials() && modelWidget.value && !placeholders.has(modelWidget.value)) {
      modelWidget.callback(modelWidget.value).catch(() => {});
    }
    if (hasCredentials()) refreshOnEmpty();
    node.cheapbuddyRefreshModels = refreshOnEmpty;
  },
});
