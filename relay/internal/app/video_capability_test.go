package app

import (
	"strings"
	"testing"
	"time"
)

func TestVideoCapabilityBindsTaskUserAndExpiry(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	token, err := signVideoCapability("relay-secret", "task-1", 42, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if userID, ok := verifyVideoCapability("relay-secret", token, "task-1", now); !ok || userID != 42 {
		t.Fatalf("valid capability rejected: user=%d ok=%v", userID, ok)
	}
	if _, ok := verifyVideoCapability("relay-secret", token, "task-2", now); ok {
		t.Fatal("capability was accepted for a different task")
	}
	if _, ok := verifyVideoCapability("other-secret", token, "task-1", now); ok {
		t.Fatal("capability was accepted with a different secret")
	}
	if _, ok := verifyVideoCapability("relay-secret", token, "task-1", now.Add(time.Minute)); ok {
		t.Fatal("expired capability was accepted")
	}

	parts := strings.Split(token, ".")
	signature, err := videoCapabilityEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatal(err)
	}
	signature[0] ^= 1
	parts[1] = videoCapabilityEncoding.EncodeToString(signature)
	if _, ok := verifyVideoCapability("relay-secret", strings.Join(parts, "."), "task-1", now); ok {
		t.Fatal("tampered capability was accepted")
	}
}

func TestTaskIDFromVideoDownloadPath(t *testing.T) {
	for path, want := range map[string]string{
		"/v1/videos/task-1/download-url":            "task-1",
		"/v1/video/generations/task-2/download-url": "task-2",
	} {
		if got := taskIDFromVideoPath(path); got != want {
			t.Fatalf("taskIDFromVideoPath(%q) = %q, want %q", path, got, want)
		}
	}
}
