package files

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"mime"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

const (
	defaultArtifactTTL             = 24 * time.Hour
	defaultArtifactCleanupInterval = time.Hour
)

type FileArtifact struct {
	ID        string    `json:"id"`
	UserID    string    `json:"-"`
	Container string    `json:"-"`
	Path      string    `json:"-"`
	Name      string    `json:"name"`
	PathLabel string    `json:"pathLabel"`
	Ext       string    `json:"ext"`
	Mime      string    `json:"mime"`
	Size      int64     `json:"size"`
	Category  string    `json:"category"`
	CreatedAt time.Time `json:"createdAt"`
}

type StatReader interface {
	StatFile(ctx context.Context, containerName, filePath string) (int64, error)
}

type ArtifactStore struct {
	ttl             time.Duration
	cleanupInterval time.Duration
	artifacts       sync.Map
	stopCh          chan struct{}
	doneCh          chan struct{}
	closeOnce       sync.Once
}

type EventEnricher struct {
	store            *ArtifactStore
	statReader       StatReader
	pendingWritePath map[string]string
}

func NewArtifactStore(ttl, cleanupInterval time.Duration) *ArtifactStore {
	if ttl <= 0 {
		ttl = defaultArtifactTTL
	}
	if cleanupInterval <= 0 {
		cleanupInterval = defaultArtifactCleanupInterval
	}

	s := &ArtifactStore{
		ttl:             ttl,
		cleanupInterval: cleanupInterval,
		stopCh:          make(chan struct{}),
		doneCh:          make(chan struct{}),
	}
	go s.cleanupLoop()
	return s
}

func (s *ArtifactStore) Close() {
	s.closeOnce.Do(func() {
		close(s.stopCh)
		<-s.doneCh
	})
}

func (s *ArtifactStore) Register(ctx context.Context, statReader StatReader, userID, containerName, filePath string) (*FileArtifact, error) {
	if s == nil {
		return nil, fmt.Errorf("artifact store not initialized")
	}

	userID = strings.TrimSpace(userID)
	containerName = strings.TrimSpace(containerName)
	cleanPath, err := normalizeArtifactPath(filePath)
	if err != nil {
		return nil, err
	}
	if userID == "" || containerName == "" {
		return nil, fmt.Errorf("artifact registration requires user and container")
	}

	size := int64(0)
	if statReader != nil {
		size, err = statReader.StatFile(ctx, containerName, cleanPath)
		if err != nil {
			return nil, fmt.Errorf("stat file: %w", err)
		}
	}

	name := path.Base(cleanPath)
	ext := detectExt(name)
	category := detectCategory(name)
	artifact := &FileArtifact{
		ID:        newArtifactID(),
		UserID:    userID,
		Container: containerName,
		Path:      cleanPath,
		Name:      name,
		PathLabel: displayPath(cleanPath),
		Ext:       ext,
		Mime:      detectMime(ext, category),
		Size:      size,
		Category:  category,
		CreatedAt: time.Now().UTC(),
	}

	s.artifacts.Store(artifact.ID, artifact)
	return cloneArtifact(artifact), nil
}

func (s *ArtifactStore) GetForUser(id, userID string) (*FileArtifact, bool) {
	artifact, ok := s.Get(id)
	if !ok || artifact.UserID != strings.TrimSpace(userID) {
		return nil, false
	}
	return artifact, true
}

func (s *ArtifactStore) Get(id string) (*FileArtifact, bool) {
	if s == nil {
		return nil, false
	}

	value, ok := s.artifacts.Load(strings.TrimSpace(id))
	if !ok {
		return nil, false
	}
	artifact, ok := value.(*FileArtifact)
	if !ok || artifact == nil {
		s.artifacts.Delete(strings.TrimSpace(id))
		return nil, false
	}
	if s.expired(artifact.CreatedAt) {
		s.artifacts.Delete(artifact.ID)
		return nil, false
	}
	return cloneArtifact(artifact), true
}

func (s *ArtifactStore) UpdateSize(id string, size int64) {
	if s == nil || size < 0 {
		return
	}
	value, ok := s.artifacts.Load(strings.TrimSpace(id))
	if !ok {
		return
	}
	artifact, ok := value.(*FileArtifact)
	if !ok || artifact == nil {
		return
	}
	artifact.Size = size
}

func (s *ArtifactStore) cleanupLoop() {
	defer close(s.doneCh)

	ticker := time.NewTicker(s.cleanupInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			s.cleanupExpired()
		case <-s.stopCh:
			return
		}
	}
}

