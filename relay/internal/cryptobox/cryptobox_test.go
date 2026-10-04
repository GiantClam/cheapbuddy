package cryptobox

import "testing"

func TestEncryptDecrypt(t *testing.T) {
	value, err := Encrypt("newapi-token", "secret")
	if err != nil {
		t.Fatal(err)
	}
	if value == "newapi-token" {
		t.Fatal("token was not encrypted")
	}
	plain, err := Decrypt(value, "secret")
	if err != nil || plain != "newapi-token" {
		t.Fatalf("unexpected decrypt result: %q %v", plain, err)
	}
	if _, err := Decrypt(value, "other-secret"); err == nil {
		t.Fatal("expected decrypt failure with other secret")
	}
}
