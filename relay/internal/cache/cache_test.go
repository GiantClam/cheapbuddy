package cache

import (
	"context"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

func TestIdentityKeyDoesNotExposeKeyMaterial(t *testing.T) {
	apiKey := "sk-sensitive-value"
	key := identityKey(apiKey)
	if key == apiKey || len(key) <= len(Prefix+"identity:") {
		t.Fatalf("identity cache key leaked API key: %q", key)
	}
	if key != identityKey(apiKey) {
		t.Fatal("identity cache key is not deterministic")
	}
}

func TestConfigureOptionsBoundsCacheFailureLatency(t *testing.T) {
	options := &redis.Options{MaxRetries: 3}
	configureOptions(options)

	if options.DialTimeout != operationTimeout || options.ReadTimeout != operationTimeout || options.WriteTimeout != operationTimeout || options.PoolTimeout != operationTimeout {
		t.Fatalf("cache timeouts = dial %s read %s write %s pool %s, want %s", options.DialTimeout, options.ReadTimeout, options.WriteTimeout, options.PoolTimeout, operationTimeout)
	}
	if options.MaxRetries != 0 {
		t.Fatalf("cache retries = %d, want 0", options.MaxRetries)
	}
	if operationTimeout != 250*time.Millisecond {
		t.Fatalf("operation timeout = %s, want 250ms", operationTimeout)
	}
}

func TestOperationContextBoundsCacheCalls(t *testing.T) {
	ctx, cancel := operationContext(context.Background())
	defer cancel()
	deadline, ok := ctx.Deadline()
	if !ok {
		t.Fatal("cache context has no deadline")
	}
	if remaining := time.Until(deadline); remaining <= 0 || remaining > operationTimeout {
		t.Fatalf("cache context deadline remaining = %s, want (0, %s]", remaining, operationTimeout)
	}
}
