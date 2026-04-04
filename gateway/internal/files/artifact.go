package files

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"mime"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/fran0220/jacoworks/gateway/internal/container"
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
	Exec(ctx context.Context, name string, cmd ...string) (*container.ExecResult, error)
}

type ArtifactStore struct {
	ttl             time.Duration
	cleanupInterval time.Duration
	artifacts       sync.Map
	stopCh          chan struct{}
	doneCh          chan struct{}
	closeOnce       sync.Once
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

	// Resolve relative paths: OpenClaw write tool uses relative paths within
	// its workspace (typically ~/.openclaw/workspace-default/). Use find to
	// locate the file if stat on the raw path fails.
	if statReader != nil && !strings.HasPrefix(cleanPath, "/") {
		cleanPath = resolveRelativePath(ctx, statReader, containerName, cleanPath)
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

// resolveRelativePath tries to find the absolute path of a relative file inside
// the container. OpenClaw agents typically write to ~/.openclaw/workspace-default/
// or /data/workspace/ using relative paths.
func resolveRelativePath(ctx context.Context, sr StatReader, containerName, relativePath string) string {
	// Common OpenClaw workspace directories to check
	candidates := []string{
		"/home/node/.openclaw/workspace-default/" + relativePath,
		"/data/workspace/" + relativePath,
	}
	for _, candidate := range candidates {
		if _, err := sr.StatFile(ctx, containerName, candidate); err == nil {
			return candidate
		}
	}
	// Fallback: use find to search common workspace roots
	result, err := sr.Exec(ctx, containerName, "find",
		"/home/node/.openclaw", "/data/workspace",
		"-name", path.Base(relativePath), "-type", "f",
		"-maxdepth", "5", "-print", "-quit")
	if err == nil && strings.TrimSpace(result.Stdout) != "" {
		found := strings.TrimSpace(strings.Split(result.Stdout, "\n")[0])
		if found != "" {
			return found
		}
	}
	return relativePath
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


