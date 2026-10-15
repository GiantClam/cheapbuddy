package store

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

type lockRow struct {
	value bool
	err   error
}

func (r lockRow) Scan(dest ...any) error {
	if r.err == nil {
		*dest[0].(*bool) = r.value
	}
	return r.err
}

type fakeBillingConnection struct {
	locked           bool
	lockError        error
	unlockError      error
	unlocked         bool
	released         bool
	discarded        bool
	unlockContextErr error
	unlockDeadline   bool
	unlockFalse      bool
}

func (c *fakeBillingConnection) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	if strings.Contains(sql, "pg_try_advisory_lock") {
		return lockRow{c.locked, c.lockError}
	}
	c.unlocked = true
	c.unlockContextErr = ctx.Err()
	_, c.unlockDeadline = ctx.Deadline()
	return lockRow{!c.unlockFalse, c.unlockError}
}
func (c *fakeBillingConnection) Release()                      { c.released = true }
func (c *fakeBillingConnection) discard(context.Context) error { c.discarded = true; return nil }

func TestBillingLockBusyDoesNotRunCallback(t *testing.T) {
	conn := &fakeBillingConnection{}
	err := withMediaBillingConnection(context.Background(), conn, "request", func(context.Context) error {
		t.Fatal("busy lock ran callback")
		return nil
	})
	if !errors.Is(err, ErrBillingBusy) || !conn.released || conn.unlocked {
		t.Fatalf("unexpected busy cleanup: err=%v conn=%+v", err, conn)
	}
}

func TestBillingLockCleansUpAfterCanceledCallback(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	conn := &fakeBillingConnection{locked: true}
	callbackError := errors.New("callback failed")
	err := withMediaBillingConnection(ctx, conn, "request", func(callbackContext context.Context) error {
		cancel()
		if callbackContext != ctx {
			t.Fatal("callback context changed")
		}
		return callbackError
	})
	if !errors.Is(err, callbackError) || !conn.unlocked || !conn.released || conn.unlockContextErr != nil || !conn.unlockDeadline {
		t.Fatalf("unexpected cancellation cleanup: err=%v conn=%+v", err, conn)
	}
}

func TestBillingLockAcquisitionErrorDoesNotRunCallback(t *testing.T) {
	lockError := errors.New("query failed")
	conn := &fakeBillingConnection{lockError: lockError}
	err := withMediaBillingConnection(context.Background(), conn, "request", func(context.Context) error {
		t.Fatal("failed lock ran callback")
		return nil
	})
	if !errors.Is(err, lockError) || !conn.released || !conn.discarded || conn.unlocked {
		t.Fatalf("err=%v conn=%+v", err, conn)
	}
}

func TestBillingLockUnlockFailureDiscardsConnection(t *testing.T) {
	unlockError := errors.New("unlock failed")
	conn := &fakeBillingConnection{locked: true, unlockError: unlockError}
	err := withMediaBillingConnection(context.Background(), conn, "request", func(context.Context) error { return nil })
	if !errors.Is(err, unlockError) || !conn.discarded || !conn.released {
		t.Fatalf("err=%v conn=%+v", err, conn)
	}
}

func TestBillingLockSuccess(t *testing.T) {
	conn := &fakeBillingConnection{locked: true}
	called := false
	err := withMediaBillingConnection(context.Background(), conn, "request", func(context.Context) error { called = true; return nil })
	if err != nil || !called || !conn.unlocked || !conn.released || conn.discarded {
		t.Fatalf("err=%v conn=%+v", err, conn)
	}
}

func TestBillingLockPanicStillUnlocks(t *testing.T) {
	conn := &fakeBillingConnection{locked: true}
	defer func() {
		if recover() == nil || !conn.unlocked || !conn.released {
			t.Fatalf("panic cleanup: %+v", conn)
		}
	}()
	_ = withMediaBillingConnection(context.Background(), conn, "request", func(context.Context) error { panic("callback") })
}

func TestBillingLockMissingUnlockDiscardsConnection(t *testing.T) {
	conn := &fakeBillingConnection{locked: true, unlockFalse: true}
	err := withMediaBillingConnection(context.Background(), conn, "request", func(context.Context) error { return nil })
	if err == nil || !conn.discarded || !conn.released {
		t.Fatalf("err=%v conn=%+v", err, conn)
	}
}
