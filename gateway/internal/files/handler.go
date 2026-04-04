package files

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/fran0220/jacoworks/gateway/internal/auth"
	"github.com/fran0220/jacoworks/gateway/internal/container"
	"github.com/rs/zerolog/log"
)

// FileWriter abstracts write + exec access to a container runtime (e.g. incus).
type FileWriter interface {
	StatReader
	WriteFile(ctx context.Context, name, path string, content []byte) error
	Exec(ctx context.Context, name string, cmd ...string) (*container.ExecResult, error)
}

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

// ReadByPathHandler reads a file directly from the user's VM by path.
// This does NOT require pre-registration in ArtifactStore — it resolves the user's
// container and reads the file on the fly. This is the persistent/reliable path
// that works even after gateway restarts or artifact TTL expiry.
//
//	GET /api/vm/file?path=/data/workspace/report.pdf&download=1
func ReadByPathHandler(reader ContentReader, containerLookup func(ctx context.Context, userID string) (string, error)) http.HandlerFunc {
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

		filePath := strings.TrimSpace(r.URL.Query().Get("path"))
		if filePath == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "path parameter is required"})
			return
		}

		cleanPath, err := normalizeArtifactPath(filePath)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid path"})
			return
		}

		containerName, err := containerLookup(r.Context(), user.ID)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "container not found"})
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
		defer cancel()

		size, err := reader.StatFile(ctx, containerName, cleanPath)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "file not found"})
			return
		}
		if size > maxArtifactSize {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "file exceeds 50MB limit"})
			return
		}

		content, err := reader.ReadFileBytes(ctx, containerName, cleanPath)
		if err != nil {
			log.Warn().Err(err).
				Str("container", containerName).
				Str("path", cleanPath).
				Msg("vm file read failed")
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "failed to read file"})
			return
		}

		name := path.Base(cleanPath)
		ext := detectExt(name)
		category := detectCategory(name)

		body := content
		if isTextCategory(category) && len(body) > maxTextPreviewSize {
			body = bytes.ToValidUTF8(body[:maxTextPreviewSize], []byte("�"))
			body = append(body, []byte("\n\n[truncated by JAcoworks after 1MB preview limit]\n")...)
			w.Header().Set("X-File-Truncated", "true")
		}

		w.Header().Set("Content-Type", detectMime(ext, category))
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Disposition", buildContentDisposition(r.URL.Query().Get("download") == "1", name))
		w.Header().Set("Content-Length", strconv.Itoa(len(body)))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
	}
}

// UploadHandler accepts a multipart file upload, writes it into the user's VM,
// and registers it in the ArtifactStore.
func UploadHandler(store *ArtifactStore, writer FileWriter, containerLookup func(ctx context.Context, userID string) (string, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := auth.GetUser(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		if writer == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "file backend not configured"})
			return
		}

		if err := r.ParseMultipartForm(maxArtifactSize); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid multipart form"})
			return
		}

		file, header, err := r.FormFile("file")
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing file field"})
			return
		}
		defer file.Close()

		if header.Size > maxArtifactSize {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "file exceeds 50MB limit"})
			return
		}

		content, err := io.ReadAll(io.LimitReader(file, maxArtifactSize+1))
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "failed to read file"})
			return
		}
		if int64(len(content)) > maxArtifactSize {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "file exceeds 50MB limit"})
			return
		}

		containerName, err := containerLookup(r.Context(), user.ID)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "container not found"})
			return
		}

		safeName := sanitizeFilename(header.Filename)
		uniquePrefix := newArtifactID()
		vmPath := fmt.Sprintf("/data/workspace/_attachments/%s-%s", uniquePrefix, safeName)

		ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
		defer cancel()

		_, _ = writer.Exec(ctx, containerName, "mkdir", "-p", "/data/workspace/_attachments")

		if err := writer.WriteFile(ctx, containerName, vmPath, content); err != nil {
			log.Warn().Err(err).Str("container", containerName).Str("path", vmPath).Msg("upload: write failed")
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "failed to write file to container"})
			return
		}

		artifact, err := store.Register(ctx, writer, user.ID, containerName, vmPath)
		if err != nil {
			log.Warn().Err(err).Str("path", vmPath).Msg("upload: artifact registration failed")
			writeJSON(w, http.StatusOK, map[string]any{
				"vmPath": vmPath,
			})
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"vmPath": vmPath,
			"artifact": map[string]any{
				"id":          artifact.ID,
				"name":        artifact.Name,
				"pathLabel":   artifact.PathLabel,
				"ext":         artifact.Ext,
				"mime":        artifact.Mime,
				"size":        artifact.Size,
				"category":    artifact.Category,
				"createdAt":   artifact.CreatedAt,
				"contentUrl":  fmt.Sprintf("/api/files/%s/content", artifact.ID),
				"downloadUrl": fmt.Sprintf("/api/files/%s/content?download=1", artifact.ID),
			},
		})
	}
}

func sanitizeFilename(name string) string {
	base := path.Base(strings.TrimSpace(name))
	base = strings.ReplaceAll(base, "..", "")
	base = strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r == '\x00' {
			return '_'
		}
		return r
	}, base)
	if base == "" || base == "." {
		base = "upload"
	}
	return base
}
