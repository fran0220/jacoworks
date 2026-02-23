package cowork

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/fran0220/jacoworks/gateway/internal/auth"
	"github.com/fran0220/jacoworks/gateway/internal/lxd"
	"github.com/fran0220/jacoworks/gateway/internal/store"
)

const (
	CoworkBaseDir      = "/data/cowork"
	ContainerMountPath = "/home/agent/cowork"
	MaxUploadSize      = 100 << 20 // 100MB
)

type Handler struct {
	store     *store.Store
	lxdClient *lxd.SSHClient
}

func NewHandler(s *store.Store, lxdClient *lxd.SSHClient) *Handler {
	return &Handler{store: s, lxdClient: lxdClient}
}

func hostPath(userID string, sessionID string) string {
	return filepath.Join(CoworkBaseDir, userID, sessionID)
}

func deviceName(sessionID string) string {
	if len(sessionID) > 12 {
		return "cw-" + sessionID[:12]
	}
	return "cw-" + sessionID
}

func (h *Handler) Upload(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	sid := r.PathValue("sid")

	sess, err := h.store.GetSession(r.Context(), user.ID, sid)
	if err != nil || sess.Type != "cowork" {
		http.Error(w, `{"error":"session not found or not cowork"}`, http.StatusNotFound)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, MaxUploadSize)

	if err := r.ParseMultipartForm(MaxUploadSize); err != nil {
		http.Error(w, `{"error":"file too large (max 100MB)"}`, http.StatusRequestEntityTooLarge)
		return
	}

	file, _, err := r.FormFile("file")
	if err != nil {
		http.Error(w, `{"error":"missing file field"}`, http.StatusBadRequest)
		return
	}
	defer file.Close()

	dir := hostPath(user.ID, sid)
	if err := os.MkdirAll(dir, 0755); err != nil {
		log.Error().Err(err).Msg("create cowork dir")
		http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}

	count, totalSize, err := extractTarGz(file, dir)
	if err != nil {
		log.Error().Err(err).Msg("extract tar.gz")
		http.Error(w, `{"error":"extract failed"}`, http.StatusInternalServerError)
		return
	}

	info, err := h.store.GetContainerInfo(r.Context(), user.ID)
	if err == nil && info.ContainerName != "" {
		device := deviceName(sid)
		_ = h.lxdClient.MountDisk(info.ContainerName, device, dir, ContainerMountPath)
	}

	if err := saveManifest(dir); err != nil {
		log.Warn().Err(err).Msg("save manifest")
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"uploaded":   count,
		"total_size": totalSize,
	})
}

func (h *Handler) Changes(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	sid := r.PathValue("sid")
	dir := hostPath(user.ID, sid)

	changes, err := detectChanges(dir)
	if err != nil {
		http.Error(w, `{"error":"detect changes failed"}`, http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"files": changes})
}

func (h *Handler) Download(w http.ResponseWriter, r *http.Request) {
	user := auth.GetUser(r.Context())
	if user == nil {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	sid := r.PathValue("sid")
	dir := hostPath(user.ID, sid)

	changes, err := detectChanges(dir)
	if err != nil {
		http.Error(w, `{"error":"detect changes failed"}`, http.StatusInternalServerError)
		return
	}

	if len(changes) == 0 {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	w.Header().Set("Content-Type", "application/gzip")
	w.Header().Set("Content-Disposition", "attachment; filename=changes.tar.gz")

	gw := gzip.NewWriter(w)
	defer gw.Close()
	tw := tar.NewWriter(gw)
	defer tw.Close()

	for _, c := range changes {
		if c.Action == "deleted" {
			continue
		}
		fullPath := filepath.Join(dir, c.Path)
		fi, err := os.Stat(fullPath)
		if err != nil {
			continue
		}
		header, _ := tar.FileInfoHeader(fi, "")
		header.Name = c.Path
		if err := tw.WriteHeader(header); err != nil {
			continue
		}
		f, err := os.Open(fullPath)
		if err != nil {
			continue
		}
		io.Copy(tw, f)
		f.Close()
	}

	saveManifest(dir)
}

// --- helpers ---

type FileChange struct {
	Path   string `json:"path"`
	Action string `json:"action"`
	Size   int64  `json:"size"`
}

func extractTarGz(r io.Reader, destDir string) (count int, totalSize int64, err error) {
	gz, err := gzip.NewReader(r)
	if err != nil {
		return 0, 0, err
	}
	defer gz.Close()

	tr := tar.NewReader(gz)
	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return count, totalSize, err
		}

		target := filepath.Join(destDir, header.Name)
		if !strings.HasPrefix(filepath.Clean(target), filepath.Clean(destDir)) {
			continue
		}

		switch header.Typeflag {
		case tar.TypeDir:
			os.MkdirAll(target, 0755)
		case tar.TypeReg:
			os.MkdirAll(filepath.Dir(target), 0755)
			f, err := os.Create(target)
			if err != nil {
				return count, totalSize, err
			}
			n, _ := io.Copy(f, tr)
			f.Close()
			count++
			totalSize += n
		}
	}
	return count, totalSize, nil
}

func saveManifest(dir string) error {
	manifest := make(map[string]string)
	filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || info.Name() == ".manifest.json" {
			return nil
		}
		rel, _ := filepath.Rel(dir, path)
		hash, _ := hashFile(path)
		manifest[rel] = hash
		return nil
	})
	data, _ := json.Marshal(manifest)
	return os.WriteFile(filepath.Join(dir, ".manifest.json"), data, 0644)
}

func loadManifest(dir string) (map[string]string, error) {
	data, err := os.ReadFile(filepath.Join(dir, ".manifest.json"))
	if err != nil {
		return nil, err
	}
	var manifest map[string]string
	err = json.Unmarshal(data, &manifest)
	return manifest, err
}

func hashFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	io.Copy(h, f)
	return hex.EncodeToString(h.Sum(nil)), nil
}

func detectChanges(dir string) ([]FileChange, error) {
	oldManifest, err := loadManifest(dir)
	if err != nil {
		return nil, nil
	}

	var changes []FileChange
	currentFiles := make(map[string]bool)

	filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || info.Name() == ".manifest.json" {
			return nil
		}
		rel, _ := filepath.Rel(dir, path)
		currentFiles[rel] = true
		hash, _ := hashFile(path)

		if oldHash, exists := oldManifest[rel]; !exists {
			changes = append(changes, FileChange{Path: rel, Action: "created", Size: info.Size()})
		} else if hash != oldHash {
			changes = append(changes, FileChange{Path: rel, Action: "modified", Size: info.Size()})
		}
		return nil
	})

	for path := range oldManifest {
		if !currentFiles[path] {
			changes = append(changes, FileChange{Path: path, Action: "deleted", Size: 0})
		}
	}

	return changes, nil
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
