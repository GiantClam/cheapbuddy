package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/cheapbuddy/relay/internal/store"
	"github.com/cheapbuddy/relay/internal/upstream"
)

// All H3 terminal billing decisions use the same durable request lock. Persist
// the decision BEFORE a remote call: a lost capture response must never turn
// into a refund from another request's aggregate frozen funds.
type h3BillingStore interface {
	WithMediaBillingLock(context.Context, string, func(context.Context) error) error
	FindMediaRequest(context.Context, string) (store.MediaRequest, bool, error)
	FindMapping(context.Context, int64) (store.Mapping, bool, error)
	MarkBilling(context.Context, string, string, int64, string, string, string) error
	DecideMediaBilling(context.Context, string, string, int64, string, string) (bool, error)
}

type h3ReservationStore interface {
	h3BillingStore
	CreateMediaRequest(context.Context, store.MediaRequest) (bool, error)
}

// Persist the intent before reserve: a committed wallet hold with a lost HTTP
// response must still have a request that the deadline reconciler can refund.
func (s *Server) prepareH3Reservation(ctx context.Context, durable h3ReservationStore, request store.MediaRequest) error {
	created, err := durable.CreateMediaRequest(ctx, request)
	if err != nil {
		return err
	}
	if !created {
		return fmt.Errorf("H3 request correlation already exists")
	}
	return durable.WithMediaBillingLock(ctx, request.RequestID, func(ctx context.Context) error {
		fresh, found, err := durable.FindMediaRequest(ctx, request.RequestID)
		if err != nil {
			return err
		}
		if !found || fresh.BillingStatus != "reserved" {
			return fmt.Errorf("H3 reservation is no longer pending")
		}
		_, err = s.h3Ledger(ctx, "reserve", request.RequestID, map[string]any{"request_id": request.RequestID, "api_key_id": request.APIKeyID, "user_id": request.CheapBuddyUserID, "amount": request.ReservationAmount, "payload_hash": ""}, request.ReservationAmount)
		if err == nil {
			return nil
		}
		stateCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), maxDuration(s.Config.Sub2APITimeout, 5*time.Second))
		defer cancel()
		status, reason := "pending_reconciliation", "H3 reservation response unavailable; awaiting deadline reconciliation"
		var upstreamError *upstream.HTTPStatusError
		if errors.As(err, &upstreamError) && upstreamError.StatusCode == 402 {
			status, reason = "released", "H3 reservation rejected for insufficient balance; no funds held"
		}
		return errors.Join(err, durable.MarkBilling(stateCtx, request.RequestID, status, 0, "", "", reason))
	})
}

func h3Terminal(status string) bool { return status == "settled" || status == "released" }

func (s *Server) reconcileH3Request(ctx context.Context, durable h3BillingStore, snapshot store.MediaRequest) error {
	return durable.WithMediaBillingLock(ctx, snapshot.RequestID, func(ctx context.Context) error {
		request, found, err := durable.FindMediaRequest(ctx, snapshot.RequestID)
		if err != nil {
			return err
		}
		if !found || request.Model != "MiniMax-H3" || h3Terminal(request.BillingStatus) {
			return nil
		}
		if request.BillingStatus == "capture_pending" || request.BillingStatus == "release_pending" {
			return s.finishH3Decision(ctx, durable, request)
		}
		timeout := s.Config.H3TaskTimeout
		if timeout <= 0 {
			timeout = 30 * time.Minute
		}
		now := time.Now()
		if s.clock != nil {
			now = s.clock()
		}
		if !request.CreatedAt.IsZero() && !now.Before(request.CreatedAt.Add(timeout)) {
			return s.decideH3Release(ctx, durable, request, "H3 task deadline exceeded; reservation released")
		}
		if request.NativeTaskID == "" {
			return nil
		}
		mapping, found, err := durable.FindMapping(ctx, request.CheapBuddyUserID)
		if err != nil {
			return err
		}
		if !found {
			return nil
		}
		taskCtx, cancel := context.WithTimeout(ctx, s.Config.NewAPITimeout)
		status, found, err := s.Upstream.FindH3TaskStatus(taskCtx, s.Config.NewAPIURL, s.Config.NewAPIAdminToken, request.NativeTaskID, mapping.NewAPIUserID, request.NewAPIRequestID, request.RequestID)
		cancel()
		if err != nil {
			return err
		}
		if !found {
			return nil
		}
		switch strings.ToUpper(status) {
		case "FAILURE", "FAILED", "CANCELLED", "CANCELED", "REJECTED", "ERROR", "TIMEOUT", "TIMED_OUT":
			return s.decideH3Release(ctx, durable, request, "H3 upstream task failed; reservation released")
		case "SUCCESS", "SUCCEEDED", "COMPLETED":
			return s.decideH3Capture(ctx, durable, request, mapping.NewAPIUserID)
		default:
			return nil
		}
	})
}

