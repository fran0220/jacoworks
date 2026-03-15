package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/fran0220/jacoworks/openclaw/jmos/internal/store"
)

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func readJSON(r *http.Request, v interface{}) error {
	if r.Body == nil {
		return errors.New("missing request body")
	}
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(v)
}

func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}

func getPageParams(r *http.Request) (page, pageSize int) {
	page, _ = strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ = strconv.Atoi(r.URL.Query().Get("page_size"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	return
}

func getQueryParam(r *http.Request, key, defaultVal string) string {
	v := r.URL.Query().Get(key)
	if v == "" {
		return defaultVal
	}
	return v
}

func getQueryInt(r *http.Request, key string, defaultVal int) int {
	v := r.URL.Query().Get(key)
	if v == "" {
		return defaultVal
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return defaultVal
	}
	return n
}

func handleServiceError(w http.ResponseWriter, err error) {
	var notFound *store.NotFoundError
	var validation *store.ValidationError
	switch {
	case errors.As(err, &notFound):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.As(err, &validation):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}
