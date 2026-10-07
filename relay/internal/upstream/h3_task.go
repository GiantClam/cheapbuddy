package upstream

import (
	"context"
	"fmt"
	"net/url"
	"strings"
)

// FindH3TaskStatus accepts only the exact persisted task and owning shadow user.
// A submit-time bill is not proof that an asynchronous video has succeeded.
func (c *Client) FindH3TaskStatus(ctx context.Context, baseURL, adminToken, taskID string, userID int64, nativeRequestID, requestID string) (string, bool, error) {
	if taskID == "" || userID <= 0 {
		return "", false, nil
	}
	payload, err := c.rawGetJSON(ctx, baseURL+"/api/task?task_id="+url.QueryEscape(taskID)+"&p=1&page_size=20", adminToken, requestID)
	if err != nil {
		return "", false, err
	}
	data, ok := dataOf(payload).(map[string]any)
	if !ok {
		return "", false, fmt.Errorf("invalid task list envelope")
	}
	items, ok := data["items"].([]any)
	if !ok {
		return "", false, fmt.Errorf("invalid task list items")
	}
	status := ""
	matched := false
	for _, item := range items {
		task, ok := item.(map[string]any)
		if !ok || nestedString(task, "task_id") != taskID || nestedInt(task, "user_id") != userID {
			continue
		}
		admin, _ := task["admin_info"].(map[string]any)
		if nativeRequestID != "" && nestedString(admin, "request_id") != nativeRequestID {
			continue
		}
		if matched {
			return "", false, fmt.Errorf("ambiguous task correlation")
		}
		matched = true
		status = strings.ToUpper(strings.TrimSpace(nestedString(task, "status")))
	}
	return status, matched, nil
}

func (c *Client) FindH3Bill(ctx context.Context, baseURL, adminToken, logPath, nativeRequestID, requestID string, userID int64) (Bill, bool, error) {
	payload, err := c.rawGetJSON(ctx, baseURL+logPath+"?request_id="+url.QueryEscape(nativeRequestID), adminToken, requestID)
	if err != nil {
		return Bill{}, false, err
	}
	data, ok := dataOf(payload).(map[string]any)
	if !ok {
		return Bill{}, false, fmt.Errorf("invalid H3 bill envelope")
	}
	items, ok := data["items"].([]any)
	if !ok {
		return Bill{}, false, fmt.Errorf("invalid H3 bill items")
	}
	var bill Bill
	found := false
	for _, item := range items {
		row, ok := item.(map[string]any)
		if !ok || nestedString(row, "request_id") != nativeRequestID || nestedInt(row, "user_id") != userID || nestedInt(row, "type") != 2 {
			continue
		}
		if found {
			return Bill{}, false, fmt.Errorf("ambiguous H3 bill correlation")
		}
		quota, ok := numeric(row["quota"])
		if !ok || quota < 0 {
			return Bill{}, false, fmt.Errorf("invalid H3 bill quota")
		}
		id := fmt.Sprint(row["id"])
		if id == "<nil>" || id == "" {
			return Bill{}, false, fmt.Errorf("missing H3 bill identity")
		}
		bill = Bill{ID: id, FinalQuota: quota, Status: nestedString(row, "status")}
		found = true
	}
	return bill, found, nil
}