func (s *Server) releaseH3Request(ctx context.Context, durable h3BillingStore, requestID, reason string) error {
	return durable.WithMediaBillingLock(ctx, requestID, func(ctx context.Context) error {
		request, found, err := durable.FindMediaRequest(ctx, requestID)
		if err != nil {
			return err
		}
		if !found {
			return fmt.Errorf("H3 request correlation unavailable")
		}
		if h3Terminal(request.BillingStatus) || request.BillingStatus == "capture_pending" {
			return nil
		}
		if request.BillingStatus == "release_pending" {
			return s.finishH3Decision(ctx, durable, request)
		}
		return s.decideH3Release(ctx, durable, request, reason)
	})
}

func (s *Server) decideH3Release(ctx context.Context, durable h3BillingStore, request store.MediaRequest, reason string) error {
	applied, err := durable.DecideMediaBilling(ctx, request.RequestID, "release_pending", 0, "", reason)
	if err != nil {
		return err
	}
	if !applied {
		return nil
	}
	request.BillingStatus = "release_pending"
	request.LastError = reason
	return s.finishH3Decision(ctx, durable, request)
}

func (s *Server) decideH3Capture(ctx context.Context, durable h3BillingStore, request store.MediaRequest, shadowUserID int64) error {
	if request.ReservationAmount == 0 {
		return durable.MarkBilling(ctx, request.RequestID, "settled", 0, "", "", "")
	}
	if request.NewAPIRequestID == "" {
		return nil
	}
	billCtx, cancel := context.WithTimeout(ctx, s.Config.NewAPITimeout)
	bill, found, err := s.Upstream.FindH3Bill(billCtx, s.Config.NewAPIURL, s.Config.NewAPIAdminToken, s.Config.NewAPILogPath, request.NewAPIRequestID, request.RequestID, shadowUserID)
	cancel()
	if err != nil || !found {
		return err
	}
	multiplier, ok := s.Config.MediaMultiplierByModel[request.Model]
	if !ok {
		return fmt.Errorf("H3 media multiplier unavailable")
	}
	amount, release := settlementAmount(bill, multiplier)
	if release {
		return s.decideH3Release(ctx, durable, request, "H3 task completed without billable output; reservation released")
	}
	if amount > request.ReservationAmount {
		return fmt.Errorf("H3 final usage exceeds reservation")
	}
	applied, err := durable.DecideMediaBilling(ctx, request.RequestID, "capture_pending", amount, bill.ID, "")
	if err != nil {
		return err
	}
	if !applied {
		return nil
	}
	request.BillingStatus = "capture_pending"
	request.FinalQuota = amount
	request.NativeBillID = bill.ID
	return s.finishH3Decision(ctx, durable, request)
}

func (s *Server) finishH3Decision(ctx context.Context, durable h3BillingStore, request store.MediaRequest) error {
	if request.BillingStatus == "release_pending" {
		if _, err := s.h3Ledger(ctx, "release", request.RequestID, map[string]any{"request_id": request.RequestID, "api_key_id": request.APIKeyID, "user_id": request.CheapBuddyUserID, "amount": request.ReservationAmount, "payload_hash": ""}, request.ReservationAmount); err != nil {
			return err
		}
		return durable.MarkBilling(ctx, request.RequestID, "released", 0, "", "", request.LastError)
	}
	if request.BillingStatus != "capture_pending" || request.FinalQuota <= 0 || request.FinalQuota > request.ReservationAmount {
		return fmt.Errorf("invalid H3 billing decision")
	}
	callCtx, cancel := context.WithTimeout(ctx, s.Config.Sub2APITimeout)
	response, err := s.h3Ledger(callCtx, "capture", request.RequestID, map[string]any{"request_id": request.RequestID, "api_key_id": request.APIKeyID, "user_id": request.CheapBuddyUserID, "held_amount": request.ReservationAmount, "actual_amount": request.FinalQuota, "payload_hash": ""}, request.ReservationAmount)
	cancel()
	if err != nil {
		return err
	}
	ledgerID, _ := response["billing_request_id"].(string)
	return durable.MarkBilling(ctx, request.RequestID, "settled", request.FinalQuota, request.NativeBillID, ledgerID, "")
}

func (s *Server) h3Ledger(ctx context.Context, operation, requestID string, payload any, amount int64) (map[string]any, error) {
	if amount <= 0 {
		return nil, nil
	}
	callCtx, cancel := context.WithTimeout(ctx, s.Config.Sub2APITimeout)
	defer cancel()
	response, err := s.Upstream.Billing(callCtx, s.Config.Sub2APIURL, s.Config.RelayServiceToken, operation, requestID, payload)
	if err != nil {
		return nil, err
	}
	claim := operation
	if operation == "reserve" {
		claim = "hold"
	}
	if response["billing_request_id"] != "batch_image_"+claim+":"+requestID {
		return nil, fmt.Errorf("H3 ledger acknowledgement mismatch")
	}
	return response, nil
}
