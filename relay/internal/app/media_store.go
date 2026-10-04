package app

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sync"
	"time"
)

const (
	mediaStoreTTL      = 30 * time.Minute
	mediaStoreMaxBytes = 512 << 20
	mediaTokenBytes    = 32
)

var errMediaStoreFull = errors.New("temporary media store is full")

type mediaBlob struct {
	data        []byte
	contentType string
	expiresAt   time.Time
}

type mediaStore struct {
	mu       sync.Mutex
	items    map[string]mediaBlob
	bytes    int64
	maxBytes int64
	ttl      time.Duration
	clock    func() time.Time
}

func newMediaStore(maxRequestBytes int64) *mediaStore {
	maxBytes := int64(mediaStoreMaxBytes)
	if maxRequestBytes > 0 && maxRequestBytes < maxBytes {
		maxBytes = maxRequestBytes * 8
	}
	return &mediaStore{
		items:    make(map[string]mediaBlob),
		maxBytes: maxBytes,
		ttl:      mediaStoreTTL,
		clock:    time.Now,
	}
}

func (s *mediaStore) put(data []byte, contentType string) (string, time.Time, error) {
	if s == nil || len(data) == 0 {
		return "", time.Time{}, errMediaStoreFull
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.clock()
	s.purgeExpiredLocked(now)
	if int64(len(data)) > s.maxBytes || s.bytes+int64(len(data)) > s.maxBytes {
		return "", time.Time{}, errMediaStoreFull
	}
	tokenBytes := make([]byte, mediaTokenBytes)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", time.Time{}, err
	}
	token := hex.EncodeToString(tokenBytes)
	expiresAt := now.Add(s.ttl)
	copyOfData := append([]byte(nil), data...)
	s.items[token] = mediaBlob{data: copyOfData, contentType: contentType, expiresAt: expiresAt}
	s.bytes += int64(len(copyOfData))
	return token, expiresAt, nil
}

func (s *mediaStore) get(token string) (mediaBlob, bool) {
	if s == nil {
		return mediaBlob{}, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.clock()
	s.purgeExpiredLocked(now)
	blob, ok := s.items[token]
	if !ok || !now.Before(blob.expiresAt) {
		return mediaBlob{}, false
	}
	blob.data = append([]byte(nil), blob.data...)
	return blob, true
}

func (s *mediaStore) purgeExpiredLocked(now time.Time) {
	for token, blob := range s.items {
		if !now.Before(blob.expiresAt) {
			s.bytes -= int64(len(blob.data))
			delete(s.items, token)
		}
	}
}
