package files

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/fran0220/jacoworks/gateway/internal/auth"
	"github.com/rs/zerolog/log"
)

const (
	maxArtifactSize    = 50 << 20
	maxTextPreviewSize = 1 << 20
)

type ContentReader interface {
	StatReader
	ReadFileBytes(ctx context.Context, containerName, filePath string) ([]byte, error)
}

func GetFileMetaHandler(store *ArtifactStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		artifact, ok := store.GetForUser(r.PathValue("id"), user.ID)
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "file artifact not found"})
			return
		}

		contentURL := fmt.Sprintf("/api/files/%s/content", artifact.ID)
		writeJSON(w, http.StatusOK, map[string]any{
			"id":          artifact.ID,
			"name":        artifact.Name,
			"pathLabel":   artifact.PathLabel,
			"ext":         artifact.Ext,
			"mime":        artifact.Mime,
			"size":        artifact.Size,
			"category":    artifact.Category,
			"createdAt":   artifact.CreatedAt,
			"contentUrl":  contentURL,
			"downloadUrl": contentURL + "?download=1",
		})
	}
}

func GetFileContentHandler(store *ArtifactStore, reader ContentReader) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		if reader == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "file backend not configured"})
			return
		}

		artifact, ok := store.GetForUser(r.PathValue("id"), user.ID)
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "file artifact not found"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
		defer cancel()

		if size, err := reader.StatFile(ctx, artifact.Container, artifact.Path); err == nil {
			artifact.Size = size
			store.UpdateSize(artifact.ID, size)
		}
		if artifact.Size > maxArtifactSize {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "file exceeds 50MB limit"})
			return
		}

		content, err := reader.ReadFileBytes(ctx, artifact.Container, artifact.Path)
		if err != nil {
			log.Warn().Err(err).
				Str("artifact_id", artifact.ID).
				Str("container", artifact.Container).
				Str("path", artifact.Path).
				Msg("artifact read failed")
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "failed to read file"})
			return
		}
		if len(content) > maxArtifactSize {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "file exceeds 50MB limit"})
			return
		}

		body := content
		if isTextCategory(artifact.Category) && len(body) > maxTextPreviewSize {
			body = bytes.ToValidUTF8(body[:maxTextPreviewSize], []byte("�"))
			body = append(body, []byte("\n\n[truncated by JAcoworks after 1MB preview limit]\n")...)
			w.Header().Set("X-File-Truncated", "true")
		}

		w.Header().Set("Content-Type", detectMime(artifact.Ext, artifact.Category))
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Disposition", buildContentDisposition(r.URL.Query().Get("download") == "1", artifact.Name))
		w.Header().Set("Content-Length", strconv.Itoa(len(body)))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
	}
}

func isTextCategory(category string) bool {
	switch strings.ToLower(strings.TrimSpace(category)) {
	case "code", "text", "csv":
		return true
	default:
		return false
	}
}

func buildContentDisposition(download bool, fileName string) string {
	disposition := "inline"
	if download {
		disposition = "attachment"
	}
	safeName := strings.ReplaceAll(strings.TrimSpace(fileName), `"`, "")
	if safeName == "" {
		safeName = "download"
	}
	return fmt.Sprintf("%s; filename=%q", disposition, safeName)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
