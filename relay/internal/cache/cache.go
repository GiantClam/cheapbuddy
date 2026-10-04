package cache

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/cheapbuddy/relay/internal/store"
	"github.com/redis/go-redis/v9"
)

const Prefix = "relay:"

const operationTimeout = 250 * time.Millisecond

type Identity struct {
	UserID   int64 `json:"user_id"`
	APIKeyID int64 `json:"api_key_id"`
}

type Cache struct{ Client *redis.Client }

func Open(redisURL string) (*Cache, error) {
	options, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, err
	}
	configureOptions(options)
	return &Cache{Client: redis.NewClient(options)}, nil
}

// configureOptions keeps Redis on the best-effort path. A cache outage must
// degrade cache-dependent behavior, not consume an upstream request timeout.
func configureOptions(options *redis.Options) {
	options.DialTimeout = operationTimeout
	options.ReadTimeout = operationTimeout
	options.WriteTimeout = operationTimeout
	options.PoolTimeout = operationTimeout
	options.MaxRetries = 0
}

func (c *Cache) Close() error { return c.Client.Close() }
func (c *Cache) Ping(ctx context.Context) error {
	ctx, cancel := operationContext(ctx)
	defer cancel()
	return c.Client.Ping(ctx).Err()
}

func (c *Cache) GetIdentity(ctx context.Context, apiKey string) (Identity, bool, error) {
	return getJSON[Identity](ctx, c.Client, identityKey(apiKey))
}

func (c *Cache) SetIdentity(ctx context.Context, apiKey string, identity Identity, ttl time.Duration) error {
	return setJSON(ctx, c.Client, identityKey(apiKey), identity, ttl)
}

func (c *Cache) DeleteIdentity(ctx context.Context, apiKey string) error {
	ctx, cancel := operationContext(ctx)
	defer cancel()
	return c.Client.Del(ctx, identityKey(apiKey)).Err()
}

func (c *Cache) GetMapping(ctx context.Context, userID int64) (store.Mapping, bool, error) {
	return getJSON[store.Mapping](ctx, c.Client, mappingKey(userID))
}

func (c *Cache) SetMapping(ctx context.Context, mapping store.Mapping, ttl time.Duration) error {
	return setJSON(ctx, c.Client, mappingKey(mapping.CheapBuddyUserID), mapping, ttl)
}

func (c *Cache) DeleteMapping(ctx context.Context, userID int64) error {
	ctx, cancel := operationContext(ctx)
	defer cancel()
	return c.Client.Del(ctx, mappingKey(userID)).Err()
}

func (c *Cache) AcquireLock(ctx context.Context, key, value string, ttl time.Duration) (bool, error) {
	ctx, cancel := operationContext(ctx)
	defer cancel()
	return c.Client.SetNX(ctx, Prefix+"lock:"+key, value, ttl).Result()
}

func (c *Cache) ReleaseLock(ctx context.Context, key, value string) error {
	const script = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`
	ctx, cancel := operationContext(ctx)
	defer cancel()
	return c.Client.Eval(ctx, script, []string{Prefix + "lock:" + key}, value).Err()
}

func (c *Cache) Allow(ctx context.Context, key string, limit int64, window time.Duration) (bool, time.Duration, error) {
	if limit <= 0 {
		return true, 0, nil
	}
	ctx, cancel := operationContext(ctx)
	defer cancel()
	redisKey := Prefix + "rate:" + key
	count, err := c.Client.Incr(ctx, redisKey).Result()
	if err != nil {
		return false, 0, err
	}
	if count == 1 {
		if err := c.Client.Expire(ctx, redisKey, window).Err(); err != nil {
			return false, 0, err
		}
	}
	ttl, err := c.Client.TTL(ctx, redisKey).Result()
	if err != nil {
		return false, 0, err
	}
	return count <= limit, ttl, nil
}

func identityKey(apiKey string) string { return Prefix + "identity:" + digest(apiKey) }
func mappingKey(userID int64) string   { return fmt.Sprintf("%smapping:%d", Prefix, userID) }

func digest(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func getJSON[T any](ctx context.Context, client *redis.Client, key string) (T, bool, error) {
	var zero T
	ctx, cancel := operationContext(ctx)
	defer cancel()
	value, err := client.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return zero, false, nil
	}
	if err != nil {
		return zero, false, err
	}
	var decoded T
	if err := json.Unmarshal(value, &decoded); err != nil {
		return zero, false, err
	}
	return decoded, true, nil
}

func setJSON(ctx context.Context, client *redis.Client, key string, value any, ttl time.Duration) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	ctx, cancel := operationContext(ctx)
	defer cancel()
	return client.Set(ctx, key, encoded, ttl).Err()
}

func operationContext(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, operationTimeout)
}