func (s *ArtifactStore) cleanupExpired() {
	now := time.Now()
	s.artifacts.Range(func(key, value any) bool {
		artifact, ok := value.(*FileArtifact)
		if !ok || artifact == nil || now.Sub(artifact.CreatedAt) > s.ttl {
			s.artifacts.Delete(key)
		}
		return true
	})
}

func (s *ArtifactStore) expired(createdAt time.Time) bool {
	if s == nil || s.ttl <= 0 {
		return false
	}
	return time.Since(createdAt) > s.ttl
}

func NewEventEnricher(store *ArtifactStore, statReader StatReader) *EventEnricher {
	if store == nil || statReader == nil {
		return nil
	}
	return &EventEnricher{
		store:            store,
		statReader:       statReader,
		pendingWritePath: make(map[string]string),
	}
}

func (e *EventEnricher) Enrich(ctx context.Context, userID, containerName string, payload []byte) []byte {
	if e == nil || len(payload) == 0 {
		return payload
	}

	var frame map[string]any
	if err := json.Unmarshal(payload, &frame); err != nil {
		return payload
	}

	mutated := false
	if strings.EqualFold(asString(frame["type"]), "event") {
		switch strings.ToLower(asString(frame["event"])) {
		case "agent":
			mutated = e.enrichAgentEvent(ctx, userID, containerName, frame)
		case "chat":
			mutated = e.enrichChatEvent(ctx, userID, containerName, frame)
		}
	}

	if !mutated {
		return payload
	}

	encoded, err := json.Marshal(frame)
	if err != nil {
		return payload
	}
	return encoded
}

func (e *EventEnricher) enrichAgentEvent(ctx context.Context, userID, containerName string, frame map[string]any) bool {
	payload := asMap(frame["payload"])
	if strings.ToLower(asString(payload["stream"])) != "tool" {
		return false
	}

	data := asMap(payload["data"])
	phase := strings.ToLower(asString(data["phase"]))
	toolName := strings.ToLower(asString(data["name"]))
	toolCallID := asString(data["toolCallId"])

	if toolName != "write" {
		return false
	}

	if phase == "start" {
		if filePath := extractPath(data["args"]); filePath != "" && toolCallID != "" {
			e.pendingWritePath[toolCallID] = filePath
		}
		return false
	}

	if phase != "result" && phase != "error" && phase != "end" && phase != "final" {
		return false
	}

	filePath := extractPath(data["args"])
	if filePath == "" && toolCallID != "" {
		filePath = e.pendingWritePath[toolCallID]
	}
	if filePath == "" {
		return false
	}

	artifact, ok := e.registerArtifact(ctx, userID, containerName, filePath)
	if !ok {
		return false
	}

	data["fileArtifact"] = artifact
	if result := asMap(data["result"]); len(result) > 0 {
		result["fileArtifact"] = artifact
		data["result"] = result
	}
	payload["data"] = data
	frame["payload"] = payload
	if toolCallID != "" {
		delete(e.pendingWritePath, toolCallID)
	}
	return true
}

func (e *EventEnricher) enrichChatEvent(ctx context.Context, userID, containerName string, frame map[string]any) bool {
	payload := asMap(frame["payload"])
	message := asMap(payload["message"])
	content, ok := message["content"].([]any)
	if !ok || len(content) == 0 {
		return false
	}

	mutated := false
	for i, rawItem := range content {
		item := asMap(rawItem)
		kind := strings.ToLower(asString(item["type"]))
		toolName := strings.ToLower(asString(item["name"]))
		if (kind != "tool_result" && kind != "toolresult") || toolName != "write" {
			continue
		}

		filePath := extractPath(item["args"])
		if filePath == "" {
			filePath = extractPath(item["arguments"])
		}
		if filePath == "" {
			filePath = extractPath(item["output"])
		}
		if filePath == "" {
			continue
		}

		artifact, ok := e.registerArtifact(ctx, userID, containerName, filePath)
		if !ok {
			continue
		}
		item["fileArtifact"] = artifact
		content[i] = item
		mutated = true
	}

	if !mutated {
		return false
	}

	message["content"] = content
	payload["message"] = message
	frame["payload"] = payload
	return true
}

func (e *EventEnricher) registerArtifact(ctx context.Context, userID, containerName, filePath string) (*FileArtifact, bool) {
	artifact, err := e.store.Register(ctx, e.statReader, userID, containerName, filePath)
	if err != nil {
		log.Warn().Err(err).
			Str("user_id", userID).
			Str("container", containerName).
			Str("path", strings.TrimSpace(filePath)).
			Msg("artifact registration failed")
		return nil, false
	}
	return artifact, true
}

