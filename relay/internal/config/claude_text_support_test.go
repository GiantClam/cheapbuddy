package config

import "testing"

func TestDefaultTextPathsIncludeClaudeTokenCounting(t *testing.T) {
	cfg, err := Load(testEnv(nil))
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/v1/messages", "/v1/messages/count_tokens", "/v1/chat/completions", "/v1/responses"} {
		if _, ok := cfg.TextPaths[path]; !ok {
			t.Errorf("default text route missing %s", path)
		}
	}
	if _, ok := cfg.VerifiedMediaModels["claude-sonnet-5-5"]; ok {
		t.Fatal("Claude must not enter the verified media registry")
	}
}

func TestExplicitTextAllowlistRemainsAuthoritative(t *testing.T) {
	cfg, err := Load(testEnv(map[string]string{"RELAY_TEXT_PATHS": "/v1/chat/completions"}))
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.TextPaths) != 1 {
		t.Fatal("custom text allowlist was broadened")
	}
}
