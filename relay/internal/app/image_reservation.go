package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"mime"
	"mime/multipart"
	"strconv"
	"strings"

	"github.com/cheapbuddy/relay/internal/config"
	"github.com/cheapbuddy/relay/internal/store"
	"github.com/cheapbuddy/relay/internal/upstream"
)

type imageCountKey struct{}

func fixedPriceImageModel(model string) bool {
	return model == "gpt-image-2.5" || model == "gpt-image-2.6"
}

func imageCountFromContext(ctx context.Context) int {
	if count, ok := ctx.Value(imageCountKey{}).(int); ok {
		return count
	}
	return 1
}

func imageReservation(cfg config.Config, model string, count int) (int64, error) {
	if count < 1 || count > 128 {
		return 0, fmt.Errorf("Image n must be an integer between 1 and 128")
	}
	unit, err := mediaReservation(cfg, model, 0)
	if err != nil {
		return 0, err
	}
	if unit < 0 || unit > math.MaxInt64/int64(count) {
		return 0, fmt.Errorf("Image reservation is out of range")
	}
	return unit * int64(count), nil
}

func parseImageCount(value string) (int, error) {
	count, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || count < 1 || count > 128 {
		return 0, fmt.Errorf("Image n must be an integer between 1 and 128")
	}
	return count, nil
}

func imageJSONCount(body []byte) (int, error) {
	var fields struct {
		N          json.RawMessage `json:"n"`
		Parameters json.RawMessage `json:"parameters"`
	}
	if json.Unmarshal(body, &fields) != nil || !strings.HasPrefix(strings.TrimSpace(string(body)), "{") {
		return 0, fmt.Errorf("Image request body must be an object")
	}
	if len(fields.Parameters) > 0 {
		var nested struct {
			N json.RawMessage `json:"n"`
		}
		if json.Unmarshal(fields.Parameters, &nested) == nil {
			if len(nested.N) > 0 {
				return 0, fmt.Errorf("Image n must be a top-level field")
			}
		}
	}
	if len(fields.N) > 0 {
		return parseImageCount(string(fields.N))
	}
	return 1, nil
}

func requestSettlementAmount(request store.MediaRequest, bill upstream.Bill, multiplier float64) (int64, bool) {
	amount, release := settlementAmount(bill, multiplier)
	if fixedPriceImageModel(request.Model) && amount > request.ReservationAmount {
		amount = request.ReservationAmount
	}
	return amount, release || amount <= 0
}

// Edits can put n after image files. Inspect the complete spooled body so the
// hold matches every requested output while forwarding the original bytes.
func imageMultipartCount(source io.Reader, contentType string) (int, error) {
	_, params, err := mime.ParseMediaType(contentType)
	if err != nil || params["boundary"] == "" {
		return 0, fmt.Errorf("multipart boundary is invalid")
	}
	reader := multipart.NewReader(source, params["boundary"])
	count, seenCount, seenModel := 1, false, false
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			return count, nil
		}
		if err != nil {
			return 0, fmt.Errorf("multipart body is invalid")
		}
		name := part.FormName()
		if name != "n" && name != "model" && name != "parameters" {
			if _, err := io.Copy(io.Discard, part); err != nil {
				return 0, fmt.Errorf("multipart body is invalid")
			}
			continue
		}
		if part.FileName() != "" {
			return 0, fmt.Errorf("Image model, n and parameters must be text fields")
		}
		if name == "n" && seenCount || name == "model" && seenModel {
			return 0, fmt.Errorf("Image model and n must be provided once")
		}
		data, err := io.ReadAll(io.LimitReader(part, 65537))
		if err != nil || len(data) > 65536 {
			return 0, fmt.Errorf("Image billing field is too large")
		}
		switch name {
		case "n":
			seenCount = true
			count, err = parseImageCount(string(data))
			if err != nil {
				return 0, err
			}
		case "model":
			seenModel = true
		case "parameters":
			wrapped, _ := json.Marshal(map[string]json.RawMessage{"parameters": data})
			if _, err := imageJSONCount(wrapped); err != nil {
				return 0, err
			}
		}
	}
}
