import json
import math
import re

from .errors import CheapBuddyError

MAX_SCHEMA_FIELDS = 64
MAX_OPTIONS = 256


def parameters_json(value, model):
    if not isinstance(value, str) or len(value.encode("utf-8")) > 65536:
        raise CheapBuddyError("Advanced parameters exceed the 64 KiB limit.")
    try:
        params = json.loads(value or "{}")
    except (TypeError, ValueError):
        raise CheapBuddyError("Advanced parameters must be a JSON object.") from None
    if not isinstance(params, dict):
        raise CheapBuddyError("Advanced parameters must be a JSON object.")
    schema = model.get("parameter_schema", {})
    if not isinstance(schema, dict) or len(schema) > MAX_SCHEMA_FIELDS:
        raise CheapBuddyError("Model parameter schema is invalid or too large.")
    for name, rule in schema.items():
        if not isinstance(name, str) or not isinstance(rule, dict):
            continue
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", name):
            raise CheapBuddyError("Model schema contains an invalid parameter name.")
        if rule.get("required") and name not in params and "default" not in rule and rule.get("type") not in ("image", "video", "audio"):
            raise CheapBuddyError("Missing required model parameter: %s" % name)
        if name not in params:
            continue
        value = params[name]
        allowed = rule.get("enum", rule.get("options"))
        if isinstance(allowed, list) and len(allowed) <= MAX_OPTIONS and value not in allowed:
            raise CheapBuddyError("Parameter %s has an unsupported value." % name)
        kind = rule.get("type")
        if kind == "integer" and (not isinstance(value, int) or isinstance(value, bool)):
            raise CheapBuddyError("Parameter %s must be an integer." % name)
        if kind == "number" and (not isinstance(value, (int, float)) or isinstance(value, bool)):
            raise CheapBuddyError("Parameter %s must be numeric." % name)
        if kind == "boolean" and not isinstance(value, bool):
            raise CheapBuddyError("Parameter %s must be boolean." % name)
        if kind == "string" and (not isinstance(value, str) or len(value) > 8192):
            raise CheapBuddyError("Parameter %s must be a string no longer than 8192 characters." % name)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            if isinstance(value, float) and not math.isfinite(value):
                raise CheapBuddyError("Parameter %s must be finite." % name)
            if "minimum" in rule and value < rule["minimum"]:
                raise CheapBuddyError("Parameter %s is below its minimum." % name)
            if "maximum" in rule and value > rule["maximum"]:
                raise CheapBuddyError("Parameter %s exceeds its maximum." % name)
    unknown = set(params) - set(schema)
    if unknown:
        raise CheapBuddyError("Unknown model parameter(s): %s" % ", ".join(sorted(unknown)[:8]))
    return params
