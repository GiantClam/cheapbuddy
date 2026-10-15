package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrBillingBusy means another Relay instance is settling this request.
var ErrBillingBusy = errors.New("media billing request is busy")

type billingConnection interface {
	QueryRow(context.Context, string, ...any) pgx.Row
	Release()
	discard(context.Context) error
}

type pooledBillingConnection struct{ *pgxpool.Conn }

func (c pooledBillingConnection) discard(ctx context.Context) error { return c.Conn.Conn().Close(ctx) }

// WithMediaBillingLock serializes capture/release across Relay instances. The
// callback must reload the request while locked and use idempotent ledger calls.
func (s *Store) WithMediaBillingLock(ctx context.Context, requestID string, fn func(context.Context) error) error {
	conn, err := s.Pool.Acquire(ctx)
	if err != nil {
		return err
	}
	return withMediaBillingConnection(ctx, pooledBillingConnection{conn}, requestID, fn)
}

func withMediaBillingConnection(ctx context.Context, conn billingConnection, requestID string, fn func(context.Context) error) (err error) {
	defer conn.Release()
	var locked bool
	if err = conn.QueryRow(ctx, `SELECT pg_try_advisory_lock(hashtextextended($1,0))`, requestID).Scan(&locked); err != nil {
		// A lost response can leave the server holding the lock. Do not put an
		// uncertain session back into the pool.
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		return errors.Join(err, conn.discard(cleanup))
	}
	if !locked {
		return ErrBillingBusy
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		var unlocked bool
		unlockErr := conn.QueryRow(cleanup, `SELECT pg_advisory_unlock(hashtextextended($1,0))`, requestID).Scan(&unlocked)
		if unlockErr == nil && !unlocked {
			unlockErr = fmt.Errorf("media billing lock was not held")
		}
		if unlockErr != nil {
			err = errors.Join(err, unlockErr, conn.discard(cleanup))
		}
	}()
	return fn(ctx)
}
