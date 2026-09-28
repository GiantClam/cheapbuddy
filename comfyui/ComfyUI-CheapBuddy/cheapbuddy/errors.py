class CheapBuddyError(Exception):
    """A safe-to-display CheapBuddy request error."""

    def __init__(self, message, *, status=None, task_id=""):
        super().__init__(message)
        self.status = status
        self.task_id = task_id


def safe_error(status, request_id=""):
    messages = {
        401: "API Key was rejected. Check the key configured on this node.",
        403: "This API Key cannot access the requested model or operation.",
        404: "Model or API route was not found. Refresh models and check its capabilities.",
        409: "The request conflicts with an existing task. Resume with its task ID.",
        429: "CheapBuddy rate limit reached. Retry after a short wait.",
    }
    message = messages.get(status, "CheapBuddy request failed (HTTP %s)." % status)
    if request_id:
        message += " Request ID: %s" % request_id
    return message
