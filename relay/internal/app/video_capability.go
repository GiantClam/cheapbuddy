package app

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"time"
)

const videoCapabilityTTL = 30 * time.Minute

var videoCapabilityEncoding = base64.RawURLEncoding

func signVideoCapability(secret, taskID string, userID int64, expiresAt time.Time) (string, error) {
	secret = strings.TrimSpace(secret)
	taskID = strings.TrimSpace(taskID)
	if secret == "" || taskID == "" || userID <= 0 || expiresAt.IsZero() {
		return "", fmt.Errorf("video capability inputs are invalid")
	}
	payload := strings.Join([]string{taskID, strconv.FormatInt(userID, 10), strconv.FormatInt(expiresAt.Unix(), 10)}, "\n")
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	return videoCapabilityEncoding.EncodeToString([]byte(payload)) + "." + videoCapabilityEncoding.EncodeToString(mac.Sum(nil)), nil
}

func verifyVideoCapability(secret, token, taskID string, now time.Time) (int64, bool) {
	parts := strings.Split(strings.TrimSpace(token), ".")
	if len(parts) != 2 || strings.TrimSpace(secret) == "" || strings.TrimSpace(taskID) == "" {
		return 0, false
	}
	payload, err := videoCapabilityEncoding.DecodeString(parts[0])
	if err != nil {
		return 0, false
	}
	signature, err := videoCapabilityEncoding.DecodeString(parts[1])
	if err != nil {
		return 0, false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(payload)
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return 0, false
	}
	fields := strings.Split(string(payload), "\n")
	if len(fields) != 3 || fields[0] != taskID {
		return 0, false
	}
	userID, err := strconv.ParseInt(fields[1], 10, 64)
	if err != nil || userID <= 0 {
		return 0, false
	}
	expiresUnix, err := strconv.ParseInt(fields[2], 10, 64)
	if err != nil || expiresUnix <= 0 || !now.Before(time.Unix(expiresUnix, 0)) {
		return 0, false
	}
	return userID, true
}
