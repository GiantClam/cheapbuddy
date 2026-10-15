package main

import (
	"bufio"
	"bytes"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

type result struct {
	status    int
	firstByte time.Duration
	total     time.Duration
	err       error
}

func main() {
	baseURL := flag.String("base", "http://127.0.0.1:18080", "Relay base URL")
	mode := flag.String("mode", "text", "workload: text or media")
	requests := flag.Int("requests", 300, "total requests")
	concurrency := flag.Int("concurrency", 100, "parallel requests")
	runID := flag.String("run-id", fmt.Sprintf("load-%d", time.Now().UnixNano()), "unique media idempotency key prefix")
	flag.Parse()
	if (*mode != "text" && *mode != "media") || *requests < 1 || *concurrency < 1 {
		fmt.Fprintln(os.Stderr, "mode must be text or media; requests and concurrency must be positive")
		os.Exit(2)
	}

	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConns = *concurrency * 2
	transport.MaxIdleConnsPerHost = *concurrency * 2
	transport.MaxConnsPerHost = *concurrency * 2
	transport.Proxy = nil
	transport.DialContext = (&net.Dialer{Timeout: 2 * time.Second, KeepAlive: 30 * time.Second}).DialContext
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second}
	defer transport.CloseIdleConnections()

	jobs := make(chan int)
	results := make(chan result, *requests)
	var workers sync.WaitGroup
	for range *concurrency {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for index := range jobs {
				results <- call(client, strings.TrimRight(*baseURL, "/"), *mode, *runID, index)
			}
		}()
	}

	started := time.Now()
	for index := range *requests {
		jobs <- index
	}
	close(jobs)
	workers.Wait()
	close(results)
	elapsed := time.Since(started)

	statuses := map[int]int{}
	firstBytes := make([]time.Duration, 0, *requests)
	totals := make([]time.Duration, 0, *requests)
	failures := 0
	for result := range results {
		statuses[result.status]++
		if result.err != nil {
			failures++
			continue
		}
		firstBytes = append(firstBytes, result.firstByte)
		totals = append(totals, result.total)
	}

	sort.Slice(firstBytes, func(i, j int) bool { return firstBytes[i] < firstBytes[j] })
	sort.Slice(totals, func(i, j int) bool { return totals[i] < totals[j] })
	throughput := float64(*requests) / elapsed.Seconds()
	fmt.Printf("mode=%s requests=%d concurrency=%d elapsed_ms=%d throughput_rps=%.1f failures=%d statuses=%v first_byte_p50_ms=%d first_byte_p95_ms=%d total_p50_ms=%d total_p95_ms=%d\n",
		*mode, *requests, *concurrency, elapsed.Milliseconds(), throughput, failures, statuses,
		percentile(firstBytes, 50).Milliseconds(), percentile(firstBytes, 95).Milliseconds(),
		percentile(totals, 50).Milliseconds(), percentile(totals, 95).Milliseconds())
	if failures > 0 {
		os.Exit(1)
	}
}

func call(client *http.Client, baseURL, mode, runID string, index int) result {
	endpoint := "/v1/chat/completions"
	payload := `{"model":"text-model","messages":[{"role":"user","content":"load"}],"stream":true}`
	expectedStatus := http.StatusOK
	if mode == "media" {
		endpoint = "/v1/images/generations"
		payload = `{"model":"gpt-image-2","prompt":"local load test"}`
		expectedStatus = http.StatusOK
	}
	request, err := http.NewRequest(http.MethodPost, baseURL+endpoint, bytes.NewBufferString(payload))
	if err != nil {
		return result{err: err}
	}
	request.Header.Set("Authorization", "Bearer test-key")
	request.Header.Set("Content-Type", "application/json")
	if mode == "media" {
		request.Header.Set("Idempotency-Key", fmt.Sprintf("%s-%d", runID, index))
	}
	started := time.Now()
	response, err := client.Do(request)
	firstByte := time.Since(started)
	if err != nil {
		return result{firstByte: firstByte, total: time.Since(started), err: err}
	}
	var body []byte
	var readErr error
	if mode == "text" {
		body, readErr = readSSE(response.Body)
	} else {
		body, readErr = io.ReadAll(response.Body)
	}
	response.Body.Close()
	if response.Header.Get("Set-Cookie") != "" {
		return result{status: response.StatusCode, firstByte: firstByte, total: time.Since(started), err: fmt.Errorf("upstream cookie leaked")}
	}
	if readErr != nil {
		return result{status: response.StatusCode, firstByte: firstByte, total: time.Since(started), err: readErr}
	}
	if response.StatusCode != expectedStatus {
		return result{status: response.StatusCode, firstByte: firstByte, total: time.Since(started), err: fmt.Errorf("unexpected status %d", response.StatusCode)}
	}
	if mode == "text" && !bytes.Contains(body, []byte("data: first")) {
		return result{status: response.StatusCode, firstByte: firstByte, total: time.Since(started), err: fmt.Errorf("missing SSE payload")}
	}
	if mode == "media" && !bytes.Contains(body, []byte("generated.png")) {
		return result{status: response.StatusCode, firstByte: firstByte, total: time.Since(started), err: fmt.Errorf("missing native image response")}
	}
	return result{status: response.StatusCode, firstByte: firstByte, total: time.Since(started)}
}

func readSSE(body io.Reader) ([]byte, error) {
	reader := bufio.NewReader(body)
	var received bytes.Buffer
	for {
		line, err := reader.ReadString('\n')
		received.WriteString(line)
		if strings.Contains(line, "data: [DONE]") {
			return received.Bytes(), nil
		}
		if err != nil {
			return received.Bytes(), err
		}
	}
}

func percentile(values []time.Duration, percentile int) time.Duration {
	if len(values) == 0 {
		return 0
	}
	index := (len(values) - 1) * percentile / 100
	return values[index]
}
