package store

import (
	"context"
	"time"
)

type SkillFile struct {
	FilePath  string    `json:"file_path"`
	Content   string    `json:"content,omitempty"`
	Checksum  string    `json:"checksum"`
	UpdatedAt time.Time `json:"updated_at"`
}

// GetSkillChecksums returns a map of owner → latest checksum for quick comparison.
// Desktop sends its checksum, gateway compares to decide if upload is needed.
func (s *Store) GetSkillChecksums(ctx context.Context, owners []string) (map[string]string, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT owner, string_agg(checksum, ',' ORDER BY file_path)
		 FROM skill_files WHERE owner = ANY($1) GROUP BY owner`,
		owners)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]string)
	for rows.Next() {
		var owner, aggChecksum string
		if err := rows.Scan(&owner, &aggChecksum); err != nil {
			return nil, err
		}
		// Hash the aggregated checksums to get a single checksum per owner
		result[owner] = ContentChecksum(aggChecksum)
	}
	return result, nil
}

// UpsertSkillFile inserts or updates a single skill file.
func (s *Store) UpsertSkillFile(ctx context.Context, owner, filePath, content, checksum string) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO skill_files (owner, file_path, content, checksum)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (owner, file_path)
		 DO UPDATE SET content = $3, checksum = $4, updated_at = now()`,
		owner, filePath, content, checksum)
	return err
}

// ReplaceSkillFiles deletes all files for an owner and inserts new ones (atomic replace).
func (s *Store) ReplaceSkillFiles(ctx context.Context, owner string, files []SkillFile) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, `DELETE FROM skill_files WHERE owner = $1`, owner)
	if err != nil {
		return err
	}

	for _, f := range files {
		_, err = tx.Exec(ctx,
			`INSERT INTO skill_files (owner, file_path, content, checksum) VALUES ($1, $2, $3, $4)`,
			owner, f.FilePath, f.Content, f.Checksum)
		if err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

// GetSkillFiles returns all skill files for an owner (for LXD push).
func (s *Store) GetSkillFiles(ctx context.Context, owner string) ([]SkillFile, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT file_path, content, checksum, updated_at FROM skill_files
		 WHERE owner = $1 ORDER BY file_path`,
		owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var files []SkillFile
	for rows.Next() {
		var f SkillFile
		if err := rows.Scan(&f.FilePath, &f.Content, &f.Checksum, &f.UpdatedAt); err != nil {
			return nil, err
		}
		files = append(files, f)
	}
	return files, nil
}