func normalizeArtifactPath(filePath string) (string, error) {
	cleanPath := path.Clean(strings.TrimSpace(filePath))
	if cleanPath == "" || cleanPath == "." {
		return "", fmt.Errorf("artifact path is required")
	}
	return cleanPath, nil
}

func displayPath(filePath string) string {
	trimmed := strings.TrimSpace(filePath)
	trimmed = strings.TrimPrefix(trimmed, "./")
	trimmed = strings.TrimPrefix(trimmed, "/")
	if trimmed == "" {
		return path.Base(filePath)
	}
	return trimmed
}

func newArtifactID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("fa_%d", time.Now().UnixNano())
	}
	return "fa_" + hex.EncodeToString(b)
}

func cloneArtifact(artifact *FileArtifact) *FileArtifact {
	if artifact == nil {
		return nil
	}
	copy := *artifact
	return &copy
}

func detectExt(name string) string {
	lowerName := strings.ToLower(strings.TrimSpace(name))
	for _, suffix := range []string{".tar.gz", ".tgz"} {
		if strings.HasSuffix(lowerName, suffix) {
			return strings.TrimPrefix(suffix, ".")
		}
	}
	return strings.TrimPrefix(strings.ToLower(path.Ext(lowerName)), ".")
}

func detectCategory(name string) string {
	lowerName := strings.ToLower(strings.TrimSpace(name))
	for suffix, category := range map[string]string{
		".tar.gz": "archive",
		".tgz":    "archive",
	} {
		if strings.HasSuffix(lowerName, suffix) {
			return category
		}
	}

	ext := strings.TrimPrefix(strings.ToLower(path.Ext(lowerName)), ".")
	if ext == "" {
		return "binary"
	}

	if category, ok := map[string]string{
		"pdf":    "pdf",
		"docx":   "document",
		"doc":    "document",
		"xlsx":   "document",
		"xls":    "document",
		"pptx":   "document",
		"txt":    "text",
		"md":     "text",
		"mjs":    "code",
		"js":     "code",
		"ts":     "code",
		"tsx":    "code",
		"jsx":    "code",
		"py":     "code",
		"go":     "code",
		"rs":     "code",
		"json":   "code",
		"yaml":   "code",
		"yml":    "code",
		"toml":   "code",
		"html":   "code",
		"css":    "code",
		"sql":    "code",
		"csv":    "csv",
		"png":    "image",
		"jpg":    "image",
		"jpeg":   "image",
		"gif":    "image",
		"svg":    "image",
		"webp":   "image",
		"bmp":    "image",
		"mp4":    "video",
		"mov":    "video",
		"m4v":    "video",
		"webm":   "video",
		"mp3":    "audio",
		"wav":    "audio",
		"m4a":    "audio",
		"aac":    "audio",
		"ogg":    "audio",
		"flac":   "audio",
		"zip":    "archive",
		"tar":    "archive",
		"fig":    "design",
		"sketch": "design",
		"psd":    "design",
		"sh":     "code",
		"log":    "code",
		"xml":    "code",
	}[ext]; ok {
		return category
	}

	return "binary"
}

func detectMime(ext, category string) string {
	ext = strings.TrimSpace(strings.ToLower(ext))
	if ext == "" {
		return "application/octet-stream"
	}

	switch ext {
	case "tar.gz", "tgz":
		return "application/gzip"
	case "md":
		return "text/markdown; charset=utf-8"
	case "csv":
		return "text/csv; charset=utf-8"
	case "json":
		return "application/json; charset=utf-8"
	case "xml":
		return "application/xml; charset=utf-8"
	case "yaml", "yml", "toml", "py", "go", "rs", "mjs", "js", "ts", "tsx", "jsx", "sql", "sh", "log":
		return "text/plain; charset=utf-8"
	}

	mimeType := mime.TypeByExtension("." + ext)
	if category == "code" && (mimeType == "" || strings.HasPrefix(mimeType, "video/")) {
		mimeType = "text/plain; charset=utf-8"
	}
	if category == "text" && mimeType == "" {
		mimeType = "text/plain; charset=utf-8"
	}
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	if strings.HasPrefix(mimeType, "text/") && !strings.Contains(strings.ToLower(mimeType), "charset=") {
		mimeType += "; charset=utf-8"
	}
	return mimeType
}

func extractPath(value any) string {
	rec := asMap(value)
	for _, key := range []string{"path", "filePath", "filepath", "target"} {
		if pathValue := strings.TrimSpace(asString(rec[key])); pathValue != "" {
			return pathValue
		}
	}
	return ""
}

func asMap(value any) map[string]any {
	if rec, ok := value.(map[string]any); ok {
		return rec
	}
	return map[string]any{}
}

func asString(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}
