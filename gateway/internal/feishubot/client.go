package feishubot

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

const (
	feishuBaseURL      = "https://open.feishu.cn/open-apis"
	tokenRefreshBuffer = 300 // refresh 5 min before expiry
)

// Client handles Feishu Bot API communication with automatic tenant token management.
type Client struct {
	httpClient *http.Client

	mu          sync.RWMutex
	appID       string
	appSecret   string
	token       string
	tokenExpiry time.Time
}

func NewClient(appID, appSecret string) *Client {
	return &Client{
		appID:      appID,
		appSecret:  appSecret,
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

// UpdateCredentials hot-reloads Feishu app credentials (called on admin settings change).
func (c *Client) UpdateCredentials(appID, appSecret string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.appID != appID || c.appSecret != appSecret {
		c.appID = appID
		c.appSecret = appSecret
		c.token = ""
		c.tokenExpiry = time.Time{}
		log.Info().Msg("feishu bot: credentials updated")
	}
}

// IsConfigured returns true if Feishu credentials are set.
func (c *Client) IsConfigured() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.appID != "" && c.appSecret != ""
}

func (c *Client) getTenantAccessToken() (string, error) {
	c.mu.RLock()
	if c.token != "" && time.Now().Before(c.tokenExpiry) {
		token := c.token
		c.mu.RUnlock()
		return token, nil
	}
	appID, appSecret := c.appID, c.appSecret
	c.mu.RUnlock()

	if appID == "" || appSecret == "" {
		return "", fmt.Errorf("feishu credentials not configured")
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	// Double-check after write lock
	if c.token != "" && time.Now().Before(c.tokenExpiry) {
		return c.token, nil
	}

	body, _ := json.Marshal(map[string]string{
		"app_id":     appID,
		"app_secret": appSecret,
	})

	resp, err := c.httpClient.Post(
		feishuBaseURL+"/auth/v3/tenant_access_token/internal",
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		return "", fmt.Errorf("request token: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Code              int    `json:"code"`
		Msg               string `json:"msg"`
		TenantAccessToken string `json:"tenant_access_token"`
		Expire            int    `json:"expire"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode token response: %w", err)
	}
	if result.Code != 0 {
		return "", fmt.Errorf("feishu error %d: %s", result.Code, result.Msg)
	}

	c.token = result.TenantAccessToken
	c.tokenExpiry = time.Now().Add(time.Duration(result.Expire-tokenRefreshBuffer) * time.Second)

	log.Debug().Int("expire", result.Expire).Msg("feishu bot: tenant token refreshed")
	return c.token, nil
}

// ReplyText replies to a specific message in the same thread.
func (c *Client) ReplyText(messageID, text string) error {
	token, err := c.getTenantAccessToken()
	if err != nil {
		return err
	}

	content, _ := json.Marshal(map[string]string{"text": text})
	body, _ := json.Marshal(map[string]string{
		"msg_type": "text",
		"content":  string(content),
	})

	req, _ := http.NewRequest("POST",
		fmt.Sprintf("%s/im/v1/messages/%s/reply", feishuBaseURL, messageID),
		bytes.NewReader(body),
	)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("reply message: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	if result.Code != 0 {
		return fmt.Errorf("feishu reply error %d: %s", result.Code, result.Msg)
	}

	return nil
}

// SendText sends a new message to a user by open_id.
func (c *Client) SendText(openID, text string) error {
	token, err := c.getTenantAccessToken()
	if err != nil {
		return err
	}

	content, _ := json.Marshal(map[string]string{"text": text})
	body, _ := json.Marshal(map[string]interface{}{
		"receive_id": openID,
		"msg_type":   "text",
		"content":    string(content),
	})

	req, _ := http.NewRequest("POST",
		feishuBaseURL+"/im/v1/messages?receive_id_type=open_id",
		bytes.NewReader(body),
	)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send message: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	if result.Code != 0 {
		return fmt.Errorf("feishu send error %d: %s", result.Code, result.Msg)
	}

	return nil
}
